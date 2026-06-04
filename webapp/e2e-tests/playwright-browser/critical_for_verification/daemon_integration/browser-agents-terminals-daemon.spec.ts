/**
 * Browser VoiceTree — agents + terminals daemon round-trip (QA slice B).
 *
 * Builds on browser-vt-direct-daemon.spec.ts (keystroke round-trip, registry
 * SSE, headless spawn) and proves the AGENT-spawn and send-text paths that the
 * old suite never exercised end-to-end against REAL daemons:
 *
 *   1. Spawn an agent ON a node → the agent's context node APPEARS in the graph
 *      AND the agent process's own stdout STREAMS over the WS relay as decoded
 *      bytes (not the raw {"type":"data"} envelope).
 *   2. sendTextToTerminal → the injected text LANDS on the pane's pty and
 *      round-trips back over the same relay.
 *   3. spawnPlainTerminal → publishes a terminal-ui-launch event carrying a
 *      live, attachable terminalId.
 *
 * Determinism: we register a deterministic e2e agent (a bounded echo loop) via
 * the browser-safe saveSettings allowlist instead of launching the real default
 * `claude` agent — so the streamed bytes are a known marker, attach-timing is
 * irrelevant (the loop emits continuously), and no real coding agent runs. We
 * listen on the terminal-registry SSE for terminal-ui-launch BEFORE attaching,
 * poll every assertion with a deadline (no arbitrary sleeps beyond letting a
 * shell prompt settle), and detach + close every terminal we open.
 */

import {test, expect} from '@playwright/test'
import {
  loadDaemonConfig,
  injectConfig,
  waitForHostApiReady,
} from './vt-e2e-helpers.ts'

// Shared structural types for the page.evaluate closures. The HostAPI is the
// real window.hostAPI installed by browserRuntime.ts; we narrow only the
// methods each test touches.
type RegistryPayload = {event?: {type?: string; terminalData?: {terminalId?: string}}}

test.describe('Browser VoiceTree — agents + terminals (daemon round-trip)', () => {

  test('agent spawn: context node appears in graph AND agent stdout streams over the WS relay', async ({page}) => {
    const cfg = loadDaemonConfig()
    await injectConfig(page, cfg)
    await page.goto('/')
    await waitForHostApiReady(page)

    const marker = `VT_AGENT_${Date.now()}`
    // Bounded loop (≤ ~5 min) so the pane self-terminates even if cleanup is
    // skipped; emits the marker every 0.5s so the WS attach always catches it.
    const agentCommand = `i=0; while [ $i -lt 600 ]; do echo ${marker}; sleep 0.5; i=$((i+1)); done`

    const result = await page.evaluate(async ({projectPath, agentCommand, marker}) => {
      type HostApi = {
        on: (ch: string, cb: (data: unknown) => void) => void
        main: {
          openProject: (p: string) => Promise<unknown>
          getGraph: () => Promise<{nodes?: Record<string, unknown>}>
          getNode: (id: string) => Promise<unknown>
          loadSettings: () => Promise<{agents?: ReadonlyArray<{name: string; command: string}>}>
          saveSettings: (s: unknown) => Promise<boolean>
          spawnTerminalWithContextNode: (req: unknown) => Promise<{terminalId: string; contextNodeId: string}>
          closeHeadlessAgent: (req: unknown) => Promise<unknown>
          removeTerminalFromRegistry: (req: unknown) => Promise<unknown>
        }
        terminal: {
          attach: (terminalId: string) => Promise<string>
          onData: (handle: string, cb: (chunk: string) => void) => () => void
          detach: (handle: string) => Promise<boolean>
        }
      }
      const api = (window as unknown as {hostAPI: HostApi}).hostAPI
      await api.main.openProject(projectPath)

      // Register the deterministic e2e agent through the browser-safe write
      // allowlist (agents is allowlisted). resolveAgentCommand on the daemon
      // validates agentCommand ∈ settings.agents, so it must be persisted first.
      const settings = await api.main.loadSettings()
      const agents = [...(settings.agents ?? []), {name: 'E2E Stream Agent', command: agentCommand}]
      await api.main.saveSettings({...settings, agents})

      // Anchor to a real (non-folder) task node.
      const graph = await api.main.getGraph()
      const taskNodeId = Object.keys(graph.nodes ?? {}).find((id) => !id.endsWith('/'))
      if (!taskNodeId) return {error: 'no task node in graph'}

      // Capture terminal-ui-launch events so we can wait for OUR terminal's pane
      // to go live (it is created daemon-side BEFORE the event is published).
      const launched = new Set<string>()
      api.on('terminal-registry', (data) => {
        const ev = (data as RegistryPayload)?.event
        if (ev?.type === 'terminal-ui-launch' && ev.terminalData?.terminalId) {
          launched.add(ev.terminalData.terminalId)
        }
      })

      const spawn = await api.main.spawnTerminalWithContextNode({
        taskNodeId, agentCommand, callerTerminalId: 'browser-agent-stream-test',
      })
      const {terminalId, contextNodeId} = spawn
      if (!terminalId || !contextNodeId) return {error: 'spawn returned no ids'}

      // OBSERVABLE 1: the agent's context node appears in the graph.
      const launchDeadline = Date.now() + 15_000
      while (Date.now() < launchDeadline && !launched.has(terminalId)) {
        await new Promise((r) => setTimeout(r, 100))
      }
      const sawLaunch = launched.has(terminalId)

      const node = await api.main.getNode(contextNodeId)
      const graphAfter = await api.main.getGraph()
      const inGraph = Boolean((graphAfter.nodes ?? {})[contextNodeId])

      // OBSERVABLE 2: the agent's stdout streams over the WS relay as decoded bytes.
      const handle = await api.terminal.attach(terminalId)
      let buf = ''
      api.terminal.onData(handle, (chunk) => {buf += chunk})
      const streamDeadline = Date.now() + 15_000
      while (Date.now() < streamDeadline && !buf.includes(marker)) {
        await new Promise((r) => setTimeout(r, 100))
      }
      const sawMarker = buf.includes(marker)
      const sawRawEnvelope = buf.includes('"type":"data"') || buf.includes('"payload"')

      await api.terminal.detach(handle)
      await api.main.closeHeadlessAgent({terminalId}).catch(() => undefined)
      await api.main.removeTerminalFromRegistry({terminalId}).catch(() => undefined)

      return {
        contextNodeId,
        nodeFound: node !== null && node !== undefined,
        inGraph,
        sawLaunch,
        sawMarker,
        sawRawEnvelope,
        underProject: contextNodeId.startsWith(projectPath),
      }
    }, {projectPath: cfg.projectPath, agentCommand, marker})

    expect(result.error, `setup failed: ${result.error ?? ''}`).toBeUndefined()
    expect(result.sawLaunch, 'agent terminal must publish terminal-ui-launch on the registry SSE').toBe(true)
    expect(result.nodeFound, 'agent context node must be readable via getNode').toBe(true)
    expect(result.inGraph, 'agent context node must appear in the projected graph').toBe(true)
    expect(result.underProject, 'context node id must be under the project path').toBe(true)
    expect(result.sawMarker, 'agent stdout must stream to the browser over the WS relay').toBe(true)
    expect(result.sawRawEnvelope, 'onData must deliver decoded bytes, not the raw relay envelope').toBe(false)
  })

  test('sendTextToTerminal: injected text lands on the pty and round-trips over the relay', async ({page}) => {
    const cfg = loadDaemonConfig()
    await injectConfig(page, cfg)
    await page.goto('/')
    await waitForHostApiReady(page)

    const marker = `VTSEND${Date.now()}` // no whitespace — survives sanitizeTerminalInput
    const result = await page.evaluate(async (marker) => {
      type HostApi = {
        on: (ch: string, cb: (data: unknown) => void) => void
        main: {
          getGraph: () => Promise<{nodes?: Record<string, unknown>}>
          spawnPlainTerminal: (req: unknown) => Promise<unknown>
          sendTextToTerminal: (req: unknown) => Promise<{success?: boolean; error?: string}>
        }
        terminal: {
          attach: (terminalId: string) => Promise<string>
          onData: (handle: string, cb: (chunk: string) => void) => () => void
          detach: (handle: string) => Promise<boolean>
        }
      }
      const api = (window as unknown as {hostAPI: HostApi}).hostAPI

      const graph = await api.main.getGraph()
      const nodeId = Object.keys(graph.nodes ?? {}).find((id) => !id.endsWith('/'))
      if (!nodeId) return {error: 'no task node in graph'}

      const terminalIdPromise = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no terminal-ui-launch within 10s')), 10_000)
        api.on('terminal-registry', (data) => {
          const ev = (data as RegistryPayload)?.event
          if (ev?.type === 'terminal-ui-launch' && ev.terminalData?.terminalId) {
            clearTimeout(timer)
            resolve(ev.terminalData.terminalId)
          }
        })
      })
      await api.main.spawnPlainTerminal({nodeId, terminalCount: 0})
      const terminalId = await terminalIdPromise

      const handle = await api.terminal.attach(terminalId)
      let buf = ''
      api.terminal.onData(handle, (chunk) => {buf += chunk})
      await new Promise((r) => setTimeout(r, 1000)) // let the shell prompt settle

      const sendResult = await api.main.sendTextToTerminal({terminalId, text: marker})

      const deadline = Date.now() + 15_000
      while (Date.now() < deadline && !buf.includes(marker)) {
        await new Promise((r) => setTimeout(r, 100))
      }
      const sawMarker = buf.includes(marker)
      const sawRawEnvelope = buf.includes('"type":"data"') || buf.includes('"payload"')

      await api.terminal.detach(handle)
      return {sendSuccess: sendResult?.success !== false, sawMarker, sawRawEnvelope}
    }, marker)

    expect(result.error, `setup failed: ${result.error ?? ''}`).toBeUndefined()
    expect(result.sendSuccess, 'sendTextToTerminal must report success').toBe(true)
    expect(result.sawMarker, 'injected text must land on the pty and round-trip back over the relay').toBe(true)
    expect(result.sawRawEnvelope, 'onData must deliver decoded bytes, not the raw relay envelope').toBe(false)
  })

  test('spawnPlainTerminal: publishes a live, attachable terminal', async ({page}) => {
    const cfg = loadDaemonConfig()
    await injectConfig(page, cfg)
    await page.goto('/')
    await waitForHostApiReady(page)

    const result = await page.evaluate(async () => {
      type HostApi = {
        on: (ch: string, cb: (data: unknown) => void) => void
        main: {
          getGraph: () => Promise<{nodes?: Record<string, unknown>}>
          spawnPlainTerminal: (req: unknown) => Promise<unknown>
        }
        terminal: {
          attach: (terminalId: string) => Promise<string>
          detach: (handle: string) => Promise<boolean>
        }
      }
      const api = (window as unknown as {hostAPI: HostApi}).hostAPI

      const graph = await api.main.getGraph()
      const nodeId = Object.keys(graph.nodes ?? {}).find((id) => !id.endsWith('/'))
      if (!nodeId) return {error: 'no task node in graph'}

      const terminalIdPromise = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no terminal-ui-launch within 10s')), 10_000)
        api.on('terminal-registry', (data) => {
          const ev = (data as RegistryPayload)?.event
          if (ev?.type === 'terminal-ui-launch' && ev.terminalData?.terminalId) {
            clearTimeout(timer)
            resolve(ev.terminalData.terminalId)
          }
        })
      })
      await api.main.spawnPlainTerminal({nodeId, terminalCount: 0})
      const terminalId = await terminalIdPromise

      // Attach returns a non-empty handle only when the WS lands on a live tmux
      // session (the relay does not create one).
      const handle = await api.terminal.attach(terminalId)
      const detached = await api.terminal.detach(handle)
      return {terminalId, handleOk: typeof handle === 'string' && handle.length > 0, detached}
    })

    expect(result.error, `setup failed: ${result.error ?? ''}`).toBeUndefined()
    expect(typeof result.terminalId).toBe('string')
    expect(result.handleOk, 'attach must return a handle for a live plain terminal').toBe(true)
    expect(result.detached).toBe(true)
  })

})

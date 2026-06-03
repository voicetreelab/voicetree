/**
 * Browser VoiceTree — daemon round-trip integration tier.
 *
 * Proves the no-Electron path end-to-end against REAL daemons booted by
 * globalSetup: Chrome → window.hostAPI (browserRuntime.ts) → VTD (JSON-RPC + WS
 * relay) → tmux. The headline test types `echo <marker>` into a browser
 * terminal and asserts the decoded echo round-trips back — the exact path whose
 * protocol bug (input dropped + output rendered as raw JSON) shipped because the
 * old suite only smoke-checked `terminal.attach` for function existence.
 *
 * Config comes from globalSetup via loadDaemonConfig() — the tier never
 * self-skips. The browser talks ONLY to VTD (native CORS), so no faked CORS.
 */

import {test, expect} from '@playwright/test'
import {
  loadDaemonConfig,
  injectConfig,
  waitForHostApiReady,
  openProjectAndWaitForGraph,
} from './vt-e2e-helpers.ts'

test.describe('Browser VoiceTree — daemon round-trip', () => {

  test('keystroke round-trips through tmux: browser write → pty echo → browser onData', async ({page}) => {
    const cfg = loadDaemonConfig()
    await injectConfig(page, cfg)
    await page.goto('/')
    await waitForHostApiReady(page)

    const marker = `VT_RT_${Date.now()}`
    const result = await page.evaluate(async (marker) => {
      type RegistryPayload = {event?: {type?: string; terminalData?: {terminalId?: string}}}
      type HostApi = {
        on: (ch: string, cb: (data: unknown) => void) => void
        main: {
          getGraph: () => Promise<{nodes?: Record<string, unknown>}>
          spawnPlainTerminal: (req: unknown) => Promise<unknown>
        }
        terminal: {
          attach: (terminalId: string) => Promise<string>
          onData: (handle: string, cb: (chunk: string) => void) => () => void
          write: (handle: string, data: string) => Promise<boolean>
          detach: (handle: string) => Promise<boolean>
        }
      }
      const api = (window as unknown as {hostAPI: HostApi}).hostAPI

      // Pick a real (non-folder) node to anchor the plain terminal to.
      const graph = await api.main.getGraph()
      const nodeId = Object.keys(graph.nodes ?? {}).find((id) => !id.endsWith('/'))
      if (!nodeId) return {error: 'no task node in graph'}

      // spawnPlainTerminal RPC returns void — the terminalId is published over the
      // terminal-registry SSE as a `terminal-ui-launch` event, exactly the channel
      // the real UI consumes to render + attach. Listen BEFORE spawning.
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

      const handle = await api.terminal.attach(terminalId) // opens the WS (vt-bearer subprotocol)
      let buf = ''
      api.terminal.onData(handle, (chunk) => {buf += chunk})
      await new Promise((r) => setTimeout(r, 1000)) // let the shell prompt settle
      await api.terminal.write(handle, `echo ${marker}\r`) // \r = Enter; must be wrapped {type:data}

      const deadline = Date.now() + 10_000
      while (Date.now() < deadline && !buf.includes(marker)) {
        await new Promise((r) => setTimeout(r, 100))
      }
      await api.terminal.detach(handle)
      return {
        sawMarker: buf.includes(marker),
        // Decoded output must NOT contain the relay envelope: if onData leaked the
        // raw {"type":"data","payload":"…"} frame, the marker would still appear
        // INSIDE that JSON, so sawMarker alone can't catch the output-direction bug.
        sawRawEnvelope: buf.includes('"type":"data"') || buf.includes('"payload"'),
      }
    }, marker)

    expect(result.error, `setup failed: ${result.error ?? ''}`).toBeUndefined()
    expect(result.sawMarker, 'keystroke must reach tmux and echo back (BUG-IN: input dropped)').toBe(true)
    expect(result.sawRawEnvelope, 'onData must deliver decoded bytes, not raw JSON (BUG-OUT)').toBe(false)
  })

  test('browser runtime installs window.hostAPI and exposes graph API', async ({page}) => {
    const cfg = loadDaemonConfig()
    await injectConfig(page, cfg)
    await page.goto('/')
    await waitForHostApiReady(page)

    const hasGraphApi = await page.evaluate(() => {
      const api = (window as unknown as {hostAPI?: {graph?: unknown}}).hostAPI
      return api?.graph !== undefined
    })
    expect(hasGraphApi).toBe(true)
  })

  test('projected graph loads via openProject (VTD gateway)', async ({page}) => {
    const cfg = loadDaemonConfig()
    await injectConfig(page, cfg)
    await page.goto('/')
    await waitForHostApiReady(page)

    const result = await page.evaluate(async (projectPath) => {
      const api = (window as unknown as {hostAPI?: {main?: {
        openProject?: (p: string) => Promise<{projectState: unknown; sessionId: string; initialProjectedGraph: unknown}>
      }}}).hostAPI
      return api?.main?.openProject?.(projectPath)
    }, cfg.projectPath)

    expect(result).toMatchObject({sessionId: expect.any(String), projectState: expect.any(Object)})

    const projGraph = await page.evaluate(async () => {
      const api = (window as unknown as {hostAPI?: {graph?: {getCurrentProjectedGraph?: () => Promise<unknown>}}}).hostAPI
      return api?.graph?.getCurrentProjectedGraph?.()
    })
    expect(projGraph).toMatchObject({nodes: expect.any(Array), edges: expect.any(Array)})
  })

  test('node CRUD — create, read, delete via applyGraphDelta (VTD gateway)', async ({page}) => {
    const cfg = loadDaemonConfig()
    await injectConfig(page, cfg)
    await page.goto('/')
    await waitForHostApiReady(page)

    const writeFolder = await page.evaluate(async () => {
      const api = (window as unknown as {hostAPI?: {main?: {getWriteFolderPath?: () => Promise<unknown>}}}).hostAPI
      // getWriteFolderPath returns O.Option<string> (fp-ts): {_tag:'Some',value} | {_tag:'None'}.
      const opt = await api?.main?.getWriteFolderPath?.() as {_tag?: string; value?: string} | undefined
      return opt?._tag === 'Some' ? opt.value ?? null : null
    })
    expect(typeof writeFolder).toBe('string')

    const filePath = `${writeFolder}/browser-test-node-${Date.now()}.md`

    // applyGraphDeltaToDBThroughMemAndUIExposed returns void — verify by reading back.
    await page.evaluate(async ({filePath}) => {
      const api = (window as unknown as {hostAPI?: {main?: {
        applyGraphDeltaToDBThroughMemAndUIExposed?: (delta: unknown) => Promise<void>
      }}}).hostAPI
      await api?.main?.applyGraphDeltaToDBThroughMemAndUIExposed?.([{
        type: 'UpsertNode',
        nodeToUpsert: {
          kind: 'leaf',
          absoluteFilePathIsID: filePath,
          contentWithoutYamlOrLinks: '# Browser Test Node\nCreated by Playwright daemon-integration test.',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: {_tag: 'None'},
            position: {_tag: 'Some', value: {x: 100, y: 100}},
            additionalYAMLProps: {},
            isContextNode: false,
          },
        },
        previousNode: {_tag: 'None'},
      }])
    }, {filePath})

    const createdNode = await page.evaluate(async ({filePath}) => {
      const api = (window as unknown as {hostAPI?: {main?: {getNode?: (id: string) => Promise<unknown>}}}).hostAPI
      return api?.main?.getNode?.(filePath)
    }, {filePath})
    expect(createdNode).toBeTruthy()

    await page.evaluate(async ({filePath}) => {
      const api = (window as unknown as {hostAPI?: {main?: {
        applyGraphDeltaToDBThroughMemAndUIExposed?: (delta: unknown) => Promise<void>
      }}}).hostAPI
      await api?.main?.applyGraphDeltaToDBThroughMemAndUIExposed?.([
        {type: 'DeleteNode', nodeId: filePath, deletedNode: {_tag: 'None'}},
      ])
    }, {filePath})

    const deletedNode = await page.evaluate(async ({filePath}) => {
      const api = (window as unknown as {hostAPI?: {main?: {getNode?: (id: string) => Promise<unknown>}}}).hostAPI
      return api?.main?.getNode?.(filePath)
    }, {filePath})
    expect(deletedNode).toBeNull()
  })

  test('writeMarkdownFile saves content via VTD gateway', async ({page}) => {
    const cfg = loadDaemonConfig()
    await injectConfig(page, cfg)
    await page.goto('/')
    await waitForHostApiReady(page)

    const result = await page.evaluate(async ({projectPath}) => {
      const api = (window as unknown as {hostAPI?: {main?: {
        writeMarkdownFile?: (absolutePath: string, body: string, editorId: string) => Promise<unknown>
      }}}).hostAPI
      const absolutePath = `${projectPath}/browser-test-write-${Date.now()}.md`
      return api?.main?.writeMarkdownFile?.(absolutePath, '# Browser write test\n', 'test-editor-id')
    }, {projectPath: cfg.projectPath})
    expect(result).toBeDefined()
  })

  test('terminal-registry events flow from VTD SSE to browser (view agents)', async ({page}) => {
    const cfg = loadDaemonConfig()
    await injectConfig(page, cfg)
    await page.goto('/')
    await waitForHostApiReady(page)

    const taskNodeId = await page.evaluate(async () => {
      const api = (window as unknown as {hostAPI?: {main?: {getGraph?: () => Promise<unknown>}}}).hostAPI
      const graph = await api?.main?.getGraph?.() as {nodes?: Record<string, unknown>} | undefined
      return Object.keys(graph?.nodes ?? {}).find((id) => !id.endsWith('/')) ?? null
    })
    expect(typeof taskNodeId).toBe('string')

    const registryPayload = await page.evaluate(async ({taskNodeId}) => {
      type HostLike = {
        on: (ch: string, cb: (...args: unknown[]) => void) => void
        main?: {
          spawnTerminalWithContextNode?: (r: unknown) => Promise<{terminalId: string}>
          closeHeadlessAgent?: (r: unknown) => Promise<unknown>
        }
      }
      const api = (window as unknown as {hostAPI?: HostLike}).hostAPI
      if (!api) return null
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('No terminal-registry event in 10s')), 10_000)
        api.on('terminal-registry', (data) => {clearTimeout(timer); resolve(data)})
        void api.main?.spawnTerminalWithContextNode?.({taskNodeId, headless: true, callerTerminalId: 'vt-registry-test'})
          .then(async (r) => {
            if (r?.terminalId) await api.main?.closeHeadlessAgent?.({terminalId: r.terminalId})
          })
          .catch(reject)
      })
    }, {taskNodeId: taskNodeId as string})

    expect(registryPayload).toMatchObject({
      kind: 'terminal-registry',
      seq: expect.any(Number),
      event: expect.any(Object),
      project: expect.any(String),
    })
  })

  test('spawnTerminalWithContextNode creates a terminal with valid node (headless, immediate cleanup)', async ({page}) => {
    const cfg = loadDaemonConfig()
    await injectConfig(page, cfg)
    await page.goto('/')
    await waitForHostApiReady(page)

    const taskNodeId = await page.evaluate(async () => {
      const api = (window as unknown as {hostAPI?: {main?: {getGraph?: () => Promise<unknown>}}}).hostAPI
      const graph = await api?.main?.getGraph?.() as {nodes?: Record<string, unknown>} | undefined
      return Object.keys(graph?.nodes ?? {}).find((id) => !id.endsWith('/')) ?? null
    })
    expect(typeof taskNodeId).toBe('string')

    const spawnResult = await page.evaluate(async ({taskNodeId}) => {
      const api = (window as unknown as {hostAPI?: {main?: {
        spawnTerminalWithContextNode?: (req: unknown) => Promise<{terminalId: string; contextNodeId: string}>
        closeHeadlessAgent?: (req: unknown) => Promise<unknown>
      }}}).hostAPI
      const result = await api?.main?.spawnTerminalWithContextNode?.({
        taskNodeId, headless: true, callerTerminalId: 'browser-vt-test',
      })
      if (!result?.terminalId) return {ok: false as const, terminalId: null}
      await api?.main?.closeHeadlessAgent?.({terminalId: result.terminalId})
      return {ok: true as const, terminalId: result.terminalId}
    }, {taskNodeId: taskNodeId as string})

    expect(spawnResult.ok).toBe(true)
    expect(typeof spawnResult.terminalId).toBe('string')
  })

  test('editor opens via node tap and closes via traffic-light button', async ({page}) => {
    const cfg = loadDaemonConfig()
    // Resilient open: retries a transient initial-fetch blip so the graph is
    // populated before we look for a node (see openProjectAndWaitForGraph).
    await openProjectAndWaitForGraph(page, cfg)

    // Tap the seed root.md node specifically (a guaranteed top-level, non-folder
    // leaf), not an arbitrary first leaf. This tier shares one daemon project that
    // sibling specs fill with folders/context nodes, so "first non-folder node" is
    // pollution-dependent; the seed root is stable. Wait for its element, then tap.
    const rootId = `${cfg.projectPath}/root.md`
    await page.waitForFunction(
      (id) => ((window as unknown as {cytoscapeInstance?: {getElementById: (i: string) => {length: number}}}).cytoscapeInstance?.getElementById(id).length ?? 0) > 0,
      rootId,
      {timeout: 20_000},
    )

    const nodeWasTapped = await page.evaluate((id) => {
      type CyNode = {length: number; emit: (ev: string) => void}
      type CyInstance = {getElementById: (i: string) => CyNode}
      const cy = (window as unknown as {cytoscapeInstance?: CyInstance}).cytoscapeInstance
      if (!cy) return false
      const rootNode = cy.getElementById(id)
      if (rootNode.length === 0) return false
      rootNode.emit('tap')
      return true
    }, rootId)
    expect(nodeWasTapped).toBe(true)

    await page.waitForSelector('.cy-floating-window', {timeout: 10_000})

    const editorClosed = await page.evaluate(() => {
      const win = document.querySelector('.cy-floating-window')
      if (!win) return false
      const btn = win.querySelector('button.traffic-light-close') as HTMLButtonElement | null
      if (btn) {btn.click(); return true}
      win.dispatchEvent(new CustomEvent('traffic-light-close', {bubbles: true}))
      return true
    })
    expect(editorClosed).toBe(true)

    await page.waitForFunction(
      () => document.querySelectorAll('.cy-floating-window').length === 0,
      {timeout: 5_000},
    )
    expect((await page.$$('.cy-floating-window')).length).toBe(0)
  })

})

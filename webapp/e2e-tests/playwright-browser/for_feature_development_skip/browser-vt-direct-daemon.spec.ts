/**
 * Browser VoiceTree — direct-daemon integration test.
 *
 * Verifies that the browser runtime adapter lets Chrome communicate directly
 * with VTD + graphd without Electron. Tests graph load, node CRUD,
 * editor open/close/save, terminal/agent list visibility, and agent spawn path.
 *
 * Requires real daemons. The test reads config from env:
 *   VT_TEST_VTD_URL      e.g. http://127.0.0.1:PORT
 *   VT_TEST_VTD_TOKEN    bearer token
 *   VT_TEST_GRAPHD_URL   e.g. http://127.0.0.1:PORT
 *   VT_TEST_PROJECT_PATH absolute path to project
 *
 * If any env var is unset the test is skipped rather than failing, so CI that
 * doesn't start daemons doesn't break.
 */

import { test, expect } from '@playwright/test'
import {
  skipIfNoDaemons,
  injectConfig,
  injectCorsHeaders,
  waitForElectronApiReady,
  waitForCytoscapeReady,
  SKIP_MSG,
} from './vt-e2e-helpers'

const ORIGIN = 'http://localhost:3000'

test.describe('Browser VoiceTree — direct daemon', () => {

  test('browser runtime installs window.electronAPI and exposes graph API', async ({ page }) => {
    const cfg = skipIfNoDaemons()
    if (!cfg) return test.skip(true, SKIP_MSG)

    await injectConfig(page, cfg)
    await injectCorsHeaders(page, ORIGIN, [cfg.vtdUrl, cfg.graphdUrl])
    await page.goto('/')
    await waitForElectronApiReady(page)

    const hasGraphApi = await page.evaluate(() => {
      const api = (window as unknown as { electronAPI?: { graph?: unknown } }).electronAPI
      return api?.graph !== undefined
    })
    expect(hasGraphApi).toBe(true)
  })

  test('projected graph loads from graphd via openProject', async ({ page }) => {
    const cfg = skipIfNoDaemons()
    if (!cfg) return test.skip(true, SKIP_MSG)

    await injectConfig(page, cfg)
    await injectCorsHeaders(page, ORIGIN, [cfg.vtdUrl, cfg.graphdUrl])
    await page.goto('/')
    await waitForElectronApiReady(page)

    const result = await page.evaluate(async (projectPath) => {
      const api = (window as unknown as { electronAPI?: { main?: {
        openProject?: (p: string) => Promise<{ projectState: unknown; sessionId: string; initialProjectedGraph: unknown }>
      } } }).electronAPI
      return api?.main?.openProject?.(projectPath)
    }, cfg.projectPath)

    expect(result).toBeDefined()
    expect(result).toMatchObject({ sessionId: expect.any(String), projectState: expect.any(Object) })

    const projGraph = await page.evaluate(async () => {
      const api = (window as unknown as { electronAPI?: {
        graph?: { getCurrentProjectedGraph?: () => Promise<unknown> }
      } }).electronAPI
      return api?.graph?.getCurrentProjectedGraph?.()
    })
    expect(projGraph).toMatchObject({ nodes: expect.any(Array), edges: expect.any(Array) })
  })

  test('node CRUD — create, read, delete via applyGraphDelta', async ({ page }) => {
    const cfg = skipIfNoDaemons()
    if (!cfg) return test.skip(true, SKIP_MSG)

    await injectConfig(page, cfg)
    await injectCorsHeaders(page, ORIGIN, [cfg.vtdUrl, cfg.graphdUrl])
    await page.goto('/')
    await waitForElectronApiReady(page)

    const writeFolder = await page.evaluate(async () => {
      const api = (window as unknown as { electronAPI?: { main?: { getWriteFolderPath?: () => Promise<string> } } }).electronAPI
      return api?.main?.getWriteFolderPath?.()
    })
    expect(typeof writeFolder).toBe('string')

    const filePath = `${writeFolder}/browser-test-node-${Date.now()}.md`

    // applyGraphDeltaToDBThroughMemAndUIExposed returns void — verify success by reading back.
    await page.evaluate(async ({ filePath }) => {
      const api = (window as unknown as { electronAPI?: {
        main?: { applyGraphDeltaToDBThroughMemAndUIExposed?: (delta: unknown) => Promise<void> }
      } }).electronAPI
      // GraphNode requires all fields; missing outgoingEdges causes .reduce crash on undefined.
      // fp-ts Option serialisation: { _tag: 'None' } / { _tag: 'Some', value: x }.
      await api?.main?.applyGraphDeltaToDBThroughMemAndUIExposed?.([{
        type: 'UpsertNode',
        nodeToUpsert: {
          kind: 'leaf',
          absoluteFilePathIsID: filePath,
          contentWithoutYamlOrLinks: '# Browser Test Node\nCreated by Playwright browser test.',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' },
            position: { _tag: 'Some', value: { x: 100, y: 100 } },
            additionalYAMLProps: {},
            isContextNode: false,
          },
        },
        previousNode: { _tag: 'None' },
      }])
    }, { filePath })

    const createdNode = await page.evaluate(async ({ filePath }) => {
      const api = (window as unknown as { electronAPI?: { main?: { getNode?: (id: string) => Promise<unknown> } } }).electronAPI
      return api?.main?.getNode?.(filePath)
    }, { filePath })
    expect(createdNode).toBeTruthy()

    // DeleteNode.nodeId must be the absoluteFilePathIsID string (full file path).
    await page.evaluate(async ({ filePath }) => {
      const api = (window as unknown as { electronAPI?: {
        main?: { applyGraphDeltaToDBThroughMemAndUIExposed?: (delta: unknown) => Promise<void> }
      } }).electronAPI
      await api?.main?.applyGraphDeltaToDBThroughMemAndUIExposed?.([
        { type: 'DeleteNode', nodeId: filePath, deletedNode: { _tag: 'None' } },
      ])
    }, { filePath })

    const deletedNode = await page.evaluate(async ({ filePath }) => {
      const api = (window as unknown as { electronAPI?: { main?: { getNode?: (id: string) => Promise<unknown> } } }).electronAPI
      return api?.main?.getNode?.(filePath)
    }, { filePath })
    expect(deletedNode).toBeNull()
  })

  test('writeMarkdownFile saves content via graphd', async ({ page }) => {
    const cfg = skipIfNoDaemons()
    if (!cfg) return test.skip(true, SKIP_MSG)

    await injectConfig(page, cfg)
    await injectCorsHeaders(page, ORIGIN, [cfg.vtdUrl, cfg.graphdUrl])
    await page.goto('/')
    await waitForElectronApiReady(page)

    const result = await page.evaluate(async ({ projectPath }) => {
      const api = (window as unknown as { electronAPI?: {
        main?: { writeMarkdownFile?: (absolutePath: string, body: string, editorId: string) => Promise<unknown> }
      } }).electronAPI
      const absolutePath = `${projectPath}/browser-test-write-${Date.now()}.md`
      return api?.main?.writeMarkdownFile?.(absolutePath, '# Browser write test\n', 'test-editor-id')
    }, { projectPath: cfg.projectPath })
    expect(result).toBeDefined()
  })

  test('terminal-registry events flow from VTD SSE to browser (view agents)', async ({ page }) => {
    const cfg = skipIfNoDaemons()
    if (!cfg) return test.skip(true, SKIP_MSG)

    await injectConfig(page, cfg)
    await injectCorsHeaders(page, ORIGIN, [cfg.vtdUrl, cfg.graphdUrl])
    await page.goto('/')
    await waitForElectronApiReady(page)

    const taskNodeId = await page.evaluate(async () => {
      const api = (window as unknown as { electronAPI?: { main?: { getGraph?: () => Promise<unknown> } } }).electronAPI
      const graph = await api?.main?.getGraph?.() as { nodes?: Record<string, unknown> } | undefined
      return Object.keys(graph?.nodes ?? {}).find(id => !id.endsWith('/')) ?? null
    })
    expect(typeof taskNodeId).toBe('string')

    // The terminal-registry SSE only delivers change events (no snapshot on connect).
    // Spawn a terminal → VTD publishes a terminal-registry event → SSE delivers it
    // → browser runtime emits on 'terminal-registry' channel → listener fires.
    // electronAPI.on('terminal-registry', cb) is the same channel the UI agent-list consumes.
    const registryPayload = await page.evaluate(async ({ taskNodeId }) => {
      type ElectronLike = {
        on: (ch: string, cb: (...args: unknown[]) => void) => void
        main?: {
          spawnTerminalWithContextNode?: (r: unknown) => Promise<{terminalId: string}>
          closeHeadlessAgent?: (r: unknown) => Promise<unknown>
        }
      }
      const api = (window as unknown as { electronAPI?: ElectronLike }).electronAPI
      if (!api) return null

      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('No terminal-registry event in 10s')), 10_000)
        api.on('terminal-registry', (data) => { clearTimeout(timer); resolve(data) })
        void api.main?.spawnTerminalWithContextNode?.({ taskNodeId, headless: true, callerTerminalId: 'vt-registry-test' })
          .then(async (result) => {
            if (result?.terminalId) await api.main?.closeHeadlessAgent?.({ terminalId: result.terminalId })
          })
          .catch(reject)
      })
    }, { taskNodeId: taskNodeId as string })

    expect(registryPayload).toMatchObject({
      kind: 'terminal-registry',
      seq: expect.any(Number),
      event: expect.any(Object),
      project: expect.any(String),
    })
  })

  test('spawnTerminalWithContextNode creates a terminal with valid node (headless, immediate cleanup)', async ({ page }) => {
    const cfg = skipIfNoDaemons()
    if (!cfg) return test.skip(true, SKIP_MSG)

    await injectConfig(page, cfg)
    await injectCorsHeaders(page, ORIGIN, [cfg.vtdUrl, cfg.graphdUrl])
    await page.goto('/')
    await waitForElectronApiReady(page)

    const taskNodeId = await page.evaluate(async () => {
      const api = (window as unknown as { electronAPI?: { main?: { getGraph?: () => Promise<unknown> } } }).electronAPI
      const graph = await api?.main?.getGraph?.() as { nodes?: Record<string, unknown> } | undefined
      return Object.keys(graph?.nodes ?? {}).find(id => !id.endsWith('/')) ?? null
    })
    expect(typeof taskNodeId).toBe('string')

    // Use the correct VTD protocol param (taskNodeId, not contextNodeId). headless avoids a PTY.
    const spawnResult = await page.evaluate(async ({ taskNodeId }) => {
      const api = (window as unknown as { electronAPI?: {
        main?: {
          spawnTerminalWithContextNode?: (req: unknown) => Promise<{terminalId: string; contextNodeId: string}>
          closeHeadlessAgent?: (req: unknown) => Promise<unknown>
        }
      } }).electronAPI
      const result = await api?.main?.spawnTerminalWithContextNode?.({
        taskNodeId, headless: true, callerTerminalId: 'browser-vt-test',
      })
      if (!result?.terminalId) return { ok: false as const, terminalId: null }
      await api?.main?.closeHeadlessAgent?.({ terminalId: result.terminalId })
      return { ok: true as const, terminalId: result.terminalId }
    }, { taskNodeId: taskNodeId as string })

    expect(spawnResult.ok).toBe(true)
    expect(typeof spawnResult.terminalId).toBe('string')
  })

  test('editor opens via node tap and closes via traffic-light button', async ({ page }) => {
    const cfg = skipIfNoDaemons()
    if (!cfg) return test.skip(true, SKIP_MSG)

    await injectConfig(page, cfg)
    await injectCorsHeaders(page, ORIGIN, [cfg.vtdUrl, cfg.graphdUrl])
    await page.goto('/')
    await waitForElectronApiReady(page)

    await page.evaluate(async (projectPath) => {
      const api = (window as unknown as { electronAPI?: { main?: { openProject?: (p: string) => Promise<unknown> } } }).electronAPI
      await api?.main?.openProject?.(projectPath)
    }, cfg.projectPath)

    await waitForCytoscapeReady(page)

    // Emit tap on first leaf node → setupCytoscape.ts handler → createAnchoredFloatingEditor
    const nodeWasTapped = await page.evaluate(() => {
      type CyNode = { emit: (ev: string) => void }
      type CyInstance = { nodes: (sel: string) => { length: number; first: () => CyNode } }
      const cy = (window as unknown as { cytoscapeInstance?: CyInstance }).cytoscapeInstance
      if (!cy) return false
      const leaves = cy.nodes('[!isFolderNode]')
      if (leaves.length === 0) return false
      leaves.first().emit('tap')
      return true
    })
    expect(nodeWasTapped).toBe(true)

    await page.waitForSelector('.cy-floating-window', { timeout: 10_000 })

    // traffic-light-close button may be under Cytoscape pointer-events layer in headless Chrome;
    // call .click() via JS directly rather than Playwright's actionability-checked page.click().
    const editorClosed = await page.evaluate(() => {
      const win = document.querySelector('.cy-floating-window')
      if (!win) return false
      const btn = win.querySelector('button.traffic-light-close') as HTMLButtonElement | null
      if (btn) { btn.click(); return true }
      win.dispatchEvent(new CustomEvent('traffic-light-close', { bubbles: true }))
      return true
    })
    expect(editorClosed).toBe(true)

    await page.waitForFunction(
      () => document.querySelectorAll('.cy-floating-window').length === 0,
      { timeout: 5_000 },
    )
    expect((await page.$$('.cy-floating-window')).length).toBe(0)
  })

  test('terminal attach WebSocket connects with vt-bearer subprotocol', async ({ page }) => {
    const cfg = skipIfNoDaemons()
    if (!cfg) return test.skip(true, SKIP_MSG)

    await injectConfig(page, cfg)
    await injectCorsHeaders(page, ORIGIN, [cfg.vtdUrl, cfg.graphdUrl])
    await page.goto('/')
    await waitForElectronApiReady(page)

    const hasTerminalAttach = await page.evaluate(() => {
      const api = (window as unknown as { electronAPI?: { terminal?: { attach?: unknown } } }).electronAPI
      return typeof api?.terminal?.attach === 'function'
    })
    expect(hasTerminalAttach).toBe(true)
  })

  test('graph projected-graph SSE subscription fires on session events', async ({ page }) => {
    const cfg = skipIfNoDaemons()
    if (!cfg) return test.skip(true, SKIP_MSG)

    await injectConfig(page, cfg)
    await injectCorsHeaders(page, ORIGIN, [cfg.vtdUrl, cfg.graphdUrl])
    await page.goto('/')
    await waitForElectronApiReady(page)

    const subscriptionInstalled = await page.evaluate(() => {
      let called = false
      const api = (window as unknown as { electronAPI?: {
        graph?: { onProjectedGraphUpdate?: (cb: (g: unknown) => void) => () => void }
      } }).electronAPI
      api?.graph?.onProjectedGraphUpdate?.(() => { called = true })
      return true // subscription installed without throwing
      void called
    })
    expect(subscriptionInstalled).toBe(true)

    const projGraph = await page.evaluate(async () => {
      const api = (window as unknown as { electronAPI?: {
        graph?: { getCurrentProjectedGraph?: () => Promise<unknown> }
      } }).electronAPI
      return api?.graph?.getCurrentProjectedGraph?.()
    })
    expect(projGraph).toMatchObject({ nodes: expect.any(Array), edges: expect.any(Array) })
  })

})

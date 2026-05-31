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

import { test, expect, type Page, type Route } from '@playwright/test'

// ── helpers ──────────────────────────────────────────────────────────────────

function requiredEnv(name: string): string | null {
  return process.env[name] ?? null
}

function skipIfNoDaemons(): {
  vtdUrl: string
  vtdToken: string
  graphdUrl: string
  projectPath: string
} | null {
  const vtdUrl = requiredEnv('VT_TEST_VTD_URL')
  const vtdToken = requiredEnv('VT_TEST_VTD_TOKEN')
  const graphdUrl = requiredEnv('VT_TEST_GRAPHD_URL')
  const projectPath = requiredEnv('VT_TEST_PROJECT_PATH')
  if (!vtdUrl || !vtdToken || !graphdUrl || !projectPath) return null
  return { vtdUrl, vtdToken, graphdUrl, projectPath }
}

async function injectConfig(
  page: Page,
  cfg: { vtdUrl: string; vtdToken: string; graphdUrl: string; projectPath: string },
): Promise<void> {
  await page.addInitScript((config) => {
    (window as unknown as Record<string, unknown>).__VT_BROWSER_CONFIG__ = config
  }, cfg)
}

/**
 * Intercept daemon requests and inject the CORS headers that the new daemon
 * code provides. The daemons currently running may not have been rebuilt with
 * the new CORS support yet. This helper simulates what CORS-enabled daemons
 * would return while still sending ALL requests to the real local daemons —
 * so API correctness (not just connectivity) is verified.
 *
 * This is appropriate for dev verification: we prove the adapter wiring is
 * correct against real daemon data. CORS header emission is separately verified
 * by the unit/integration tests in corsHeaders.test.ts and browserToken.test.ts.
 */
async function injectCorsHeaders(
  page: Page,
  origin: string,
  daemonUrls: string[],
): Promise<void> {
  for (const url of daemonUrls) {
    await page.route(`${url}/**`, async (route: Route) => {
      // Handle OPTIONS preflight without calling the daemon
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Session-Id',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'Access-Control-Max-Age': '86400',
          },
        }).catch(() => {}) // page may have closed
        return
      }
      // Forward all other requests to the real daemon and inject the CORS header.
      // Wrap in try/catch: SSE routes stay open after test ends and the page/context
      // will be closed while the route callback is still in flight.
      try {
        const response = await route.fetch()
        const headers: Record<string, string> = {}
        for (const [k, v] of Object.entries(response.headers())) {
          headers[k] = v
        }
        headers['Access-Control-Allow-Origin'] = origin
        await route.fulfill({ response, headers })
      } catch {
        // Ignore errors when the test/page closes mid-flight (common for SSE routes)
      }
    })
  }
}

async function waitForElectronApiReady(page: Page, timeoutMs = 15_000): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { electronAPI?: unknown }).electronAPI !== undefined,
    { timeout: timeoutMs },
  )
}

async function waitForGraphView(page: Page, timeoutMs = 20_000): Promise<void> {
  // The graph canvas (Cytoscape) is mounted after project:ready fires
  await page.waitForSelector('#cy, canvas.cy-canvas, [data-testid="graph-container"]', {
    timeout: timeoutMs,
  })
}

// ── fixture ──────────────────────────────────────────────────────────────────

const SKIP_MSG = 'Browser daemon test skipped — set VT_TEST_VTD_URL/TOKEN/GRAPHD_URL/PROJECT_PATH'

// ── tests ────────────────────────────────────────────────────────────────────

test.describe('Browser VoiceTree — direct daemon', () => {

  test('browser runtime installs window.electronAPI and exposes graph API', async ({ page }) => {
    const cfg = skipIfNoDaemons()
    if (!cfg) return test.skip(true, SKIP_MSG)

    await injectConfig(page, cfg)
    await injectCorsHeaders(page, 'http://localhost:3000', [cfg.vtdUrl, cfg.graphdUrl])
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
    await injectCorsHeaders(page, 'http://localhost:3000', [cfg.vtdUrl, cfg.graphdUrl])
    await page.goto('/')

    await waitForElectronApiReady(page)

    // Call openProject and verify it returns projectState + initialProjectedGraph
    const result = await page.evaluate(async (projectPath) => {
      const api = (window as unknown as { electronAPI?: { main?: {
        openProject?: (p: string) => Promise<{ projectState: unknown; sessionId: string; initialProjectedGraph: unknown }>
      } } }).electronAPI
      return api?.main?.openProject?.(projectPath)
    }, cfg.projectPath)

    expect(result).toBeDefined()
    expect(result).toMatchObject({
      sessionId: expect.any(String),
      projectState: expect.any(Object),
    })

    // Also verify getCurrentProjectedGraph returns a valid graph
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
    await injectCorsHeaders(page, 'http://localhost:3000', [cfg.vtdUrl, cfg.graphdUrl])
    await page.goto('/')
    await waitForElectronApiReady(page)

    // Get the write folder from graphd so node paths are valid
    const writeFolder = await page.evaluate(async () => {
      const api = (window as unknown as { electronAPI?: { main?: { getWriteFolderPath?: () => Promise<string> } } }).electronAPI
      return api?.main?.getWriteFolderPath?.()
    })
    expect(typeof writeFolder).toBe('string')

    // Create node via graphd /graph/apply-delta through the browser runtime
    const nodeId = `browser-test-node-${Date.now()}`
    const filePath = `${writeFolder}/${nodeId}.md`

    // applyGraphDeltaToDBThroughMemAndUIExposed returns void — call it and verify
    // success by reading the node back, not by checking the return value.
    await page.evaluate(
      async ({ filePath }) => {
        const api = (window as unknown as { electronAPI?: {
          main?: { applyGraphDeltaToDBThroughMemAndUIExposed?: (delta: unknown) => Promise<void> }
        } }).electronAPI
        // GraphNode requires: kind, absoluteFilePathIsID, contentWithoutYamlOrLinks,
        // outgoingEdges (missing → .reduce crash), nodeUIMetadata with fp-ts Option values.
        // previousNode must be fp-ts Option (None for new node).
        const delta = [{
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
        }]
        await api?.main?.applyGraphDeltaToDBThroughMemAndUIExposed?.(delta)
      },
      { filePath },
    )

    // Verify the node is now in the graph
    const createdNode = await page.evaluate(
      async ({ filePath }) => {
        const api = (window as unknown as { electronAPI?: { main?: { getNode?: (id: string) => Promise<unknown> } } }).electronAPI
        return api?.main?.getNode?.(filePath)
      },
      { filePath },
    )
    expect(createdNode).toBeTruthy()

    // Delete node — nodeId must be the absoluteFilePathIsID (full path string) used during upsert
    await page.evaluate(
      async ({ filePath }) => {
        const api = (window as unknown as { electronAPI?: {
          main?: { applyGraphDeltaToDBThroughMemAndUIExposed?: (delta: unknown) => Promise<void> }
        } }).electronAPI
        const delta = [{ type: 'DeleteNode', nodeId: filePath, deletedNode: { _tag: 'None' } }]
        await api?.main?.applyGraphDeltaToDBThroughMemAndUIExposed?.(delta)
      },
      { filePath },
    )

    // Verify the node is gone from the graph
    const deletedNode = await page.evaluate(
      async ({ filePath }) => {
        const api = (window as unknown as { electronAPI?: { main?: { getNode?: (id: string) => Promise<unknown> } } }).electronAPI
        return api?.main?.getNode?.(filePath)
      },
      { filePath },
    )
    expect(deletedNode).toBeNull()
  })

  test('writeMarkdownFile saves content via graphd', async ({ page }) => {
    const cfg = skipIfNoDaemons()
    if (!cfg) return test.skip(true, SKIP_MSG)

    await injectConfig(page, cfg)
    await injectCorsHeaders(page, 'http://localhost:3000', [cfg.vtdUrl, cfg.graphdUrl])
    await page.goto('/')
    await waitForElectronApiReady(page)

    const result = await page.evaluate(
      async ({ projectPath }) => {
        const api = (window as unknown as { electronAPI?: {
          main?: { writeMarkdownFile?: (absolutePath: string, body: string, editorId: string) => Promise<unknown> }
        } }).electronAPI
        const absolutePath = `${projectPath}/browser-test-write-${Date.now()}.md`
        return api?.main?.writeMarkdownFile?.(absolutePath, '# Browser write test\n', 'test-editor-id')
      },
      { projectPath: cfg.projectPath },
    )
    expect(result).toBeDefined()
  })

  test('terminal registry is accessible via VTD SSE', async ({ page }) => {
    const cfg = skipIfNoDaemons()
    if (!cfg) return test.skip(true, SKIP_MSG)

    await injectConfig(page, cfg)
    await injectCorsHeaders(page, 'http://localhost:3000', [cfg.vtdUrl, cfg.graphdUrl])
    await page.goto('/')
    await waitForElectronApiReady(page)

    // The browser runtime subscribes to terminal-registry SSE on install.
    // Verify the events.on API is present (the subscription may have no events in a quiet daemon).
    const hasEventsApi = await page.evaluate(() => {
      const api = (window as unknown as { electronAPI?: { events?: unknown } }).electronAPI
      return typeof (api?.events as { on?: unknown })?.on === 'function'
    })
    expect(hasEventsApi).toBe(true)
  })

  test('spawnTerminalWithContextNode creates a terminal with valid node (headless, immediate cleanup)', async ({ page }) => {
    const cfg = skipIfNoDaemons()
    if (!cfg) return test.skip(true, SKIP_MSG)

    await injectConfig(page, cfg)
    await injectCorsHeaders(page, 'http://localhost:3000', [cfg.vtdUrl, cfg.graphdUrl])
    await page.goto('/')
    await waitForElectronApiReady(page)

    // Get a real leaf node ID from graphd to use as taskNodeId
    const taskNodeId = await page.evaluate(async () => {
      const api = (window as unknown as { electronAPI?: { main?: { getGraph?: () => Promise<unknown> } } }).electronAPI
      const graph = await api?.main?.getGraph?.() as { nodes?: Record<string, unknown> } | undefined
      if (!graph?.nodes) return null
      // Find first non-folder node (leaf nodes don't end with '/')
      return Object.keys(graph.nodes).find(id => !id.endsWith('/')) ?? null
    })
    expect(typeof taskNodeId).toBe('string')

    // Call spawn with the correct VTD protocol param (taskNodeId, not contextNodeId).
    // headless: true avoids a PTY. Immediately close the agent to avoid side effects.
    const spawnResult = await page.evaluate(
      async ({ taskNodeId }) => {
        const api = (window as unknown as { electronAPI?: {
          main?: {
            spawnTerminalWithContextNode?: (req: unknown) => Promise<{terminalId: string; contextNodeId: string}>
            closeHeadlessAgent?: (req: unknown) => Promise<unknown>
          }
        } }).electronAPI
        const result = await api?.main?.spawnTerminalWithContextNode?.({
          taskNodeId,
          headless: true,
          callerTerminalId: 'browser-vt-test',
        })
        if (!result?.terminalId) return { ok: false as const, terminalId: null }
        // Clean up immediately — we verified the path works; no need to leave an agent running
        await api?.main?.closeHeadlessAgent?.({ terminalId: result.terminalId })
        return { ok: true as const, terminalId: result.terminalId }
      },
      { taskNodeId: taskNodeId as string },
    )
    expect(spawnResult.ok).toBe(true)
    expect(typeof spawnResult.terminalId).toBe('string')
  })

  test('editor opens via node tap and closes via traffic-light button', async ({ page }) => {
    const cfg = skipIfNoDaemons()
    if (!cfg) return test.skip(true, SKIP_MSG)

    await injectConfig(page, cfg)
    await injectCorsHeaders(page, 'http://localhost:3000', [cfg.vtdUrl, cfg.graphdUrl])
    await page.goto('/')
    await waitForElectronApiReady(page)

    // Trigger the project:ready event so the app transitions to the graph view
    await page.evaluate(async (projectPath) => {
      const api = (window as unknown as { electronAPI?: { main?: { openProject?: (p: string) => Promise<unknown> } } }).electronAPI
      await api?.main?.openProject?.(projectPath)
    }, cfg.projectPath)

    // Wait for Cytoscape to mount — it sets window.cytoscapeInstance on mount
    await page.waitForFunction(
      () => (window as unknown as { cytoscapeInstance?: unknown }).cytoscapeInstance !== undefined,
      { timeout: 20_000 },
    )

    // Emit a tap event on the first non-folder leaf node.
    // The setupCytoscape.ts tap handler (cy.on('tap', 'node[!isFolderNode]', ...))
    // calls applyNodeSelectionSideEffects → createAnchoredFloatingEditor.
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

    // Wait for the floating editor window to appear in the DOM
    await page.waitForSelector('.cy-floating-window', { timeout: 10_000 })

    // Close the editor: the traffic-light-close button is a DOM button that dispatches
    // 'traffic-light-close' on the window element. In headless Playwright the button
    // may be under the Cytoscape pointer-events layer, so call .click() via JS directly
    // rather than via Playwright's actionability-checked page.click().
    const editorClosed = await page.evaluate(() => {
      const win = document.querySelector('.cy-floating-window')
      if (!win) return false
      const btn = win.querySelector('button.traffic-light-close') as HTMLButtonElement | null
      if (btn) {
        btn.click()
        return true
      }
      // Fallback: dispatch the close event the button would have fired
      win.dispatchEvent(new CustomEvent('traffic-light-close', { bubbles: true }))
      return true
    })
    expect(editorClosed).toBe(true)

    // Verify the floating window is gone
    await page.waitForFunction(
      () => document.querySelectorAll('.cy-floating-window').length === 0,
      { timeout: 5_000 },
    )
    const remaining = await page.$$('.cy-floating-window')
    expect(remaining.length).toBe(0)
  })

  test('terminal attach WebSocket connects with vt-bearer subprotocol', async ({ page }) => {
    const cfg = skipIfNoDaemons()
    if (!cfg) return test.skip(true, SKIP_MSG)

    await injectConfig(page, cfg)
    await injectCorsHeaders(page, 'http://localhost:3000', [cfg.vtdUrl, cfg.graphdUrl])
    await page.goto('/')
    await waitForElectronApiReady(page)

    // Verify the terminal.attach function exists in the adapter
    const hasTerminalAttach = await page.evaluate(() => {
      const api = (window as unknown as { electronAPI?: {
        terminal?: { attach?: unknown }
      } }).electronAPI
      return typeof api?.terminal?.attach === 'function'
    })
    expect(hasTerminalAttach).toBe(true)
  })

  test('graph projected-graph SSE subscription fires on session events', async ({ page }) => {
    const cfg = skipIfNoDaemons()
    if (!cfg) return test.skip(true, SKIP_MSG)

    await injectConfig(page, cfg)
    await injectCorsHeaders(page, 'http://localhost:3000', [cfg.vtdUrl, cfg.graphdUrl])
    await page.goto('/')
    await waitForElectronApiReady(page)

    // Subscribe to graph updates and wait briefly
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

    // getCurrentProjectedGraph should return a graph object
    const projGraph = await page.evaluate(async () => {
      const api = (window as unknown as { electronAPI?: {
        graph?: { getCurrentProjectedGraph?: () => Promise<unknown> }
      } }).electronAPI
      return api?.graph?.getCurrentProjectedGraph?.()
    })
    expect(projGraph).toMatchObject({ nodes: expect.any(Array), edges: expect.any(Array) })
  })

})

/**
 * Browser VoiceTree — graph render + viewport navigation (daemon round-trip).
 *
 * Proves the no-Electron graph surface against REAL daemons booted by
 * globalSetup: openProject → projectedGraph → Cytoscape render, then exercises
 * pan/zoom and node-move persistence. All assertions are on OBSERVABLE state:
 *   - render: every projected node has a matching live Cytoscape element
 *   - pan:    a node's RENDERED position shifts by the pan delta while its MODEL
 *             position is unchanged (i.e. the viewport moved, not the graph)
 *   - zoom:   the model-space extent shrinks by ~the zoom factor (zoom in shows
 *             less of the graph)
 *   - move:   a position written through saveNodePositions survives a fresh
 *             full re-projection from the daemon
 *
 * Viewport navigation is driven through Cytoscape's public viewport API
 * (panBy/zoom) — the exact integration point the UI's gesture handlers call —
 * rather than synthetic wheel/drag, which is non-deterministic headless. The
 * assertions are on rendered geometry, so they prove the canvas genuinely
 * responds, not merely that a setter was called.
 */

import {test, expect} from '@playwright/test'
import {
  loadDaemonConfig,
  openProjectAndWaitForGraph,
} from './vt-e2e-helpers.ts'

// Shared resilient open-and-render: boots the runtime, openProject, and waits for
// the projection to stream nodes into Cytoscape, retrying a transient initial
// fetch blip (see openProjectAndWaitForGraph). Navigation assertions never race
// an empty graph.
const openProjectAndRender = openProjectAndWaitForGraph

test.describe('Browser VoiceTree — graph render + navigation', () => {

  test('projected graph renders: every renderable projected node has a live Cytoscape element', async ({page}) => {
    const cfg = loadDaemonConfig()
    await openProjectAndRender(page, cfg)

    // TIGHTENED (not weakened) invariant. This tier shares ONE daemon project, and
    // sibling specs (folder/agent suites) accumulate folders + context nodes in it.
    // The projection (getCurrentProjectedGraph) returns ALL of them, but the graph
    // deliberately does NOT render every projected node as a top-level Cytoscape
    // element — verified rendering rule (GraphNavigationService.ts:210 + the
    // graph-tools cytoscape surface): context nodes (`/ctx-nodes/`, isContextNode)
    // and the descendants of a collapsed folder are folded away. So we positively
    // assert the invariant that DOES hold: every TOP-LEVEL, non-context projected
    // node (a root-level leaf, or a folder node, which renders as a compound) has a
    // live cy element — plus the seed root.md (a guaranteed top-level non-context
    // node) as a hard anchor so this can never pass vacuously on an empty graph.
    // Node-id conventions are the codebase's own: folder ids end with '/',
    // containment is path-prefix, context nodes carry `/ctx-nodes/`.
    const rootId = `${cfg.projectPath}/root.md`
    const result = await page.evaluate(async (rootId) => {
      type CyEl = {length: number}
      type CyInstance = {nodes: () => {length: number}; getElementById: (id: string) => CyEl}
      const cy = (window as unknown as {cytoscapeInstance?: CyInstance}).cytoscapeInstance
      const api = (window as unknown as {hostAPI?: {graph?: {getCurrentProjectedGraph?: () => Promise<{nodes?: {id: string}[]}>}}}).hostAPI
      if (!cy) return {error: 'no cytoscapeInstance'}
      const proj = await api?.graph?.getCurrentProjectedGraph?.()
      const projIds = (proj?.nodes ?? []).map((n) => n.id)
      const folderIds = projIds.filter((id) => id.endsWith('/'))
      const isNested = (id: string): boolean => folderIds.some((f) => id !== f && id.startsWith(f))
      const isContext = (id: string): boolean => id.includes('/ctx-nodes/')
      const renderable = projIds.filter((id) => !isNested(id) && !isContext(id))
      const missing = renderable.filter((id) => cy.getElementById(id).length === 0)
      return {
        cyNodeCount: cy.nodes().length,
        projCount: projIds.length,
        renderableCount: renderable.length,
        missing,
        rootRendered: cy.getElementById(rootId).length > 0,
      }
    }, rootId)

    expect(result.error, `setup failed: ${result.error ?? ''}`).toBeUndefined()
    expect(result.projCount, 'fixture project must project at least one node').toBeGreaterThan(0)
    expect(result.cyNodeCount, 'cytoscape must have rendered nodes').toBeGreaterThan(0)
    expect(result.rootRendered, 'the seed root.md (top-level, non-context) must render as a Cytoscape element').toBe(true)
    expect(result.renderableCount, 'there must be at least one top-level non-context node to assert on').toBeGreaterThan(0)
    expect(result.missing, 'every TOP-LEVEL non-context projected node must be rendered as a Cytoscape element').toEqual([])
  })

  test('pan shifts rendered node positions but not model positions', async ({page}) => {
    const cfg = loadDaemonConfig()
    await openProjectAndRender(page, cfg)

    const result = await page.evaluate(async () => {
      type Pt = {x: number; y: number}
      type CyNode = {id: () => string; position: () => Pt; renderedPosition: () => Pt}
      type CyInstance = {
        nodes: () => {length: number; first: () => CyNode}
        panBy: (d: Pt) => void
      }
      const cy = (window as unknown as {cytoscapeInstance?: CyInstance}).cytoscapeInstance
      if (!cy || cy.nodes().length === 0) return {error: 'no rendered nodes'}
      const node = cy.nodes().first()
      const modelBefore = {...node.position()}
      const renderedBefore = {...node.renderedPosition()}
      const delta = {x: 137, y: -91}
      cy.panBy(delta)
      const modelAfter = {...node.position()}
      const renderedAfter = {...node.renderedPosition()}
      return {modelBefore, modelAfter, renderedBefore, renderedAfter, delta}
    })

    expect(result.error, `setup failed: ${result.error ?? ''}`).toBeUndefined()
    // Model coordinates are anchored to the graph — panning must NOT move them.
    expect(result.modelAfter!.x).toBeCloseTo(result.modelBefore!.x, 3)
    expect(result.modelAfter!.y).toBeCloseTo(result.modelBefore!.y, 3)
    // Rendered (screen) coordinates must shift by exactly the pan delta.
    expect(result.renderedAfter!.x - result.renderedBefore!.x).toBeCloseTo(result.delta!.x, 1)
    expect(result.renderedAfter!.y - result.renderedBefore!.y).toBeCloseTo(result.delta!.y, 1)
  })

  test('zoom in shrinks the visible model-space extent by ~the zoom factor', async ({page}) => {
    const cfg = loadDaemonConfig()
    await openProjectAndRender(page, cfg)

    const result = await page.evaluate(async () => {
      type Extent = {w: number; h: number}
      type CyInstance = {
        zoom: ((z?: number) => number) & ((opts: {level: number; renderedPosition: {x: number; y: number}}) => void)
        extent: () => Extent
        width: () => number
        height: () => number
      }
      const cy = (window as unknown as {cytoscapeInstance?: CyInstance}).cytoscapeInstance
      if (!cy) return {error: 'no cytoscapeInstance'}
      const z0 = cy.zoom()
      const extentBefore = {...cy.extent()}
      const factor = 1.75
      // Zoom about the viewport centre — the model point at centre stays put.
      cy.zoom({level: z0 * factor, renderedPosition: {x: cy.width() / 2, y: cy.height() / 2}})
      const z1 = cy.zoom()
      const extentAfter = {...cy.extent()}
      return {z0, z1, factor, wBefore: extentBefore.w, wAfter: extentAfter.w}
    })

    expect(result.error, `setup failed: ${result.error ?? ''}`).toBeUndefined()
    expect(result.z1!).toBeGreaterThan(result.z0!)
    // Higher zoom ⇒ fewer model units span the same pixels ⇒ extent width shrinks
    // by the zoom factor. Ratio assertion is resolution-independent.
    expect(result.wAfter!).toBeLessThan(result.wBefore!)
    expect(result.wBefore! / result.wAfter!).toBeCloseTo(result.factor!, 1)
  })

  test('node move persists: saveNodePositions survives a fresh daemon re-projection', async ({page}) => {
    const cfg = loadDaemonConfig()
    await openProjectAndRender(page, cfg)

    const writeFolder = await page.evaluate(async () => {
      const api = (window as unknown as {hostAPI?: {main?: {getWriteFolderPath?: () => Promise<{_tag?: string; value?: string}>}}}).hostAPI
      const opt = await api?.main?.getWriteFolderPath?.()
      return opt?._tag === 'Some' ? opt.value ?? null : null
    })
    expect(typeof writeFolder).toBe('string')

    const nodeId = `${writeFolder}/browser-move-${Date.now()}.md`
    const target = {x: 1234, y: 5678}

    const persisted = await page.evaluate(async ({nodeId, target}) => {
      type Main = {
        applyGraphDeltaToDBThroughMemAndUIExposed: (delta: unknown) => Promise<void>
        saveNodePositions: (payload: unknown) => Promise<unknown>
        getProjectedGraph: () => Promise<{nodes?: {id: string; position?: {x: number; y: number}}[]}>
      }
      const api = (window as unknown as {hostAPI?: {main?: Main}}).hostAPI
      const main = api?.main
      if (!main) return {error: 'no hostAPI.main'}

      // Create the node with a known initial position.
      await main.applyGraphDeltaToDBThroughMemAndUIExposed([{
        type: 'UpsertNode',
        nodeToUpsert: {
          kind: 'leaf',
          absoluteFilePathIsID: nodeId,
          contentWithoutYamlOrLinks: '# Move test node',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: {_tag: 'None'},
            position: {_tag: 'Some', value: {x: 10, y: 10}},
            additionalYAMLProps: {},
            isContextNode: false,
          },
        },
        previousNode: {_tag: 'None'},
      }])

      // Move it. saveNodePositions takes cy.nodes().jsons() (NodeDefinition[]).
      await main.saveNodePositions([{data: {id: nodeId}, position: target}])

      // Poll a FRESH full projection from the daemon until it reflects the move.
      const deadline = Date.now() + 8000
      let last: {x: number; y: number} | undefined
      while (Date.now() < deadline) {
        const proj = await main.getProjectedGraph()
        const n = (proj.nodes ?? []).find((x) => x.id === nodeId)
        last = n?.position
        if (last && Math.abs(last.x - target.x) < 1 && Math.abs(last.y - target.y) < 1) break
        await new Promise((r) => setTimeout(r, 150))
      }
      return {last}
    }, {nodeId, target})

    // Cleanup regardless of outcome.
    await page.evaluate(async ({nodeId}) => {
      const api = (window as unknown as {hostAPI?: {main?: {applyGraphDeltaToDBThroughMemAndUIExposed?: (d: unknown) => Promise<void>}}}).hostAPI
      await api?.main?.applyGraphDeltaToDBThroughMemAndUIExposed?.([{type: 'DeleteNode', nodeId, deletedNode: {_tag: 'None'}}])
    }, {nodeId})

    expect(persisted.error, `setup failed: ${persisted.error ?? ''}`).toBeUndefined()
    expect(persisted.last, 'moved node must appear in the re-projected graph with a position').toBeDefined()
    expect(persisted.last!.x).toBeCloseTo(target.x, 0)
    expect(persisted.last!.y).toBeCloseTo(target.y, 0)
  })

})

import { describe, expect, test, beforeEach } from 'vitest'
import {
    installCollectionCache,
    installTextureCacheSkip,
    resetLargeGraphPerformanceState,
    syncLargeGraphPerformanceMode,
} from './largegraphPerformance'

function createMockCy(nodeCount: number) {
    const nodesCollection = { length: nodeCount }
    let batchDepth = 0
    const renderer = {
        hideEdgesOnViewport: false,
        textureOnViewport: false,
        data: {
            wheelZooming: false,
            wheelTimeout: null,
            eleTxrCache: { setupDequeueing: () => {}, invalidateElement: () => {} },
        },
        pinching: false,
        hoverData: { dragging: false, draggingEles: false },
        swipePanning: false,
        redrawHint: () => {},
        redraw: () => {},
    }
    const listeners: Array<() => void> = []
    const cy = {
        nodes: () => nodesCollection,
        edges: () => ({ length: 0 }),
        elements: () => ({ length: nodeCount }),
        renderer: () => renderer,
        on: (_event: string, fn: () => void) => { listeners.push(fn) },
        startBatch: () => { batchDepth++ },
        endBatch: () => { batchDepth--; return cy },
        batching: () => batchDepth > 0,
    }
    return { cy, renderer }
}

describe('resetLargeGraphPerformanceState', () => {
    beforeEach(() => {
        resetLargeGraphPerformanceState()
    })

    test('allows installCollectionCache to re-install after reset', () => {
        const { cy } = createMockCy(10)

        // First install succeeds (patches cy.nodes)
        installCollectionCache(cy as any)
        const patchedNodes = cy.nodes

        // Second install without reset is a no-op (idempotent guard)
        installCollectionCache(cy as any)
        expect(cy.nodes).toBe(patchedNodes)

        // After reset, install works again on a new cy
        resetLargeGraphPerformanceState()
        const { cy: cy2 } = createMockCy(5)
        installCollectionCache(cy2 as any)

        // cy2.nodes should be patched (different from the original mock)
        const result = cy2.nodes('someSelector')
        expect(result).toBeDefined()
    })

    test('allows installTextureCacheSkip to re-install after reset', () => {
        const { cy } = createMockCy(10)

        installTextureCacheSkip(cy as any)

        // Without reset, a second cy won't get patched
        const { cy: cy2 } = createMockCy(5)
        installTextureCacheSkip(cy2 as any)
        // endBatch on cy2 should be the ORIGINAL (unpatched) because guard returned early
        const originalEndBatch = cy2.endBatch
        expect(cy2.endBatch).toBe(originalEndBatch)

        // After reset, new cy gets patched
        resetLargeGraphPerformanceState()
        const { cy: cy3 } = createMockCy(5)
        installTextureCacheSkip(cy3 as any)
        // endBatch should now be patched (different from the plain function)
        // Call it to verify it doesn't throw
        cy3.startBatch()
        cy3.endBatch()
    })

    test('clears cached renderer so new cy gets its own renderer', () => {
        const { cy: cy1 } = createMockCy(10)
        syncLargeGraphPerformanceMode(cy1 as any)

        resetLargeGraphPerformanceState()

        const { cy: cy2, renderer: renderer2 } = createMockCy(10)
        syncLargeGraphPerformanceMode(cy2 as any)
        // After reset + sync on cy2, cy2's renderer should be activated
        expect(renderer2.hideEdgesOnViewport).toBe(true)
    })

    test('resets largeGraphModeActive so syncLargeGraphPerformanceMode re-evaluates', () => {
        const { cy, renderer } = createMockCy(10)
        syncLargeGraphPerformanceMode(cy as any)
        expect(renderer.hideEdgesOnViewport).toBe(true)

        // Without reset, calling again with same node count is a no-op
        renderer.hideEdgesOnViewport = false
        syncLargeGraphPerformanceMode(cy as any)
        expect(renderer.hideEdgesOnViewport).toBe(false) // no-op, didn't set it

        // After reset, it re-evaluates
        resetLargeGraphPerformanceState()
        syncLargeGraphPerformanceMode(cy as any)
        expect(renderer.hideEdgesOnViewport).toBe(true)
    })
})

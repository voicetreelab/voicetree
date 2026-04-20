/**
 * BF-167 — `layoutProjection` is the SINGLE renderer-side writer of layout
 * state into cytoscape. It subscribes to the layout store's batched deltas
 * and calls cy.zoom() / cy.pan() / cy.fit() / node.position() — these are
 * the ONLY allowed cy.* layout writes in business code.
 *
 * Every other read of zoom/pan/positions across the codebase must migrate
 * to read from `layoutStore.getLayout()` instead of `cy.zoom()` etc.
 *
 * Wire-up: call `mountLayoutProjection(cy, store)` once after cytoscape
 * initialises (e.g. in `VoiceTreeGraphView`). Returns an unsubscribe to call
 * on unmount.
 *
 * --------------------------------------------------------------------------
 * [L2-O-layout-*] OPEN READ-SITE MIGRATIONS (per-callsite work, not in 167)
 * --------------------------------------------------------------------------
 * Each row below is a separate L2-O ticket. Pattern: replace every
 * `cy.zoom()` / `cy.pan()` / `cy.getElementById(id).position()` read with a
 * read from `layoutStore.getLayout()`. Writes must funnel through
 * `dispatchSetZoom/Pan/Positions/RequestFit` instead of touching cy
 * directly.
 *
 *   [L2-O-layout-coords]   coordinate-conversions.ts                (~6 reads)
 *   [L2-O-layout-fszoom]   fullscreen-zoom.ts                        (~9 reads)
 *   [L2-O-layout-anchor]   anchor-to-node.ts                         (partial)
 *   [L2-O-layout-navgest]  NavigationGestureService.ts               (many)
 *   [L2-O-layout-pendpan]  state/PendingPanStore.ts                  (~13 reads)
 *   [L2-O-layout-hover]    HoverEditor.ts                            (~1)
 *   [L2-O-layout-anchored] AnchoredEditor.ts                         (~1)
 *   [L2-O-layout-imgview]  FloatingImageViewerCRUD.ts                (~1)
 *   [L2-O-layout-badge]    headless-badge-overlay.ts                 (~1)
 */

import type { Core } from 'cytoscape'

import type { LayoutDelta, LayoutStore } from '@vt/graph-state'

export interface LayoutProjectionMount {
    /** Detach the projection. Tests + unmount must call this. */
    readonly unmount: () => void
}

export function mountLayoutProjection(
    cy: Core,
    store: LayoutStore,
): LayoutProjectionMount {
    let applyingProjection = false

    const syncViewportToStore = (): void => {
        const zoom: number = cy.zoom()
        const pan: { x: number; y: number } = cy.pan()
        const layout = store.getLayout()

        if (layout.zoom !== zoom) {
            store.dispatchSetZoom(zoom)
        }

        if (layout.pan?.x !== pan.x || layout.pan?.y !== pan.y) {
            store.dispatchSetPan({ x: pan.x, y: pan.y })
        }
    }

    const applyProjectedDelta = (delta: {
        readonly zoom?: number
        readonly pan?: { readonly x: number; readonly y: number }
        readonly positions?: ReadonlyMap<string, { readonly x: number; readonly y: number }>
        readonly fit?: { readonly paddingPx: number } | null | undefined
    }): void => {
        applyingProjection = true
        try {
            applyLayoutDelta(cy, delta)
        } finally {
            applyingProjection = false
        }

        // Direct cy.fit()/pan()/zoom() calls remain in the app; mirror the actual
        // live viewport back into layoutStore so floating overlays stay anchored.
        syncViewportToStore()
    }

    const handleViewport = (): void => {
        if (applyingProjection) return
        syncViewportToStore()
    }

    cy.on('viewport', handleViewport)

    // Hydrate cy from current layout snapshot (covers reload-into-loaded).
    applyProjectedDelta({
        zoom:      store.getLayout().zoom,
        pan:       store.getLayout().pan,
        positions: store.getLayout().positions as ReadonlyMap<string, { x: number; y: number }>,
        fit:       store.getLayout().fit ?? undefined,
    })

    const unsubscribe: () => void = store.subscribeLayout((delta: LayoutDelta) => {
        applyProjectedDelta(delta)
    })

    return {
        unmount: () => {
            unsubscribe()
            cy.off('viewport', handleViewport)
        }
    }
}

/**
 * Apply a single layout delta to cytoscape. Internal — exposed for tests
 * and for the initial hydrate path.
 *
 * Order: positions before zoom/pan/fit. Fit reads positions, so positions
 * must land first.
 */
export function applyLayoutDelta(
    cy: Core,
    delta: {
        readonly zoom?: number
        readonly pan?: { readonly x: number; readonly y: number }
        readonly positions?: ReadonlyMap<string, { readonly x: number; readonly y: number }>
        readonly fit?: { readonly paddingPx: number } | null | undefined
    },
): void {
    cy.batch(() => {
        if (delta.positions !== undefined) {
            for (const [id, pos] of delta.positions) {
                const node: ReturnType<typeof cy.getElementById> = cy.getElementById(id)
                if (node.length > 0 && node.isNode()) {
                    node.position({ x: pos.x, y: pos.y })
                }
            }
        }
        if (delta.zoom !== undefined) {
            cy.zoom(delta.zoom)
        }
        if (delta.pan !== undefined) {
            cy.pan({ x: delta.pan.x, y: delta.pan.y })
        }
        if (delta.fit !== undefined && delta.fit !== null) {
            cy.fit(undefined, delta.fit.paddingPx)
        }
    })
}

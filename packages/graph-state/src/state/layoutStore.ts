/**
 * BF-167 — `layoutStore` is the slice owner for `state.layout` (positions /
 * zoom / pan / fit).
 *
 * **Why a store, not just reducers.** Layout events fire at 60fps (zoom
 * wheel, pan drag, position drag). One `applyCommand` per event would burn
 * cycles on State immutability, then re-render on every notification.
 * The store coalesces dispatches into a single batched delta per frame:
 * - `zoom`, `pan`, `fit` use last-wins.
 * - `positions` merges by nodeId (last-wins per id).
 *
 * **Single subscriber, single writer.** `webapp/src/shell/edge/UI-edge/graph/
 * layoutProjection.ts` is the only place allowed to write back to cytoscape
 * (cy.zoom() / cy.pan() / cy.fit()). All readers (40+ callsites scheduled
 * for L2-O migration) read via `getLayout()` instead of `cy.zoom()` etc.
 *
 * **Scheduler is injectable** so tests can drive flush deterministically
 * (no rAF in Node).
 */

import type { NodeIdAndFilePath, Position } from '@vt/graph-model/pure/graph'

import type { Delta, StateLayout, Unsubscribe } from '../contract'

const DEFAULT_FIT_PADDING_PX = 50

export type LayoutDelta = NonNullable<Delta['layoutChanged']>

export type LayoutSubscriber = (delta: LayoutDelta) => void

/** Fired once per flush — schedules the next flush callback. */
export type FlushScheduler = (callback: () => void) => void

export interface LayoutStore {
    getLayout(): StateLayout
    dispatchSetZoom(zoom: number): void
    dispatchSetPan(pan: Position): void
    dispatchSetPositions(positions: ReadonlyMap<NodeIdAndFilePath, Position>): void
    dispatchRequestFit(paddingPx?: number): void
    subscribeLayout(cb: LayoutSubscriber): Unsubscribe
    /** Force-flush any pending batched dispatches synchronously. */
    flush(): boolean
    /** Cancel any pending flush + drop subscribers. Tests should call this. */
    dispose(): void
}

export interface LayoutStoreOptions {
    readonly initialLayout?: StateLayout
    /**
     * Deferred flush scheduler. Default: `requestAnimationFrame` in browsers,
     * `queueMicrotask` everywhere else. Pass a no-op scheduler in tests to
     * disable auto-flush; call `store.flush()` instead.
     */
    readonly scheduler?: FlushScheduler
}

interface PendingBatch {
    zoom?: number
    pan?: Position
    positions?: Map<NodeIdAndFilePath, Position>
    fit?: { readonly paddingPx: number } | null
}

function defaultScheduler(): FlushScheduler {
    if (typeof globalThis.requestAnimationFrame === 'function') {
        return (cb): void => { globalThis.requestAnimationFrame(cb) }
    }
    return (cb): void => { queueMicrotask(cb) }
}

export function createLayoutStore(options: LayoutStoreOptions = {}): LayoutStore {
    let layout: StateLayout = options.initialLayout ?? { positions: new Map() }
    const subscribers = new Set<LayoutSubscriber>()
    const schedule = options.scheduler ?? defaultScheduler()

    let pending: PendingBatch | null = null
    let flushScheduled = false

    function scheduleFlush(): void {
        if (flushScheduled) return
        flushScheduled = true
        schedule(() => {
            // Re-check: dispose() may have cleared pending after we scheduled.
            if (!flushScheduled) return
            flush()
        })
    }

    function flush(): boolean {
        flushScheduled = false
        if (pending === null) return false
        const batch = pending
        pending = null

        let nextLayout = layout
        const layoutChanged: {
            zoom?: number
            pan?: Position
            positions?: Map<NodeIdAndFilePath, Position>
            fit?: { readonly paddingPx: number } | null
        } = {}

        if (batch.zoom !== undefined && batch.zoom !== nextLayout.zoom) {
            nextLayout = { ...nextLayout, zoom: batch.zoom }
            layoutChanged.zoom = batch.zoom
        }

        if (batch.pan !== undefined) {
            const cur = nextLayout.pan
            if (cur === undefined || cur.x !== batch.pan.x || cur.y !== batch.pan.y) {
                nextLayout = { ...nextLayout, pan: batch.pan }
                layoutChanged.pan = batch.pan
            }
        }

        if (batch.positions !== undefined && batch.positions.size > 0) {
            const merged = new Map(nextLayout.positions)
            const changed = new Map<NodeIdAndFilePath, Position>()
            for (const [id, pos] of batch.positions) {
                const cur = merged.get(id)
                if (cur?.x === pos.x && cur?.y === pos.y) continue
                merged.set(id, pos)
                changed.set(id, pos)
            }
            if (changed.size > 0) {
                nextLayout = { ...nextLayout, positions: merged }
                layoutChanged.positions = changed
            }
        }

        if (batch.fit !== undefined) {
            // RequestFit is a *gesture*: always emit even if paddingPx unchanged
            // — graph contents may have changed and fit needs to re-run.
            nextLayout = { ...nextLayout, fit: batch.fit }
            layoutChanged.fit = batch.fit
        }

        if (
            layoutChanged.zoom === undefined
            && layoutChanged.pan === undefined
            && layoutChanged.positions === undefined
            && layoutChanged.fit === undefined
        ) {
            return false
        }

        layout = nextLayout
        const frozen = layoutChanged as LayoutDelta
        for (const cb of subscribers) {
            cb(frozen)
        }
        return true
    }

    function ensurePending(): PendingBatch {
        if (pending === null) pending = {}
        return pending
    }

    return {
        getLayout: () => layout,
        dispatchSetZoom(zoom) {
            ensurePending().zoom = zoom
            scheduleFlush()
        },
        dispatchSetPan(pan) {
            ensurePending().pan = pan
            scheduleFlush()
        },
        dispatchSetPositions(positions) {
            const p = ensurePending()
            const merged = p.positions ?? new Map<NodeIdAndFilePath, Position>()
            for (const [id, pos] of positions) merged.set(id, pos)
            p.positions = merged
            scheduleFlush()
        },
        dispatchRequestFit(paddingPx) {
            ensurePending().fit = { paddingPx: paddingPx ?? DEFAULT_FIT_PADDING_PX }
            scheduleFlush()
        },
        subscribeLayout(cb) {
            subscribers.add(cb)
            return () => { subscribers.delete(cb) }
        },
        flush,
        dispose() {
            flushScheduled = false
            pending = null
            subscribers.clear()
        },
    }
}

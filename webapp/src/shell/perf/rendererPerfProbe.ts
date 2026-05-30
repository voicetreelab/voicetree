/**
 * Renderer performance probe — the frontend MELT instrument for e2e-nav-storm.
 *
 * The renderer has no OpenTelemetry SDK, so this probe collects frame timing,
 * long tasks, interaction latency (INP), cytoscape node counts, and interaction
 * spans using only browser APIs, then batches them as plain JSON over preload
 * IPC to the Electron main process, which owns the OTLP exporter
 * (`recordRendererTelemetry.ts`). No web OTel SDK, no bundle bloat, no parallel
 * exporter.
 *
 * It is a DEEP module: a single `startRendererPerfProbe` entry hides the rAF
 * loop, three PerformanceObservers, a cytoscape attach, a span builder, and a
 * batch flusher behind a small handle that is also exposed as
 * `window.__vtPerfProbe__` so the e2e-nav-storm harness can scope a measurement
 * window, mark interactions on the real timeline, and read exact frame
 * percentiles for its report.
 *
 * Impurity (rAF, PerformanceObserver, cytoscape, IPC, clock) is concentrated in
 * the starter and injected dependencies; the aggregation maths lives in
 * `rendererTelemetryContract.ts` as pure functions.
 *
 * Gated: started only when `window.voicetreeEnv.perfProbe` is true (the
 * e2e-nav-storm harness sets `VOICETREE_PERF_PROBE=1`), never in the normal app.
 */
import type { Core } from 'cytoscape'
import { getVisibleViewportExtent } from '@/utils/visibleViewport'
import {
    summariseFrames,
    percentile,
    type FrameStats,
    type RendererMetricPoint,
    type RendererSpan,
    type RendererTelemetryBatch,
} from '@/shell/perf/rendererTelemetryContract'

/** Interactions the harness can mark, matching the real gesture set. */
export type InteractionKind = 'pan' | 'zoom' | 'select' | 'expand' | 'fit'

/** Public handle, also published as `window.__vtPerfProbe__`. */
export interface RendererPerfProbe {
    /** Start (or restart) the measured window: clears retained snapshot data. */
    readonly beginWindow: () => void
    /** Freeze the measured window: snapshot data stops growing. */
    readonly endWindow: () => void
    /**
     * Mark the start/end of a real interaction the harness just drove. A
     * start/end pair becomes one `renderer.interaction.<kind>` span on the
     * Tempo timeline; `traceparent` (on end) stitches it to a daemon read.
     */
    readonly mark: (kind: InteractionKind, phase: 'start' | 'end', attributes?: Record<string, string | number | boolean>, traceparent?: string) => void
    /** Mark cola layout start/end → one `renderer.cola.layout` span. */
    readonly markCola: (phase: 'start' | 'end') => void
    /** Exact frame/longtask/INP/node-count summary since the last `beginWindow`. */
    readonly snapshot: () => ProbeSnapshot
    /** Flush + detach everything. */
    readonly stop: () => Promise<void>
}

export interface ProbeSnapshot {
    readonly windowMs: number
    readonly frames: FrameStats
    readonly longtask: { readonly count: number; readonly p50: number; readonly p99: number; readonly maxMs: number; readonly totalMs: number }
    readonly inp: { readonly count: number; readonly p50: number; readonly p95: number; readonly p99: number }
    readonly nodes: { readonly total: number; readonly visible: number; readonly addedDuringWindow: number }
}

export interface RendererPerfProbeDeps {
    /** Sends one batch to main over IPC. Injected so the probe stays edge-free. */
    readonly flush: (batch: RendererTelemetryBatch) => Promise<void>
    /** Accessor for the live cytoscape instance (may be absent until mounted). */
    readonly getCy: () => Core | undefined
    /** Monotonic clock for frame deltas (ms). */
    readonly nowMonotonic: () => number
    /** Wall clock for span/event timestamps (epoch ms). */
    readonly nowEpoch: () => number
    /** Flush cadence; defaults to 1000ms. */
    readonly flushIntervalMs?: number
    /** Node-count sample cadence; defaults to 1000ms. */
    readonly sampleIntervalMs?: number
}

const DEFAULT_FLUSH_INTERVAL_MS = 1000
const DEFAULT_SAMPLE_INTERVAL_MS = 1000

/** Count nodes whose bounding box intersects the visible viewport extent. */
function countVisibleNodes(cy: Core): number {
    const extent = getVisibleViewportExtent(cy)
    let visible = 0
    cy.nodes().forEach(node => {
        const bb = node.boundingBox()
        if (!(bb.x2 < extent.x1 || bb.x1 > extent.x2 || bb.y2 < extent.y1 || bb.y1 > extent.y2)) {
            visible += 1
        }
    })
    return visible
}

export function startRendererPerfProbe(deps: RendererPerfProbeDeps): RendererPerfProbe {
    const flushIntervalMs = deps.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS
    const sampleIntervalMs = deps.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS

    // ---- retained, window-scoped samples (for the harness snapshot) ----
    let windowStartEpoch = deps.nowEpoch()
    let frameDurations: number[] = []
    let longtaskDurations: number[] = []
    let inpDurations: number[] = []
    let latestTotalNodes = 0
    let latestVisibleNodes = 0
    let nodesAddedDuringWindow = 0
    let windowActive = true

    // ---- pending OTLP batch (drained every flush tick) ----
    let pendingMetrics: RendererMetricPoint[] = []
    let pendingSpans: RendererSpan[] = []

    // ---- open interaction/cola marks awaiting their end ----
    const openInteractions = new Map<InteractionKind, { startEpochMs: number; attributes?: Record<string, string | number | boolean> }>()
    let colaStartEpoch: number | null = null

    const pushFrame = (dt: number): void => {
        if (windowActive) frameDurations.push(dt)
        pendingMetrics.push({ instrument: 'renderer.frame.duration_ms', kind: 'histogram', value: dt, unit: 'ms' })
        if (dt > 1000 / 60) {
            pendingMetrics.push({ instrument: 'renderer.frame.dropped', kind: 'counter', value: 1, unit: '1' })
        }
    }

    // ---- frame timing via requestAnimationFrame deltas ----
    let lastFrame = deps.nowMonotonic()
    let rafId = 0
    const tick = (): void => {
        const now = deps.nowMonotonic()
        pushFrame(now - lastFrame)
        lastFrame = now
        rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)

    // ---- long tasks ----
    const longtaskObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
            if (windowActive) longtaskDurations.push(entry.duration)
            pendingMetrics.push({ instrument: 'renderer.longtask.duration_ms', kind: 'histogram', value: entry.duration, unit: 'ms' })
        }
    })
    try { longtaskObserver.observe({ type: 'longtask', buffered: true }) } catch { /* unsupported */ }

    // ---- interaction latency / INP via Event Timing ----
    const eventObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
            const duration = (entry as PerformanceEntry & { duration: number }).duration
            if (windowActive) inpDurations.push(duration)
            pendingMetrics.push({
                instrument: 'renderer.interaction.latency_ms',
                kind: 'histogram',
                value: duration,
                unit: 'ms',
                attributes: { event_type: entry.name },
            })
        }
    })
    try { eventObserver.observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit) } catch { /* unsupported */ }
    const firstInputObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
            const duration = (entry as PerformanceEntry & { duration: number }).duration
            pendingMetrics.push({ instrument: 'renderer.interaction.latency_ms', kind: 'histogram', value: duration, unit: 'ms', attributes: { event_type: 'first-input' } })
        }
    })
    try { firstInputObserver.observe({ type: 'first-input', buffered: true }) } catch { /* unsupported */ }

    // ---- cytoscape attach (lazy: cy may not be mounted yet) ----
    let attachedCy: Core | null = null
    const onNodeAdded = (): void => { if (windowActive) nodesAddedDuringWindow += 1 }
    const tryAttachCy = (): void => {
        const cy = deps.getCy()
        if (!cy || cy === attachedCy) return
        attachedCy = cy
        cy.on('add', 'node', onNodeAdded)
    }

    const sampleNodeCounts = (): void => {
        tryAttachCy()
        const cy = attachedCy
        if (!cy) return
        latestTotalNodes = cy.nodes().length
        latestVisibleNodes = countVisibleNodes(cy)
        pendingMetrics.push({ instrument: 'cytoscape.total_nodes', kind: 'gauge', value: latestTotalNodes, unit: '1' })
        pendingMetrics.push({ instrument: 'cytoscape.visible_nodes', kind: 'gauge', value: latestVisibleNodes, unit: '1' })
    }

    // ---- batch flushing ----
    const drainAndFlush = async (): Promise<void> => {
        if (pendingMetrics.length === 0 && pendingSpans.length === 0) return
        const batch: RendererTelemetryBatch = { metrics: pendingMetrics, spans: pendingSpans }
        pendingMetrics = []
        pendingSpans = []
        try {
            await deps.flush(batch)
        } catch {
            // Telemetry is best-effort; a dropped batch must never perturb the
            // thing being measured. Intentionally swallow.
        }
    }

    const sampleTimer = setInterval(() => { sampleNodeCounts() }, sampleIntervalMs)
    const flushTimer = setInterval(() => { void drainAndFlush() }, flushIntervalMs)

    const handle: RendererPerfProbe = {
        beginWindow: () => {
            windowStartEpoch = deps.nowEpoch()
            frameDurations = []
            longtaskDurations = []
            inpDurations = []
            nodesAddedDuringWindow = 0
            windowActive = true
        },
        endWindow: () => { windowActive = false },
        mark: (kind, phase, attributes, traceparent) => {
            const epoch = deps.nowEpoch()
            if (phase === 'start') {
                openInteractions.set(kind, { startEpochMs: epoch, attributes })
                return
            }
            const open = openInteractions.get(kind)
            if (!open) return
            openInteractions.delete(kind)
            pendingSpans.push({
                name: `renderer.interaction.${kind}`,
                startEpochMs: open.startEpochMs,
                endEpochMs: epoch,
                attributes: { ...open.attributes, ...attributes, interaction: kind },
                ...(traceparent !== undefined ? { traceparent } : {}),
            })
        },
        markCola: phase => {
            const epoch = deps.nowEpoch()
            if (phase === 'start') { colaStartEpoch = epoch; return }
            if (colaStartEpoch === null) return
            pendingSpans.push({ name: 'renderer.cola.layout', startEpochMs: colaStartEpoch, endEpochMs: epoch, attributes: { total_nodes: latestTotalNodes } })
            colaStartEpoch = null
        },
        snapshot: () => ({
            windowMs: deps.nowEpoch() - windowStartEpoch,
            frames: summariseFrames(frameDurations),
            longtask: {
                count: longtaskDurations.length,
                p50: percentile(longtaskDurations, 50),
                p99: percentile(longtaskDurations, 99),
                maxMs: longtaskDurations.length > 0 ? Math.max(...longtaskDurations) : 0,
                totalMs: longtaskDurations.reduce((a, b) => a + b, 0),
            },
            inp: {
                count: inpDurations.length,
                p50: percentile(inpDurations, 50),
                p95: percentile(inpDurations, 95),
                p99: percentile(inpDurations, 99),
            },
            nodes: { total: latestTotalNodes, visible: latestVisibleNodes, addedDuringWindow: nodesAddedDuringWindow },
        }),
        stop: async () => {
            cancelAnimationFrame(rafId)
            clearInterval(sampleTimer)
            clearInterval(flushTimer)
            longtaskObserver.disconnect()
            eventObserver.disconnect()
            firstInputObserver.disconnect()
            if (attachedCy) attachedCy.removeListener('add', 'node', onNodeAdded)
            await drainAndFlush()
        },
    }

    return handle
}

declare global {
    interface Window {
        __vtPerfProbe__?: RendererPerfProbe
        voicetreeEnv?: { perfMode?: boolean; perfProbe?: boolean }
        cytoscapeInstance?: Core
    }
}

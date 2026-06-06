/**
 * Neutral contract shared by the renderer perf probe (producer) and the
 * Electron-main telemetry recorder (consumer).
 *
 * The renderer has no OpenTelemetry SDK, so the probe batches plain JSON
 * telemetry over preload IPC (`window.hostAPI.main.recordRendererTelemetry`)
 * to the main process, which owns the OTLP exporter (see
 * `recordRendererTelemetry.ts`). This module is the ONLY thing both sides
 * import — it carries no Electron, no OTel, and no DOM dependency, so it stays
 * safe to load in either context and the IPC payload shape lives in one place.
 *
 * Pure data + pure helpers only.
 */

/** A single metric observation produced in the renderer. */
export interface RendererMetricPoint {
    /** Instrument name, e.g. `renderer.frame.duration_ms`. */
    readonly instrument: string
    /**
     * How main should map this onto an OTel instrument:
     *  - `histogram`  → `Histogram.record(value)` (distributions: frame/longtask/INP)
     *  - `gauge`      → `Gauge.record(value)` (latest reading: visible/total nodes)
     *  - `counter`    → `Counter.add(value)` (monotonic totals: dropped frames, node-added)
     */
    readonly kind: 'histogram' | 'gauge' | 'counter'
    readonly value: number
    /** UCUM unit, e.g. `ms`, `1`. */
    readonly unit?: string
    readonly attributes?: Readonly<Record<string, string | number>>
}

/** A span describing a renderer interaction, recorded with explicit timing. */
export interface RendererSpan {
    /** Span name, e.g. `renderer.interaction.zoom`. */
    readonly name: string
    readonly startEpochMs: number
    readonly endEpochMs: number
    readonly attributes?: Readonly<Record<string, string | number | boolean>>
    readonly events?: readonly RendererSpanEvent[]
    /**
     * W3C `traceparent` of a daemon read the interaction triggered, so the
     * renderer span stitches to the graphd trace. Omitted for pure-renderer
     * interactions.
     */
    readonly traceparent?: string
}

export interface RendererSpanEvent {
    readonly name: string
    readonly epochMs: number
    readonly attributes?: Readonly<Record<string, string | number>>
}

/** One IPC flush from the renderer probe to main. */
export interface RendererTelemetryBatch {
    readonly metrics: readonly RendererMetricPoint[]
    readonly spans: readonly RendererSpan[]
}

/** Frame is dropped when it overran one 60Hz budget (16.7ms). */
export const FRAME_BUDGET_MS = 1000 / 60

/** A badly janky frame overran two 30Hz budgets (33.3ms). */
export const FRAME_JANK_MS = 1000 / 30

/**
 * Exact percentile of an unsorted sample set via nearest-rank. Returns 0 for
 * an empty set. Pure.
 */
export function percentile(values: readonly number[], p: number): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const rank = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[Math.max(0, Math.min(rank, sorted.length - 1))]!
}

export interface FrameStats {
    readonly count: number
    readonly p50: number
    readonly p95: number
    readonly p99: number
    readonly max: number
    /** Fraction (0..1) of frames over 16.7ms. */
    readonly droppedFraction: number
    /** Fraction (0..1) of frames over 33.3ms. */
    readonly jankFraction: number
}

/** Summarise a set of frame durations (ms). Pure. */
export function summariseFrames(durationsMs: readonly number[]): FrameStats {
    const count = durationsMs.length
    if (count === 0) {
        return { count: 0, p50: 0, p95: 0, p99: 0, max: 0, droppedFraction: 0, jankFraction: 0 }
    }
    const dropped = durationsMs.filter(d => d > FRAME_BUDGET_MS).length
    const jank = durationsMs.filter(d => d > FRAME_JANK_MS).length
    return {
        count,
        p50: percentile(durationsMs, 50),
        p95: percentile(durationsMs, 95),
        p99: percentile(durationsMs, 99),
        max: Math.max(...durationsMs),
        droppedFraction: dropped / count,
        jankFraction: jank / count,
    }
}

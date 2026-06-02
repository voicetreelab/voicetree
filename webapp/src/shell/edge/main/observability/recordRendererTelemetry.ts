/**
 * Electron-main consumer of renderer perf telemetry.
 *
 * The renderer probe (`rendererPerfProbe.ts`) has no OTel SDK; it batches plain
 * JSON over preload IPC. This module maps each batch onto the OpenTelemetry
 * instruments and tracer of the EXISTING main-process provider (registered by
 * `observabilityMetrics.init` / `tracing.init` in `main.ts`) — no parallel
 * exporter. Metrics land in VictoriaMetrics, spans in Tempo, both carrying the
 * run's `service.instance.id` so they correlate with graphd.
 *
 * Instruments are created lazily and memoised by name. The renderer's metrics
 * are attributed to `service.name=vt-electron-main` (the main provider's
 * resource) and tagged `source=renderer`; correlation across signals is by
 * `service.instance.id` (the run id), per the perf-stack design.
 */
import { metrics, trace, propagation, context, type Histogram, type Counter, type Gauge, type Span } from '@opentelemetry/api'
import type {
    RendererMetricPoint,
    RendererSpan,
    RendererTelemetryBatch,
} from '@/shell/perf/rendererTelemetryContract'

const RENDERER_METER_NAME = 'vt-renderer-probe'
const RENDERER_TRACER_NAME = 'vt-renderer'

type Recorder = (batch: RendererTelemetryBatch) => void

/**
 * Build the renderer-telemetry recorder. Holds the lazily-created instrument
 * caches internally — a deep function whose only surface is `record(batch)`.
 */
function createRecorder(): Recorder {
    const histograms = new Map<string, Histogram>()
    const counters = new Map<string, Counter>()
    const gauges = new Map<string, Gauge>()

    const meter = () => metrics.getMeter(RENDERER_METER_NAME)
    const tracer = () => trace.getTracer(RENDERER_TRACER_NAME)

    const histogramFor = (point: RendererMetricPoint): Histogram => {
        const existing = histograms.get(point.instrument)
        if (existing) return existing
        const created = meter().createHistogram(point.instrument, { unit: point.unit })
        histograms.set(point.instrument, created)
        return created
    }
    const counterFor = (point: RendererMetricPoint): Counter => {
        const existing = counters.get(point.instrument)
        if (existing) return existing
        const created = meter().createCounter(point.instrument, { unit: point.unit })
        counters.set(point.instrument, created)
        return created
    }
    const gaugeFor = (point: RendererMetricPoint): Gauge => {
        const existing = gauges.get(point.instrument)
        if (existing) return existing
        const created = meter().createGauge(point.instrument, { unit: point.unit })
        gauges.set(point.instrument, created)
        return created
    }

    const recordMetric = (point: RendererMetricPoint): void => {
        const attributes = { source: 'renderer', ...point.attributes }
        switch (point.kind) {
            case 'histogram': histogramFor(point).record(point.value, attributes); break
            case 'counter': counterFor(point).add(point.value, attributes); break
            case 'gauge': gaugeFor(point).record(point.value, attributes); break
        }
    }

    const recordSpan = (rendererSpan: RendererSpan): void => {
        const parentContext = rendererSpan.traceparent !== undefined
            ? propagation.extract(context.active(), { traceparent: rendererSpan.traceparent })
            : context.active()
        const span: Span = tracer().startSpan(
            rendererSpan.name,
            {
                startTime: rendererSpan.startEpochMs,
                attributes: { source: 'renderer', ...rendererSpan.attributes },
            },
            parentContext,
        )
        for (const event of rendererSpan.events ?? []) {
            span.addEvent(event.name, event.attributes, event.epochMs)
        }
        span.end(rendererSpan.endEpochMs)
    }

    return (batch: RendererTelemetryBatch): void => {
        for (const point of batch.metrics) recordMetric(point)
        for (const rendererSpan of batch.spans) recordSpan(rendererSpan)
    }
}

const record: Recorder = createRecorder()

/**
 * mainAPI handler: forward a renderer telemetry batch to the OTLP exporter.
 * Exposed to the renderer as `window.hostAPI.main.recordRendererTelemetry`
 * via the zero-boilerplate auto-RPC bridge. Resolves once the batch is recorded
 * into the in-memory readers (the periodic exporter ships it on its own cadence).
 */
export function recordRendererTelemetry(batch: RendererTelemetryBatch): Promise<void> {
    record(batch)
    return Promise.resolve()
}

import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { BatchSpanProcessor, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import {
  context,
  propagation,
  SpanStatusCode,
  trace,
  type Span,
  type SpanAttributes,
} from '@opentelemetry/api'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  CompositePropagator,
  ExportResultCode,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core'
import type { ReadableSpan, SpanExporter, SpanProcessor } from '@opentelemetry/sdk-trace-base'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { ATTR_SERVICE_INSTANCE_ID, ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'

// Structural shape of the owner-diagnostic event published by graph-db-client.
// Deliberately NOT imported from `@vt/graph-db-protocol`:
//   - A value import from `@vt/graph-db-client` would close a
//     client → server → observability dependency cycle.
//   - Even a type-only import from `@vt/graph-db-protocol` would make this
//     file a "boundary file" under the pressure-axes measure, which pushes
//     observability's boundary ratio to 1.0 (only 2 files in the package).
// The subscribe function is injected by the shell (see `bridgeOwnerDiagnostics`),
// so this structural shape is the entire surface area observability needs.
type OwnerDiagnosticEvent = {
  readonly kind: string
  readonly attemptId: string
  readonly callerKind: string
  readonly canonicalProjectRoot: string
  readonly nowMs: number
  readonly [key: string]: unknown
}

type OwnerDiagnosticSubscribe = (
  listener: (event: OwnerDiagnosticEvent) => void,
) => void

function hrTimeToMs(hrTime: [number, number]): number {
  return hrTime[0] * 1000 + hrTime[1] / 1_000_000
}

function serializeSpan(span: ReadableSpan): Record<string, unknown> {
  return {
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    parentSpanId: span.parentSpanContext?.spanId,
    name: span.name,
    startTimeMs: hrTimeToMs(span.startTime),
    endTimeMs: hrTimeToMs(span.endTime),
    durationMs: hrTimeToMs(span.duration),
    status: span.status,
    attributes: span.attributes,
    events: span.events.map(event => ({
      name: event.name,
      timeMs: hrTimeToMs(event.time),
      attributes: event.attributes,
    })),
  }
}

// NDJSON file exporter — writes completed spans as one JSON line each
function createNdjsonFileExporter(filePath: string): SpanExporter {
  return {
    export(
      spans: readonly ReadableSpan[],
      resultCallback: (result: { code: number }) => void,
    ) {
      try {
        for (const span of spans) {
          appendFileSync(filePath, JSON.stringify(serializeSpan(span)) + '\n')
        }
        resultCallback({ code: ExportResultCode.SUCCESS })
      } catch {
        resultCallback({ code: ExportResultCode.FAILED })
      }
    },
    shutdown: () => Promise.resolve(),
    forceFlush: () => Promise.resolve(),
  }
}

let tracingInitialized = false

// Reader-env: callers pass their env-derived values explicitly rather than
// `init` reading process.env. Keeps the library's strict-tier implicit-globals
// score honest and lets tests inject without monkeypatching env.
type TracingEnv = {
  readonly otlpEndpoint?: string
  readonly instanceId?: string
}

// Initialize tracing — call once at process startup.
// Always writes NDJSON spans to ~/.voicetree/traces/<serviceName>.ndjson.
// Additionally exports to an OTLP gRPC endpoint when `env.otlpEndpoint` is a
// non-empty string. Resource attributes carry service.name and
// service.instance.id (from `env.instanceId`) so a single Grafana view can
// filter by run.
function initTracingImpl(serviceName: string, env: TracingEnv = {}): void {
  if (tracingInitialized) {
    return
  }
  tracingInitialized = true

  const traceDir = join(homedir(), '.voicetree', 'traces')
  mkdirSync(traceDir, { recursive: true })
  const traceFile = join(traceDir, `${serviceName}.ndjson`)

  const spanProcessors: SpanProcessor[] = [
    new SimpleSpanProcessor(createNdjsonFileExporter(traceFile)),
  ]

  if (env.otlpEndpoint && env.otlpEndpoint.length > 0) {
    spanProcessors.push(
      new BatchSpanProcessor(new OTLPTraceExporter({ url: env.otlpEndpoint })),
    )
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_INSTANCE_ID]:
      env.instanceId && env.instanceId.length > 0 ? env.instanceId : serviceName,
  })

  const provider = new NodeTracerProvider({ resource, spanProcessors })
  provider.register()
  // Register the W3C trace-context + baggage propagator so cross-process
  // HTTP calls (client → daemon) inject `traceparent` and remote handlers
  // attach their spans to the caller's trace.
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [
        new W3CTraceContextPropagator(),
        new W3CBaggagePropagator(),
      ],
    }),
  )
}

type TraceOperation<T> = (span: Span) => T | Promise<T>
type SyncTraceOperation<T> = (span: Span) => T

const tracer = trace.getTracer('@vt/observability')

function recordSpanError(span: Span, error: unknown): void {
  span.recordException(error instanceof Error ? error : String(error))
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error instanceof Error ? error.message : String(error),
  })
}

async function spanImpl<T>(
  name: string,
  operation: TraceOperation<T>,
  attributes: SpanAttributes = {},
): Promise<T> {
  return await tracer.startActiveSpan(name, { attributes }, async (span): Promise<T> => {
    try {
      return await operation(span)
    } catch (error) {
      recordSpanError(span, error)
      throw error
    } finally {
      span.end()
    }
  })
}

function syncSpanImpl<T>(
  name: string,
  operation: SyncTraceOperation<T>,
  attributes: SpanAttributes = {},
): T {
  const span = tracer.startSpan(name, { attributes })
  try {
    return context.with(trace.setSpan(context.active(), span), () => operation(span) as T)
  } catch (error) {
    recordSpanError(span, error)
    throw error
  } finally {
    span.end()
  }
}

let ownerDiagnosticsBridged = false

function flattenOwnerEvent(event: OwnerDiagnosticEvent): Record<string, string | number> {
  const base: Record<string, string | number> = {
    'owner.kind': event.kind,
    'owner.attemptId': event.attemptId,
    'owner.callerKind': event.callerKind,
    'owner.canonicalProjectRoot': event.canonicalProjectRoot,
  }
  for (const [key, value] of Object.entries(event)) {
    if (key === 'kind' || key === 'attemptId' || key === 'callerKind' || key === 'canonicalProjectRoot' || key === 'nowMs') continue
    if (typeof value === 'string' || typeof value === 'number') {
      base[`owner.${key}`] = value
    } else if (value !== undefined && value !== null) {
      base[`owner.${key}`] = String(value)
    }
  }
  return base
}

// Bridges an owner-diagnostic event stream into the registered tracer: one
// OTel span per event. Idempotent. The `subscribe` function is supplied by
// the shell (typically `subscribeOwnerDiagnostics` from @vt/graph-db-client)
// — observability does not import from graph-db-client to avoid a package
// dependency cycle (client→server→observability).
function bridgeOwnerDiagnosticsImpl(
  subscribe: OwnerDiagnosticSubscribe,
  tracerName: string,
): void {
  if (ownerDiagnosticsBridged) return
  ownerDiagnosticsBridged = true
  const ownerTracer = trace.getTracer(tracerName)
  subscribe((event: OwnerDiagnosticEvent) => {
    const span = ownerTracer.startSpan(`owner.${event.kind}`, {
      startTime: event.nowMs,
      attributes: flattenOwnerEvent(event),
    })
    span.end(event.nowMs)
  })
}

export const tracing = {
  /** Initialize tracing once at process startup. NDJSON exporter under ~/.voicetree/traces/<serviceName>.ndjson */
  init: initTracingImpl,
  /** Wrap an async operation in a tracer span. Records errors and ends the span automatically. */
  span: spanImpl,
  /** Synchronous variant of `span`. */
  syncSpan: syncSpanImpl,
  /** Bridge graph-db-client owner-diagnostic events to OTel spans. Idempotent. */
  bridgeOwnerDiagnostics: bridgeOwnerDiagnosticsImpl,
} as const

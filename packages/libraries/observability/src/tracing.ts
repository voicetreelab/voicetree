import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import {
  context,
  SpanStatusCode,
  trace,
  type Span,
  type SpanAttributes,
} from '@opentelemetry/api'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { ExportResultCode } from '@opentelemetry/core'
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base'

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

// Initialize tracing — call once at process startup.
// Writes NDJSON spans to ~/.voicetree/traces/<serviceName>.ndjson
function initTracingImpl(serviceName: string): void {
  if (tracingInitialized) {
    return
  }
  tracingInitialized = true

  const traceDir = join(homedir(), '.voicetree', 'traces')
  mkdirSync(traceDir, { recursive: true })
  const traceFile = join(traceDir, `${serviceName}.ndjson`)

  const provider = new NodeTracerProvider({
    spanProcessors: [
      new SimpleSpanProcessor(createNdjsonFileExporter(traceFile)),
    ],
  })
  provider.register()
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

export const tracing = {
  /** Initialize tracing once at process startup. NDJSON exporter under ~/.voicetree/traces/<serviceName>.ndjson */
  init: initTracingImpl,
  /** Wrap an async operation in a tracer span. Records errors and ends the span automatically. */
  span: spanImpl,
  /** Synchronous variant of `span`. */
  syncSpan: syncSpanImpl,
} as const

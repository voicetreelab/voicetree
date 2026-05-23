import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { propagation } from '@opentelemetry/api'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  CompositePropagator,
  ExportResultCode,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core'
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base'

function hrTimeToMs(hrTime: [number, number]): number {
  return hrTime[0] * 1000 + hrTime[1] / 1_000_000
}

function traceDirectory(homeDirectory: string): string {
  return join(homeDirectory, '.voicetree', 'traces')
}

function traceFilePath(homeDirectory: string, serviceName: string): string {
  return join(traceDirectory(homeDirectory), `${serviceName}.ndjson`)
}

function serializeSpan(span: ReadableSpan): Record<string, unknown> {
  const parentSpanId = (span as ReadableSpan & { parentSpanId?: string }).parentSpanId
  return {
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    parentSpanId,
    name: span.name,
    startTimeMs: hrTimeToMs(span.startTime),
    endTimeMs: hrTimeToMs(span.endTime),
    durationMs: hrTimeToMs(span.duration),
    status: span.status,
    attributes: span.attributes,
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

// Initialize tracing — call once at process startup. Registers the W3C
// trace-context propagator so the daemon can extract `traceparent` from
// incoming HTTP requests and continue the caller's trace.
function initTracing(serviceName: string): void {
  const homeDirectory = homedir()
  const traceDir = traceDirectory(homeDirectory)
  mkdirSync(traceDir, { recursive: true })
  const traceFile = traceFilePath(homeDirectory, serviceName)

  const provider = new NodeTracerProvider({
    spanProcessors: [
      new SimpleSpanProcessor(createNdjsonFileExporter(traceFile)),
    ],
  })
  provider.register()
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [
        new W3CTraceContextPropagator(),
        new W3CBaggagePropagator(),
      ],
    }),
  )
}

export { initTracing }

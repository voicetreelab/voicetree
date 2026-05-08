import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { trace } from '@opentelemetry/api'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { ExportResultCode } from '@opentelemetry/core'
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base'

function hrTimeToMs(hrTime: [number, number]): number {
  return hrTime[0] * 1000 + hrTime[1] / 1_000_000
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
          const json = {
            traceId: span.spanContext().traceId,
            spanId: span.spanContext().spanId,
            parentSpanId: span.parentSpanContext?.spanId,
            name: span.name,
            startTimeMs: hrTimeToMs(span.startTime),
            endTimeMs: hrTimeToMs(span.endTime),
            durationMs: hrTimeToMs(span.duration),
            status: span.status,
            attributes: span.attributes,
          }
          appendFileSync(filePath, JSON.stringify(json) + '\n')
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

// Initialize tracing — call once at process startup
function initTracing(serviceName: string): void {
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

export { initTracing }

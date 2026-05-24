/**
 * Observability for the electron-side graph-daemon lifecycle.
 *
 * Two side-effecting entries — both invoked from `main.ts` (the system
 * boundary, per FP S2 "effect interpretation at the system boundary"):
 *
 *  - `initDaemonObservability()` registers the OTel NodeTracerProvider with
 *    the NDJSON exporter (`~/.voicetree/traces/vt-electron-daemon.ndjson`)
 *    and the W3C trace-context + baggage propagator so client→daemon HTTP
 *    calls inject `traceparent` and daemon handlers attach to the caller
 *    trace.
 *  - `emitOwnerDiagnosticAsSpan` is the listener `main.ts` wires into
 *    `subscribeOwnerDiagnostics` from `@vt/graph-db-client`; it emits one
 *    OTel span per `OwnerDiagnosticEvent` so the claim/wait/reclaim/cooldown
 *    lifecycle is visible without parsing the in-process pub/sub.
 *
 * Keeping `subscribeOwnerDiagnostics` *out* of this file collapses the
 * webapp→graph-db-client coupling edge for this concern — only the shell
 * entry talks to graph-db-client; tracing logic stays a pure handler.
 */

import { propagation, trace, type Tracer } from '@opentelemetry/api'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import {
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base'
import {
  CompositePropagator,
  ExportResultCode,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core'
import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Structural subset of `@vt/graph-db-protocol`'s `OwnerDiagnosticEvent`
 * needed by the span emitter. Declared locally so this module does not
 * import from graph-db-client or graph-db-protocol (the wire-up lives in
 * `main.ts`, which already imports graph-db-client).
 *
 * The four base fields mirror `OwnerDiagnosticEventBase`; arbitrary
 * variant-specific fields surface through the index signature and are
 * flattened into span attributes by `flattenOwnerEvent`.
 */
export type OwnerEventLike = {
  readonly kind: string
  readonly attemptId: string
  readonly callerKind: string
  readonly canonicalProjectRoot: string
  readonly nowMs: number
  readonly [key: string]: unknown
}

const TRACER_NAME = 'vt-electron-daemon'
const SERVICE_NAME = 'vt-electron-daemon'

let initialised = false

/**
 * Register the OTel NodeTracerProvider + W3C propagators. Idempotent —
 * repeat calls are a no-op so accidental double-init during hot reload
 * doesn't re-register span processors.
 */
export function initDaemonObservability(): void {
  if (initialised) return
  initialised = true
  registerNodeTracerProvider()
}

/**
 * Tracer accessor. Safe to call before `initDaemonObservability()` —
 * the API returns a no-op tracer until the provider is registered.
 */
export function daemonTracer(): Tracer {
  return trace.getTracer(TRACER_NAME)
}

/**
 * Listener for `subscribeOwnerDiagnostics`. Wired by `main.ts` so this
 * module does not depend on `@vt/graph-db-client`.
 */
export function emitOwnerDiagnosticAsSpan(event: OwnerEventLike): void {
  const span = daemonTracer().startSpan(`owner.${event.kind}`, {
    startTime: event.nowMs,
    attributes: flattenOwnerEvent(event),
  })
  span.end(event.nowMs)
}

function registerNodeTracerProvider(): void {
  const traceDir = join(homedir(), '.voicetree', 'traces')
  mkdirSync(traceDir, { recursive: true })
  const traceFile = join(traceDir, `${SERVICE_NAME}.ndjson`)

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

function hrTimeToMs(hrTime: [number, number]): number {
  return hrTime[0] * 1000 + hrTime[1] / 1_000_000
}

function flattenOwnerEvent(event: OwnerEventLike): Record<string, string | number> {
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

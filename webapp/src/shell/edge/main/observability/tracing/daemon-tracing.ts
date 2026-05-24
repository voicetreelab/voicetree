/**
 * Owner-diagnostic → OTel-span bridge for the electron main process.
 *
 * The actual NodeTracerProvider + NDJSON exporter + W3C propagators are
 * registered by `@vt/observability`'s `tracing.init('vt-electron-main')`
 * (invoked from `main.ts`). This module only provides:
 *
 *  - `daemonTracer()`: a `vt-electron-daemon`-named tracer accessor —
 *    `trace.getTracer` returns whatever provider was registered, so spans
 *    issued here flow to the shared NDJSON file.
 *  - `emitOwnerDiagnosticAsSpan`: the listener `main.ts` wires into
 *    `subscribeOwnerDiagnostics` from `@vt/graph-db-client`, emitting one
 *    OTel span per `OwnerDiagnosticEvent` so the claim/wait/reclaim/cooldown
 *    lifecycle is visible without parsing the in-process pub/sub.
 *
 * Keeping `subscribeOwnerDiagnostics` *out* of this file means there is no
 * webapp/observability → graph-db-client edge for this concern — only the
 * shell entry (`main.ts`) talks to graph-db-client; tracing logic stays a
 * pure handler.
 */

import { trace, type Tracer } from '@opentelemetry/api'

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

/**
 * Tracer accessor. Safe to call before `tracing.init` runs in main.ts —
 * the OTel API returns a no-op tracer until the provider is registered.
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

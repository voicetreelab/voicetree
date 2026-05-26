/**
 * In-process emitter for `OwnerDiagnosticEvent` (BF-347).
 *
 * The emitter is a minimal pub/sub: callers register a listener, an
 * unsubscribe handle is returned, emissions are best-effort and non-
 * blocking. No default sink — the protocol must stay quiet unless
 * something explicitly subscribes (operator log, tracing exporter, test
 * capture).
 *
 * Listener failures are swallowed so one broken consumer cannot break
 * the daemon lifecycle. The event-type union `OwnerDiagnosticEvent`
 * lives in `@vt/graph-db-protocol` (BF-347 ratified that as the
 * canonical home); this module is the runtime bus around it. Both
 * graphd and vtd lifecycle paths share a single bus so subscribers
 * observe one unified stream.
 */

import type { OwnerDiagnosticEvent } from '@vt/graph-db-protocol'

export type OwnerDiagnosticListener = (event: OwnerDiagnosticEvent) => void

export type OwnerDiagnosticUnsubscribe = () => void

const listeners = new Set<OwnerDiagnosticListener>()

/**
 * Register a listener for ownership diagnostic events. Returns an
 * unsubscribe handle that removes the listener; idempotent across
 * repeat calls.
 */
export function subscribeOwnerDiagnostics(
  listener: OwnerDiagnosticListener,
): OwnerDiagnosticUnsubscribe {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Emit a single event to all current listeners. Synchronous and non-
 * throwing — a listener exception is swallowed so emission cannot affect
 * the ownership work loop.
 */
export function emitOwnerDiagnostic(event: OwnerDiagnosticEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      // observers must not destabilise the protocol
    }
  }
}

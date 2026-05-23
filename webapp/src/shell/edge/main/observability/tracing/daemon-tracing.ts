/**
 * Observability for the electron-side graph-daemon lifecycle.
 *
 * Single public entry — call once during app startup. Internally wires:
 *
 *  - OTel NDJSON exporter via `initTracing('vt-electron-daemon')` →
 *    `~/.voicetree/traces/vt-electron-daemon.ndjson`.
 *  - A `subscribeOwnerDiagnostics` listener that emits one OTel span per
 *    `OwnerDiagnosticEvent` so the claim/wait/reclaim/cooldown lifecycle
 *    is visible without parsing the in-process pub/sub.
 *  - A 10-second rate logger that prints aggregate counters when any
 *    counter incremented in the window — the at-a-glance "are we spinning?"
 *    signal that catches recovery-loop regressions before NDJSON inspection.
 *
 * Counters are mutated through `recordDaemonEvent`, exposed below so the
 * graph-daemon module can increment them inline without depending on the
 * tracer plumbing.
 */

import { trace, type Tracer } from '@opentelemetry/api'
import {
  initTracing,
  subscribeOwnerDiagnostics,
  type OwnerDiagnosticListener,
} from '@vt/graph-db-client'
import type { OwnerDiagnosticEvent } from '@vt/graph-db-protocol'

const TRACER_NAME = 'vt-electron-daemon'
const SERVICE_NAME = 'vt-electron-daemon'
const RATE_LOG_INTERVAL_MS = 10_000

export type DaemonCounterKind =
  | 'callDaemon'
  | 'connectionFailure'
  | 'recoveryAttempt'
  | 'firstTimeEnsure'
  | 'vaultLost'

type CounterSnapshot = Record<DaemonCounterKind, number>

const counters: CounterSnapshot = {
  callDaemon: 0,
  connectionFailure: 0,
  recoveryAttempt: 0,
  firstTimeEnsure: 0,
  vaultLost: 0,
}

let rateLogTimer: NodeJS.Timeout | null = null
let initialised = false

/**
 * Public entry. Idempotent — repeat calls are a no-op so accidental
 * double-init during hot reload doesn't re-register span processors.
 */
export function initDaemonObservability(): void {
  if (initialised) return
  initialised = true
  initTracing(SERVICE_NAME)
  subscribeOwnerDiagnostics(emitOwnerDiagnosticAsSpan)
  startRateLogger()
}

/**
 * Tracer accessor for the daemon-side instrumentation. Safe to call before
 * `initDaemonObservability()` — the NodeTracerProvider returns a no-op
 * tracer until the provider is registered.
 */
export function daemonTracer(): Tracer {
  return trace.getTracer(TRACER_NAME)
}

/**
 * Increment one of the daemon counters. The 10-second rate logger flushes
 * a snapshot whenever any counter changed in the window.
 */
export function recordDaemonEvent(kind: DaemonCounterKind): void {
  counters[kind] += 1
}

function emitOwnerDiagnosticAsSpan(event: OwnerDiagnosticEvent): void {
  const span = daemonTracer().startSpan(`owner.${event.kind}`, {
    startTime: event.nowMs,
    attributes: flattenOwnerEvent(event),
  })
  span.end(event.nowMs)
}

function flattenOwnerEvent(event: OwnerDiagnosticEvent): Record<string, string | number> {
  const base: Record<string, string | number> = {
    'owner.kind': event.kind,
    'owner.attemptId': event.attemptId,
    'owner.callerKind': event.callerKind,
    'owner.canonicalVaultPath': event.canonicalVaultPath,
  }
  for (const [key, value] of Object.entries(event)) {
    if (key === 'kind' || key === 'attemptId' || key === 'callerKind' || key === 'canonicalVaultPath' || key === 'nowMs') continue
    if (typeof value === 'string' || typeof value === 'number') {
      base[`owner.${key}`] = value
    } else if (value !== undefined && value !== null) {
      base[`owner.${key}`] = String(value)
    }
  }
  return base
}

function startRateLogger(): void {
  if (rateLogTimer) return
  let previous: CounterSnapshot = { ...counters }
  rateLogTimer = setInterval(() => {
    const delta = computeDelta(previous, counters)
    if (anyNonZero(delta)) {
      const snapshot = JSON.stringify({ kind: 'daemon-rate', windowMs: RATE_LOG_INTERVAL_MS, delta, total: { ...counters } })
      console.warn(`[daemon-obs] ${snapshot}`)
    }
    previous = { ...counters }
  }, RATE_LOG_INTERVAL_MS)
  rateLogTimer.unref?.()
}

function computeDelta(previous: CounterSnapshot, current: CounterSnapshot): CounterSnapshot {
  return {
    callDaemon: current.callDaemon - previous.callDaemon,
    connectionFailure: current.connectionFailure - previous.connectionFailure,
    recoveryAttempt: current.recoveryAttempt - previous.recoveryAttempt,
    firstTimeEnsure: current.firstTimeEnsure - previous.firstTimeEnsure,
    vaultLost: current.vaultLost - previous.vaultLost,
  }
}

function anyNonZero(delta: CounterSnapshot): boolean {
  return delta.callDaemon > 0
    || delta.connectionFailure > 0
    || delta.recoveryAttempt > 0
    || delta.firstTimeEnsure > 0
    || delta.vaultLost > 0
}

export type { OwnerDiagnosticListener }

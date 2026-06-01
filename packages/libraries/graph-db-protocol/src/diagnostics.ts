/**
 * Structured ownership lifecycle events emitted by the vt-graphd single-owner
 * protocol (BF-347).
 *
 * The type lives in `@vt/graph-db-protocol` so every participant — the
 * graph-db-client `ensureGraphDaemonForProject` orchestrator, future
 * server-side emitters, Electron-side bounded recovery, and tests — can
 * subscribe to the same shape without inventing parallel event types.
 *
 * The discriminated union covers every lifecycle decision callable agents
 * make about ownership: discovery (`claim-attempt`, `reuse`, `wait`,
 * `acquired`), spawn (`spawn-started`, `spawn-ready`, `spawn-failed`),
 * reclamation (`stale-reclaimed`), and suppression
 * (`cooldown-suppressed`, `duplicate-process-detected`).
 *
 * Each event carries the originating caller and canonical project path plus
 * any identifiers that were known when the decision was made. Listeners
 * are expected to be pure observers — emission must not depend on a sink
 * existing.
 */

import type { CallerKind } from './owner.ts'

/**
 * Fields common to every diagnostic event. The `attemptId` is a per-ensure
 * call identifier so listeners can correlate a chain of events (e.g.
 * `claim-attempt` → `spawn-started` → `spawn-ready`) without inferring
 * causality from timing alone.
 */
type OwnerDiagnosticEventBase = {
  readonly attemptId: string
  readonly callerKind: CallerKind
  readonly canonicalProject: string
  readonly nowMs: number
}

export type ClaimAttemptEvent = OwnerDiagnosticEventBase & {
  readonly kind: 'claim-attempt'
  readonly reason: 'no-owner' | 'stale-reclaim'
}

export type ReuseEvent = OwnerDiagnosticEventBase & {
  readonly kind: 'reuse'
  readonly pid: number
  readonly port: number
  readonly ownerNonce: string
}

export type WaitEvent = OwnerDiagnosticEventBase & {
  readonly kind: 'wait'
  readonly reason: 'owner-starting' | 'owner-not-ready'
  readonly recordedPid: number
  readonly recordedPort: number | null
}

export type AcquiredEvent = OwnerDiagnosticEventBase & {
  readonly kind: 'acquired'
  readonly pid: number
  readonly port: number
  readonly ownerNonce: string
}

export type StaleReclaimedEvent = OwnerDiagnosticEventBase & {
  readonly kind: 'stale-reclaimed'
  readonly reason: 'dead-pid' | 'stale-heartbeat'
  readonly recordedPid: number
}

export type SpawnStartedEvent = OwnerDiagnosticEventBase & {
  readonly kind: 'spawn-started'
  readonly childPid: number | null
}

export type SpawnReadyEvent = OwnerDiagnosticEventBase & {
  readonly kind: 'spawn-ready'
  readonly pid: number
  readonly port: number
  readonly ownerNonce: string
}

export type SpawnFailedEvent = OwnerDiagnosticEventBase & {
  readonly kind: 'spawn-failed'
  readonly childPid: number | null
  readonly errorName: string
  readonly errorMessage: string
}

export type CooldownSuppressedEvent = OwnerDiagnosticEventBase & {
  readonly kind: 'cooldown-suppressed'
  readonly untilMs: number
  readonly reason: string
}

export type DuplicateProcessDetectedEvent = OwnerDiagnosticEventBase & {
  readonly kind: 'duplicate-process-detected'
  readonly firstPid: number
  readonly secondPid: number
}

export type OwnerDiagnosticEvent =
  | ClaimAttemptEvent
  | ReuseEvent
  | WaitEvent
  | AcquiredEvent
  | StaleReclaimedEvent
  | SpawnStartedEvent
  | SpawnReadyEvent
  | SpawnFailedEvent
  | CooldownSuppressedEvent
  | DuplicateProcessDetectedEvent

export type OwnerDiagnosticEventKind = OwnerDiagnosticEvent['kind']

export const OWNER_DIAGNOSTIC_EVENT_KINDS: readonly OwnerDiagnosticEventKind[] = [
  'claim-attempt',
  'reuse',
  'wait',
  'acquired',
  'stale-reclaimed',
  'spawn-started',
  'spawn-ready',
  'spawn-failed',
  'cooldown-suppressed',
  'duplicate-process-detected',
] as const

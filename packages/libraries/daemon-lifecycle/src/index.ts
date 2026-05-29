/**
 * @vt/daemon-lifecycle — shared ownership lifecycle primitives.
 *
 * Factored from graph-db-server + graph-db-client (BF-369) so the same
 * machinery drives both the vt-graphd ownership protocol and the vt-daemon
 * standalone controller (BF-370+). Every primitive is daemon-kind
 * parameterised: a single vault can own a `graphd` daemon and a `vtd`
 * daemon simultaneously without their state colliding.
 *
 * The package has zero HTTP-client dependencies — the per-daemon ensure
 * orchestrator (`attemptSpawnAndWait`) lives in each daemon-client
 * package and is templated over `clientFor(port): TClient` so the
 * orchestrator's control flow is shared without forcing this package to
 * depend on either GraphDbClient or VtDaemonClient.
 */

// Protocol re-exports: the on-disk schema, DaemonKind, and the event-type
// union all live in @vt/graph-db-protocol (BF-347 ratified it as the
// canonical home for the protocol shapes). We re-export here so daemon-
// lifecycle consumers see one cohesive surface.
export {
  ownerRecordFile,
  type OwnerRecord,
  type CallerKind,
  type CommandFingerprint,
  type CreateOwnerRecordInput,
  type OwnerHealthIdentity,
  type DaemonKind,
  type OwnerDiagnosticEvent,
} from '@vt/graph-db-protocol'

// Owner record I/O (pure value-level + atomic file ops).
export {
  atomicReplaceOwnerRecord,
  createInitialRecord,
  decodeOwnerRecord,
  deleteOwnerRecord,
  isOwnerPidAlive,
  readOwnerRecord,
  tryAtomicCreate,
  withBoundPort,
  withHeartbeat,
} from './ownerRecordIo.ts'
export type {
  AtomicCreateOutcome,
  CreateInitialRecordInput,
} from './ownerRecordIo.ts'

// Pure decision rule + evidence model.
export { decideOwnerAction } from './ownerDecision.ts'
export type {
  ClaimDecision,
  ClaimReason,
  CommandFingerprintMatch,
  Cooldown,
  CooldownSuppressedDecision,
  HealthProbeResult,
  OwnerDecision,
  OwnerDecisionPolicy,
  OwnerEvidence,
  ProcessLiveness,
  ReuseDecision,
  StaleReclaimDecision,
  StaleReclaimReason,
  UnsafeOwnerDecision,
  UnsafeOwnerReason,
  WaitDecision,
  WaitReason,
} from './ownerDecision.ts'

// Cross-process spawn lock.
export { acquireSpawnLock, spawnLockPathFor } from './spawnLock.ts'
export type { SpawnLockAcquisition } from './spawnLock.ts'

// Cooldown breadcrumb (pure projection + atomic file ops).
export {
  clearCooldownBreadcrumb,
  cooldownBreadcrumbPathFor,
  decideActiveCooldown,
  readCooldownBreadcrumb,
  writeCooldownBreadcrumb,
} from './cooldownBreadcrumb.ts'
export type { CooldownBreadcrumb } from './cooldownBreadcrumb.ts'

// Process probes.
export {
  readCommandFingerprintMatch,
  readProcessLiveness,
} from './processLiveness.ts'
export { probeOwnerHealth } from './healthIdentityProbe.ts'
export type { ProbeHealthOptions } from './healthIdentityProbe.ts'

// Generic detached spawn (no client class — that stays in graph-db-client
// / vt-daemon-client).
export { spawnDaemon } from './spawnDaemon.ts'
export type {
  SpawnDaemonInput,
  SpawnedDaemonHandle,
  SpawnEnvVarShape,
} from './spawnDaemon.ts'

// Parent-pid watchdogs (two distinct primitives, both useful).
export { startParentPidWatchdog } from './parentPidWatchdog.ts'
export type {
  ParentPidWatchdogHandle,
  ParentPidWatchdogOptions,
  ParentPidWatchdogScheduler,
  ParentPidWatchdogTimer,
} from './parentPidWatchdog.ts'
export { startParentWatch } from './parentReparentWatch.ts'
export type {
  ParentWatchDeps,
  ParentWatchHandle,
  ParentWatchOptions,
} from './parentReparentWatch.ts'

// Poll-timing primitives.
export { boundedDelay, nextBackoff, sleep } from './pollTimings.ts'

// Error shapes.
export {
  DaemonLaunchTimeout,
  OwnerSpawnCooldownError,
  OwnerWaitTimeoutError,
  UnsafeOwnerError,
} from './errors.ts'

// Diagnostics bus (consumers subscribe to a single shared stream).
export {
  emitOwnerDiagnostic,
  subscribeOwnerDiagnostics,
} from './diagnostics.ts'
export type {
  OwnerDiagnosticListener,
  OwnerDiagnosticUnsubscribe,
} from './diagnostics.ts'

// Vault path facade — every artifact under <vault>/.voicetree resolves
// through one function.
export { projectStateDir } from './projectPaths.ts'

import type {
  emitOwnerDiagnostic,
  readOwnerRecord,
  sleep,
} from '@vt/daemon-lifecycle'
import type {
  attemptSpawnAndWait,
  gatherEvidence,
  reclaimStaleOwner,
} from '@vt/graph-db-client/autoLaunch/spawnCoordinator'
import type { CommandSpec } from '@vt/graph-db-client/autoLaunch/runtime'

export type EnsureVtDaemonOptions = {
  /** Hard deadline for the whole ensure call. Default 5000ms. */
  readonly timeoutMs?: number
  /**
   * Optional override of the daemon command (`<bin> [args] --project <path>`).
   * Primarily for tests that point at a fake VTD entrypoint. Also honored
   * via `VT_DAEMON_BIN` env var inside the runtime resolver.
   */
  readonly bin?: string
  /**
   * Maximum heartbeat age tolerated before stale-reclaim becomes possible.
   * Default 15s (matches graphd's heartbeats-every-2s cadence).
   */
  readonly staleHeartbeatMs?: number
  /** Initial poll backoff. Default 50ms. */
  readonly initialBackoffMs?: number
  /** Maximum poll backoff. Default 400ms. */
  readonly maxBackoffMs?: number
  /**
   * Cooldown window persisted to `<project>/.voicetree/vtd.cooldown.json`
   * after a spawn fails. Subsequent ensure calls within this window
   * short-circuit with {@link OwnerSpawnCooldownError} before re-spawning.
   * Default 5000ms.
   */
  readonly spawnCooldownMs?: number
}

export type EnsureVtDaemonClient = {
  readonly authToken: string
}

export type EnsureVtDaemonResult<TClient extends EnsureVtDaemonClient = EnsureVtDaemonClient> = {
  readonly client: TClient
  readonly port: number
  readonly pid: number
  readonly ownerNonce: string
  /**
   * Bearer auth token the daemon published to
   * `<project>/.voicetree/auth-token` on startup. The same value is closed
   * over inside `client` for `rpc()` calls; surfaced here so Phase 2
   * consumers (Electron Main -> renderer IPC, voicetree-cli serve) can
   * pass it across a process boundary without re-reading the file.
   */
  readonly authToken: string
  /**
   * True when this call spawned the daemon child that won ownership.
   * False when an existing healthy owner was reused or a waited-on
   * in-flight owner finalised before our spawn attempt.
   */
  readonly launched: boolean
}

export type EnsureVtDaemonState<TClient extends EnsureVtDaemonClient = EnsureVtDaemonClient> = {
  readonly inflightByProject: Map<string, Promise<EnsureVtDaemonResult<TClient>>>
}

export type EnsureVtDaemonDeps<TClient extends EnsureVtDaemonClient = EnsureVtDaemonClient> = {
  readonly attemptSpawnAndWait: typeof attemptSpawnAndWait
  readonly clientFor: (port: number, project: string) => TClient
  readonly emitOwnerDiagnostic: typeof emitOwnerDiagnostic
  readonly gatherEvidence: typeof gatherEvidence
  readonly mkdir: (path: string, opts: { readonly recursive: true }) => Promise<unknown>
  readonly newAttemptId: () => string
  readonly now: () => number
  readonly readOwnerRecord: typeof readOwnerRecord
  readonly reclaimStaleOwner: typeof reclaimStaleOwner
  readonly resolveCommand: (project: string, override?: string) => CommandSpec
  readonly resolvePath: (path: string) => string
  readonly sleep: typeof sleep
}

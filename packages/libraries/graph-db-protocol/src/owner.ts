/**
 * Vault-scoped daemon ownership contract.
 *
 * The on-disk owner record at `<vault>/.voicetree/${daemonKind}.owner.json`
 * is the cross-process arbiter for "which `${daemonKind}` process owns this
 * vault". Two daemon kinds participate today — `graphd` (vt-graphd) and
 * `vtd` (the VTD standalone controller, BF-370+). Each kind owns its own
 * record at a sibling path so the two daemons can coexist for the same
 * vault without interfering.
 *
 * Both the graph-db-server daemon (BF-343) and the graph-db-client launcher
 * (BF-344) read and write the same shape, so the *format* is the shared
 * contract — not a parallel pile of validators and constants. BF-369 lifted
 * the runtime helpers into `@vt/daemon-lifecycle`; this module remains the
 * single owner of the on-disk shape.
 *
 * The package exposes:
 *
 *   - Five types: `OwnerRecord`, `OwnerHealthIdentity`, `CallerKind`,
 *     `CommandFingerprint`, `DaemonKind`. Free at the coupling gate
 *     (type-only imports).
 *   - One value: `ownerRecordFile`, a small facade with `pathFor`, `decode`,
 *     `encode`, and `create`. Everything callers need to read/write the
 *     record on disk goes through that one symbol.
 *
 * Validators (`isOwnerRecord`, `isCallerKind`), constants
 * (`OWNER_RECORD_SCHEMA_VERSION`, `CALLER_KINDS`) are intentionally NOT
 * exported. They are implementation details of `decode` / `create` /
 * `isOwnerRecord` and have no caller use case outside this module.
 */

import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {getProjectDotVoicetreePath} from '@vt/paths'

const OWNER_RECORD_SCHEMA_VERSION = 1 as const

export type OwnerRecordSchemaVersion = typeof OWNER_RECORD_SCHEMA_VERSION

export type CallerKind =
  | 'electron'
  | 'electron-main'
  | 'cli'
  | 'mcp'
  | 'graph-db-client'
  | 'test'
  // The standalone vt-daemon (VTD) binary self-identifies as 'vtd' when it
  // claims its own owner record AND when it acts as a client to vt-graphd
  // via ensureGraphDaemonForVault('vtd'). Distinct from 'cli' (which is the
  // voicetree-cli binary acting as a client to either daemon) so post-mortem
  // analysis of an owner record can attribute the caller correctly.
  | 'vtd'

const CALLER_KINDS: readonly CallerKind[] = [
  'electron',
  'electron-main',
  'cli',
  'mcp',
  'graph-db-client',
  'test',
  'vtd',
] as const

/**
 * Which long-running daemon this record describes. The discriminant
 * parameterises every on-disk filename and the lifecycle policy, so a
 * single vault can host (at most) one graphd owner and one vtd owner
 * simultaneously without their state ever colliding.
 */
export type DaemonKind = 'graphd' | 'vtd'

const DAEMON_KINDS: readonly DaemonKind[] = ['graphd', 'vtd'] as const

export type CommandFingerprint = {
  readonly executable: string
  readonly args: readonly string[]
}

export type OwnerRecord = {
  readonly schemaVersion: OwnerRecordSchemaVersion
  readonly daemonKind: DaemonKind
  readonly canonicalVault: string
  readonly pid: number
  readonly ppid: number
  /**
   * Port the daemon has bound. `null` while a claim exists but the daemon
   * has not yet bound its loopback socket. Discovery treats a port-less
   * record as an in-flight owner that callers should wait for.
   */
  readonly port: number | null
  /**
   * Random per-claim nonce. Discovery accepts a daemon only when its
   * `/health` identity reports the same nonce; this defends against pid
   * reuse and concurrent claims racing for the same vault.
   */
  readonly ownerNonce: string
  readonly startedAtMs: number
  readonly heartbeatAtMs: number
  readonly callerKind: CallerKind
  readonly contractVersion: string
  readonly commandFingerprint: CommandFingerprint
}

/**
 * Owner-identifying subset of a `/health` response. The shape is decoupled
 * from the full {@link HealthResponse} so callers can construct evidence
 * for the pure decision functions from any verified probe (HTTP probe,
 * tests, future protocol additions).
 */
export type OwnerHealthIdentity = {
  readonly canonicalVault: string
  readonly ownerNonce: string
  readonly pid: number
  readonly port: number
  readonly contractVersion: string
}

function ownerRecordFilenameFor(daemonKind: DaemonKind): string {
  return `${daemonKind}.owner.json`
}

function isCallerKind(value: unknown): value is CallerKind {
  return (
    typeof value === 'string' &&
    (CALLER_KINDS as readonly string[]).includes(value)
  )
}

function isDaemonKind(value: unknown): value is DaemonKind {
  return (
    typeof value === 'string' &&
    (DAEMON_KINDS as readonly string[]).includes(value)
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isPort(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 65535
  )
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isCommandFingerprint(value: unknown): value is CommandFingerprint {
  if (!isObject(value)) return false
  if (typeof value.executable !== 'string') return false
  if (!Array.isArray(value.args)) return false
  return value.args.every((arg) => typeof arg === 'string')
}

function isOwnerRecord(value: unknown): value is OwnerRecord {
  if (!isObject(value)) return false
  if (value.schemaVersion !== OWNER_RECORD_SCHEMA_VERSION) return false
  if (!isDaemonKind(value.daemonKind)) return false
  if (typeof value.canonicalVault !== 'string') return false
  if (!isPositiveInteger(value.pid)) return false
  if (!isNonNegativeInteger(value.ppid)) return false
  if (value.port !== null && !isPort(value.port)) return false
  if (!isNonEmptyString(value.ownerNonce)) return false
  if (!isNonNegativeFiniteNumber(value.startedAtMs)) return false
  if (!isNonNegativeFiniteNumber(value.heartbeatAtMs)) return false
  if (!isCallerKind(value.callerKind)) return false
  if (typeof value.contractVersion !== 'string') return false
  if (!isCommandFingerprint(value.commandFingerprint)) return false
  return true
}

function pathFor(vaultDir: string, daemonKind: DaemonKind): string {
  return join(getProjectDotVoicetreePath(vaultDir), ownerRecordFilenameFor(daemonKind))
}

function decode(raw: string): OwnerRecord | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  return isOwnerRecord(value) ? value : null
}

function encode(record: OwnerRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`
}

export type CreateOwnerRecordInput = {
  readonly daemonKind: DaemonKind
  readonly canonicalVault: string
  readonly pid: number
  readonly ppid: number
  readonly callerKind: CallerKind
  readonly contractVersion: string
  readonly commandFingerprint: CommandFingerprint
  readonly nowMs: number
  readonly ownerNonce?: string
}

/**
 * Build the initial owner record at claim time. Port is `null` until the
 * daemon binds its loopback socket. The schema version is stamped here so
 * callers never reach for the constant directly.
 */
function create(input: CreateOwnerRecordInput): OwnerRecord {
  return {
    schemaVersion: OWNER_RECORD_SCHEMA_VERSION,
    daemonKind: input.daemonKind,
    canonicalVault: input.canonicalVault,
    pid: input.pid,
    ppid: input.ppid,
    port: null,
    ownerNonce: input.ownerNonce ?? randomUUID(),
    startedAtMs: input.nowMs,
    heartbeatAtMs: input.nowMs,
    callerKind: input.callerKind,
    contractVersion: input.contractVersion,
    commandFingerprint: input.commandFingerprint,
  }
}

/**
 * The single runtime surface of the owner protocol. Both client and server
 * import this one symbol; individual helpers are not re-exported because
 * the on-disk format and its validators are a single capability that must
 * not be reached around (Pattern P2 falsifier: callers reach around the
 * narrow boundary — revert if observed).
 */
export const ownerRecordFile = {
  pathFor,
  decode,
  encode,
  create,
} as const

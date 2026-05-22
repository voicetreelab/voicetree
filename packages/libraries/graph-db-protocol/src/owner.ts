/**
 * Vault-scoped vt-graphd ownership contract.
 *
 * Both the graph-db-server daemon (BF-343) and the graph-db-client launcher
 * (BF-344) read and write this shape under `<vault>/.voicetree/`. The types
 * live in the protocol package because they are the on-disk format shared by
 * every caller: a single shape lets pure decision functions (BF-342's
 * `decideOwnerAction`) coordinate reuse / wait / claim / reclaim across
 * processes without either side inventing a parallel shape.
 *
 * Originally introduced by BF-342 inside graph-db-client; relocated here in
 * BF-343 once graph-db-server needed to read/write the same record without a
 * circular package dependency.
 */

export const OWNER_RECORD_SCHEMA_VERSION = 1

export type OwnerRecordSchemaVersion = typeof OWNER_RECORD_SCHEMA_VERSION

export type CallerKind =
  | 'electron'
  | 'electron-main'
  | 'cli'
  | 'mcp'
  | 'graph-db-client'
  | 'test'

export const CALLER_KINDS: readonly CallerKind[] = [
  'electron',
  'electron-main',
  'cli',
  'mcp',
  'graph-db-client',
  'test',
] as const

export type CommandFingerprint = {
  readonly executable: string
  readonly args: readonly string[]
}

export type OwnerRecord = {
  readonly schemaVersion: OwnerRecordSchemaVersion
  readonly canonicalVaultPath: string
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
  readonly canonicalVaultPath: string
  readonly ownerNonce: string
  readonly pid: number
  readonly port: number
  readonly contractVersion: string
}

export function commandFingerprintsEqual(
  a: CommandFingerprint,
  b: CommandFingerprint,
): boolean {
  if (a.executable !== b.executable) return false
  if (a.args.length !== b.args.length) return false
  for (let i = 0; i < a.args.length; i++) {
    if (a.args[i] !== b.args[i]) return false
  }
  return true
}

export function isOwnerRecord(value: unknown): value is OwnerRecord {
  if (!isObject(value)) return false
  if (value.schemaVersion !== OWNER_RECORD_SCHEMA_VERSION) return false
  if (typeof value.canonicalVaultPath !== 'string') return false
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

export function isCallerKind(value: unknown): value is CallerKind {
  return (
    typeof value === 'string' &&
    (CALLER_KINDS as readonly string[]).includes(value)
  )
}

function isCommandFingerprint(value: unknown): value is CommandFingerprint {
  if (!isObject(value)) return false
  if (typeof value.executable !== 'string') return false
  if (!Array.isArray(value.args)) return false
  return value.args.every((arg) => typeof arg === 'string')
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

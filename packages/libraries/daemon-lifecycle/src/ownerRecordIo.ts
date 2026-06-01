/**
 * Filesystem I/O for the project-scoped owner record.
 *
 * The owner record at `<project>/.voicetree/${daemonKind}.owner.json` is the
 * cross-process arbiter for "which daemon of this kind owns this project".
 * Atomic create (POSIX O_CREAT | O_EXCL via Node's `wx` flag) is the only
 * primitive needed to serialise concurrent claims: the winner writes the
 * record, every loser sees EEXIST and reads the existing record to decide
 * whether to wait (live owner), reclaim (dead pid), or fail (live owner
 * with a different identity).
 *
 * The on-disk format (path, decode, encode, claim builder) is the shared
 * `ownerRecordFile` facade in `@vt/graph-db-protocol`; this module adds
 * the file-system primitives on top: exclusive-create, atomic replace,
 * idempotent delete, the pid-liveness predicate, and the read+decode
 * convenience used by client launchers.
 *
 * `commandFingerprintsEqual` lives here as an internal helper for the
 * stale-reclaim path; it is intentionally not re-exported because the
 * fingerprint comparison is not a public capability — callers must go
 * through {@link readCommandFingerprintMatch} which interprets the
 * three-valued result (match / mismatch / unknown).
 */

import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import {
  ownerRecordFile,
  type CommandFingerprint,
  type CreateOwnerRecordInput,
  type DaemonKind,
  type OwnerRecord,
} from '@vt/graph-db-protocol'

export type CreateInitialRecordInput = CreateOwnerRecordInput

/**
 * Build the initial owner record at claim time. Port is `null` until the
 * daemon binds its loopback socket; that field is finalised by
 * {@link withBoundPort} once the assigned port is known.
 */
export const createInitialRecord = ownerRecordFile.create

export function withBoundPort(record: OwnerRecord, port: number): OwnerRecord {
  return { ...record, port }
}

export function withHeartbeat(record: OwnerRecord, nowMs: number): OwnerRecord {
  return { ...record, heartbeatAtMs: nowMs }
}

export type AtomicCreateOutcome =
  | { readonly kind: 'created' }
  | { readonly kind: 'exists'; readonly existingRaw: string }

/**
 * Atomic create-or-fail using the POSIX exclusive-create flag. The caller
 * decides how to interpret an existing file (it may belong to a live
 * owner, a dead owner that can be reclaimed, or a corrupt record).
 */
export async function tryAtomicCreate(
  path: string,
  record: OwnerRecord,
): Promise<AtomicCreateOutcome> {
  try {
    await writeFile(path, ownerRecordFile.encode(record), { flag: 'wx' })
    return { kind: 'created' }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
  }
  const existingRaw = await readFile(path, 'utf8').catch((err) => {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  })
  if (existingRaw === null) {
    // The owner file vanished between the EEXIST and our read — retry the
    // create exactly once. A second EEXIST means a competitor recreated it,
    // which we surface to the caller as a normal `exists` outcome.
    try {
      await writeFile(path, ownerRecordFile.encode(record), { flag: 'wx' })
      return { kind: 'created' }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
    const raceRaw = await readFile(path, 'utf8').catch(() => '')
    return { kind: 'exists', existingRaw: raceRaw }
  }
  return { kind: 'exists', existingRaw }
}

/**
 * Read and decode the owner record at the given path. Returns `null` when
 * the file is absent or when the contents do not satisfy the on-disk
 * schema. A corrupt record is treated as absent: it cannot identify the
 * owner, so discovery must fall back to the no-owner branch.
 *
 * The two-argument overload accepts `(projectDir, daemonKind)` and resolves
 * the path internally; the single-argument form takes a precomputed path
 * (used by the server's claim path which already holds the path).
 */
export async function readOwnerRecord(path: string): Promise<OwnerRecord | null>
export async function readOwnerRecord(projectDir: string, daemonKind: DaemonKind): Promise<OwnerRecord | null>
export async function readOwnerRecord(
  pathOrProject: string,
  daemonKind?: DaemonKind,
): Promise<OwnerRecord | null> {
  const path = daemonKind === undefined
    ? pathOrProject
    : ownerRecordFile.pathFor(pathOrProject, daemonKind)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  return ownerRecordFile.decode(raw)
}

/**
 * Replace the owner record atomically by writing to a sibling temp file
 * and renaming. `rename` is atomic on POSIX, so concurrent readers always
 * see either the old record or the new one — never a half-written file.
 */
export async function atomicReplaceOwnerRecord(
  path: string,
  record: OwnerRecord,
  tempSuffix: string,
): Promise<void> {
  const tmp = `${path}.tmp.${tempSuffix}`
  await writeFile(tmp, ownerRecordFile.encode(record), 'utf8')
  try {
    await rename(tmp, path)
  } catch (err) {
    await unlink(tmp).catch(() => {})
    throw err
  }
}

/**
 * Remove the owner record. Idempotent — a missing file is not an error,
 * since stale reclamation may race with another caller that already
 * cleared the same record.
 *
 * Path can be provided directly (server path-with-claim) or computed
 * from `(projectDir, daemonKind)` for the client launcher.
 */
export async function deleteOwnerRecord(path: string): Promise<void>
export async function deleteOwnerRecord(projectDir: string, daemonKind: DaemonKind): Promise<void>
export async function deleteOwnerRecord(
  pathOrProject: string,
  daemonKind?: DaemonKind,
): Promise<void> {
  const path = daemonKind === undefined
    ? pathOrProject
    : ownerRecordFile.pathFor(pathOrProject, daemonKind)
  try {
    await unlink(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

/**
 * Liveness check for an owner pid. Mirrors the same `kill(pid, 0)` probe
 * the legacy lock used. Only `ESRCH` (no such process) means "dead";
 * every other error code is conservatively treated as "alive" so we
 * never authorise removing an owner record we cannot positively prove
 * has gone away. EPERM is the realistic case (process exists but signal
 * not allowed); other codes are exotic kernel returns where assuming
 * alive is the strictly safer default for both the owner-record-delete
 * path and the parent-pid watchdog (which uses this same predicate via
 * {@link ../parentPidWatchdog.ts}).
 */
export function isOwnerPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return code !== 'ESRCH'
  }
}

// Re-export for stale-reclaim callers that need to decode a raw blob
// surfaced by `tryAtomicCreate.existingRaw`.
export const decodeOwnerRecord = ownerRecordFile.decode

/**
 * Internal: fingerprint equality for the stale-reclaim safety check.
 * Not exported because the public surface goes through
 * {@link readCommandFingerprintMatch} which interprets the result as
 * the three-valued ProcessLiveness/CommandFingerprintMatch shape.
 */
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

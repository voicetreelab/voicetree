/**
 * Server-side I/O for the vault-scoped owner record.
 *
 * The owner record under `<vault>/.voicetree/graphd.owner.json` is the
 * cross-process arbiter for "which vt-graphd process owns this vault".
 * Atomic create (POSIX O_CREAT | O_EXCL via Node's `wx` flag) is the only
 * primitive needed to serialise concurrent claims: the winner writes the
 * record, every loser sees EEXIST and reads the existing record to decide
 * whether to wait (live owner), reclaim (dead pid), or fail (live owner
 * with a different identity).
 *
 * Pure builders live here too so the lifecycle module composes
 * record-shaping + record-IO without leaking JSON layout details into
 * lifecycle code.
 *
 * BF-343: the server's half of the single-owner protocol. The shape is
 * imported from `@vt/graph-db-protocol` so the daemon and every client
 * share one source of truth (relocated from BF-342 in the same change).
 */

import { randomUUID } from 'node:crypto'
import {
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import {
  isOwnerRecord,
  OWNER_RECORD_SCHEMA_VERSION,
  type CallerKind,
  type CommandFingerprint,
  type OwnerRecord,
} from '@vt/graph-db-protocol'

export const OWNER_RECORD_FILENAME = 'graphd.owner.json'

export type CreateInitialRecordInput = {
  readonly canonicalVaultPath: string
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
 * daemon binds its loopback socket; that field is finalised by
 * {@link withBoundPort} once the assigned port is known.
 */
export function createInitialRecord(
  input: CreateInitialRecordInput,
): OwnerRecord {
  return {
    schemaVersion: OWNER_RECORD_SCHEMA_VERSION,
    canonicalVaultPath: input.canonicalVaultPath,
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

export function withBoundPort(record: OwnerRecord, port: number): OwnerRecord {
  return { ...record, port }
}

export function withHeartbeat(record: OwnerRecord, nowMs: number): OwnerRecord {
  return { ...record, heartbeatAtMs: nowMs }
}

export function ownerRecordPathFor(vaultDir: string): string {
  return join(vaultDir, '.voicetree', OWNER_RECORD_FILENAME)
}

function serializeOwnerRecord(record: OwnerRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`
}

function parseOwnerRecord(raw: string): OwnerRecord | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  return isOwnerRecord(value) ? value : null
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
    await writeFile(path, serializeOwnerRecord(record), { flag: 'wx' })
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
      await writeFile(path, serializeOwnerRecord(record), { flag: 'wx' })
      return { kind: 'created' }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
    const raceRaw = await readFile(path, 'utf8').catch(() => '')
    return { kind: 'exists', existingRaw: raceRaw }
  }
  return { kind: 'exists', existingRaw }
}

export function decodeOwnerRecord(raw: string): OwnerRecord | null {
  return parseOwnerRecord(raw)
}

export async function readOwnerRecord(path: string): Promise<OwnerRecord | null> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  return parseOwnerRecord(raw)
}

/**
 * Replace the owner record atomically by writing to a sibling temp file and
 * renaming. `rename` is atomic on POSIX, so concurrent readers always see
 * either the old record or the new one — never a half-written file.
 */
export async function atomicReplaceOwnerRecord(
  path: string,
  record: OwnerRecord,
  tempSuffix: string,
): Promise<void> {
  const tmp = `${path}.tmp.${tempSuffix}`
  await writeFile(tmp, serializeOwnerRecord(record), 'utf8')
  try {
    await rename(tmp, path)
  } catch (err) {
    await unlink(tmp).catch(() => {})
    throw err
  }
}

export async function deleteOwnerRecord(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

/**
 * Liveness check for an owner pid. Mirrors the same `kill(pid, 0)` probe
 * the legacy lock used, with EPERM treated as `alive` so we never authorise
 * removing an owner record we cannot inspect.
 */
export function isOwnerPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return false
    // EPERM => process exists but signal not allowed; treat as alive.
    return code === 'EPERM'
  }
}

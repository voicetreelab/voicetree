/**
 * Cross-process single-flight for the client-side spawn step.
 *
 * The owner record (graphd.owner.json) is the daemon's arbiter; this lock
 * (graphd.spawn.lock) is the client's. When `decideOwnerAction` returns
 * `claim`, multiple callers in separate processes could otherwise each
 * spawn a daemon and rely on the daemon-side atomic claim to eject 99
 * losers. That works correctness-wise but burns 99 spawns per cold start.
 *
 * `acquireSpawnLock` atomic-creates the file with `wx` so only one caller
 * per machine wins the spawn step. Losers wait for the lock to release
 * (or its holder to die) and loop back to discovery — by then the winner
 * has produced a healthy owner record and they reuse it.
 *
 * The lock is independent of the daemon's legacy `graphd.lock` sidecar:
 * different filename, different writer, different lifecycle.
 */

import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readProcessLiveness } from '../probes/processLiveness.ts'

export const SPAWN_LOCK_FILENAME = 'graphd.spawn.lock'

export type SpawnLockAcquisition =
  | { readonly kind: 'acquired'; readonly release: () => Promise<void> }
  | { readonly kind: 'held'; readonly holderPid: number | null }

export function spawnLockPathFor(vaultDir: string): string {
  return join(vaultDir, '.voicetree', SPAWN_LOCK_FILENAME)
}

/**
 * Try to atomically create the spawn lock. Returns the release callback on
 * success, or the current holder pid (when readable) when contended. A held
 * lock with a dead holder is replaced atomically: deleted then re-attempted
 * once. Persistent contention surfaces as a `held` result so the caller can
 * loop back to discovery.
 */
export async function acquireSpawnLock(
  vaultDir: string,
  ownPid: number,
): Promise<SpawnLockAcquisition> {
  const path = spawnLockPathFor(vaultDir)
  if (await tryCreate(path, ownPid)) {
    return { kind: 'acquired', release: async () => releaseSpawnLock(path) }
  }
  const holderPid = await readHolderPid(path)
  if (holderPid !== null && readProcessLiveness(holderPid) === 'alive') {
    return { kind: 'held', holderPid }
  }
  // The recorded holder is dead, unknown, or the file is unreadable.
  // Remove and try once more; if a competitor reclaims simultaneously we
  // surface the new holder.
  await unlinkIfPresent(path)
  if (await tryCreate(path, ownPid)) {
    return { kind: 'acquired', release: async () => releaseSpawnLock(path) }
  }
  const racerPid = await readHolderPid(path)
  return { kind: 'held', holderPid: racerPid }
}

async function tryCreate(path: string, ownPid: number): Promise<boolean> {
  try {
    await writeFile(path, `${ownPid}\n`, { flag: 'wx' })
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw err
  }
}

async function readHolderPid(path: string): Promise<number | null> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  const pid = Number(raw.trim())
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

async function unlinkIfPresent(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

async function releaseSpawnLock(path: string): Promise<void> {
  await unlinkIfPresent(path)
}

/**
 * Client-side IO for the vault-scoped owner record at
 * `<vault>/.voicetree/graphd.owner.json`.
 *
 * The on-disk format helpers (path + decode) live in
 * `@vt/graph-db-protocol` under `ownerRecordFile` so client and server
 * share one source of truth. This module is the filesystem-edge wrapper
 * around those pure helpers — the client only ever reads and deletes; the
 * server (BF-343) owns the atomic-create and rewrite paths.
 */

import { readFile, unlink } from 'node:fs/promises'
import { ownerRecordFile } from '@vt/graph-db-protocol'
import type { OwnerRecord } from '../types.ts'

/**
 * Read and decode the owner record. Returns `null` when the file is absent
 * or when the contents do not satisfy the on-disk schema. A corrupt record
 * is treated as absent: it cannot identify the owner, so discovery must fall
 * back to the no-owner branch.
 */
export async function readOwnerRecord(
  vaultDir: string,
): Promise<OwnerRecord | null> {
  let raw: string
  try {
    raw = await readFile(ownerRecordFile.pathFor(vaultDir), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  return ownerRecordFile.decode(raw)
}

/**
 * Remove the owner record. Idempotent — a missing file is not an error,
 * since stale reclamation may race with another caller that already cleared
 * the same record.
 */
export async function deleteOwnerRecord(vaultDir: string): Promise<void> {
  try {
    await unlink(ownerRecordFile.pathFor(vaultDir))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

/**
 * Client-side IO for the vault-scoped owner record at
 * `<vault>/.voicetree/graphd.owner.json`.
 *
 * The owner record is the authoritative cross-process arbiter for "which
 * vt-graphd process owns this vault". The daemon (BF-343) atomic-creates
 * and rewrites it; the client (BF-344) only reads it for discovery and
 * deletes it during stale reclamation.
 *
 * The on-disk shape comes from `@vt/graph-db-protocol`. This module is
 * concerned with the JSON / filesystem boundary only.
 */

import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { isOwnerRecord, type OwnerRecord } from '@vt/graph-db-protocol'

export const OWNER_RECORD_FILENAME = 'graphd.owner.json'

export function ownerRecordPathFor(vaultDir: string): string {
  return join(vaultDir, '.voicetree', OWNER_RECORD_FILENAME)
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
    raw = await readFile(ownerRecordPathFor(vaultDir), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  return parseOwnerRecord(raw)
}

/**
 * Remove the owner record. Idempotent — a missing file is not an error,
 * since stale reclamation may race with another caller that already cleared
 * the same record.
 */
export async function deleteOwnerRecord(vaultDir: string): Promise<void> {
  try {
    await unlink(ownerRecordPathFor(vaultDir))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

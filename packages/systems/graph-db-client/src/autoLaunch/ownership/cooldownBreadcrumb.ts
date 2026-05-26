/**
 * Per-vault cooldown breadcrumb at `<vault>/.voicetree/graphd.cooldown.json`.
 *
 * BF-347: when a spawn attempt for a vault fails (the child was launched but
 * never produced a healthy owner before the deadline), we persist a short-
 * lived breadcrumb. Subsequent ensure calls within the cooldown window are
 * short-circuited via `OwnerSpawnCooldownError` before they re-attempt a
 * spawn or stale-reclaim. After `untilMs`, the breadcrumb is treated as
 * absent and a fresh spawn is permitted.
 *
 * Shape:
 * - Pure: `decideActiveCooldown(now, breadcrumb)` projects an on-disk
 *   breadcrumb into the `Cooldown` shape consumed by `decideOwnerAction`.
 *   Returns `null` once the breadcrumb has expired.
 * - IO: atomic write via tmp + rename, idempotent read/clear. Corrupt or
 *   missing files are treated as "no active cooldown" so a stale or hand-
 *   edited cooldown file cannot wedge ensure.
 *
 * Path is sibling to `graphd.owner.json` and `graphd.spawn.lock`, all under
 * `<vault>/.voicetree/`.
 */

import { randomUUID } from 'node:crypto'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CallerKind } from '../types.ts'
import type { Cooldown } from './ownerDecision.ts'

export const COOLDOWN_BREADCRUMB_FILENAME = 'graphd.cooldown.json'

const COOLDOWN_BREADCRUMB_SCHEMA_VERSION = 1

/**
 * Persisted shape of a cooldown record. The `untilMs` field is the wall-clock
 * instant the cooldown stops applying — readers do `nowMs >= untilMs` to
 * decide whether the breadcrumb is still active without needing to know
 * `writtenAtMs` or `ttlMs`.
 */
export type CooldownBreadcrumb = {
  readonly schemaVersion: 1
  readonly canonicalProjectRoot: string
  readonly writtenAtMs: number
  readonly untilMs: number
  readonly reason: string
  readonly writerCallerKind: CallerKind
  readonly writerPid: number
  /** Cause of the spawn failure. Free-form, intended for operator logs. */
  readonly lastErrorName: string
  readonly lastErrorMessage: string
}

export function cooldownBreadcrumbPathFor(vaultDir: string): string {
  return join(vaultDir, '.voicetree', COOLDOWN_BREADCRUMB_FILENAME)
}

/**
 * Pure: project a possibly-active breadcrumb into the `Cooldown` evidence
 * shape consumed by `decideOwnerAction`. Returns `null` when:
 *  - The breadcrumb is absent.
 *  - The breadcrumb has expired (`now >= untilMs`).
 */
export function decideActiveCooldown(
  nowMs: number,
  breadcrumb: CooldownBreadcrumb | null,
): Cooldown | null {
  if (breadcrumb === null) return null
  if (nowMs >= breadcrumb.untilMs) return null
  return { untilMs: breadcrumb.untilMs, reason: breadcrumb.reason }
}

/**
 * Read and decode the cooldown breadcrumb. Returns `null` when the file is
 * absent or corrupt — a corrupt breadcrumb cannot describe a cooldown
 * window, so callers must fall back to "no active cooldown".
 */
export async function readCooldownBreadcrumb(
  vaultDir: string,
): Promise<CooldownBreadcrumb | null> {
  let raw: string
  try {
    raw = await readFile(cooldownBreadcrumbPathFor(vaultDir), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  return parseCooldownBreadcrumb(raw)
}

/**
 * Atomic-write a cooldown breadcrumb. Uses tmp + rename so a partial write
 * cannot leave a half-formed JSON file other readers would treat as corrupt.
 */
export async function writeCooldownBreadcrumb(
  vaultDir: string,
  breadcrumb: CooldownBreadcrumb,
): Promise<void> {
  const target = cooldownBreadcrumbPathFor(vaultDir)
  const tmp = `${target}.tmp.${process.pid}.${randomUUID().slice(0, 8)}`
  await writeFile(tmp, `${JSON.stringify(breadcrumb, null, 2)}\n`, 'utf8')
  try {
    await rename(tmp, target)
  } catch (err) {
    await unlink(tmp).catch(() => undefined)
    throw err
  }
}

/**
 * Remove the cooldown breadcrumb. Idempotent — a missing file is not an
 * error. Called after a successful spawn so a healed vault is not held in
 * cooldown for the remainder of the window.
 */
export async function clearCooldownBreadcrumb(vaultDir: string): Promise<void> {
  try {
    await unlink(cooldownBreadcrumbPathFor(vaultDir))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

function parseCooldownBreadcrumb(raw: string): CooldownBreadcrumb | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObject(value)) return null
  if (value.schemaVersion !== COOLDOWN_BREADCRUMB_SCHEMA_VERSION) return null
  if (typeof value.canonicalProjectRoot !== 'string') return null
  if (!isFiniteNonNegative(value.writtenAtMs)) return null
  if (!isFiniteNonNegative(value.untilMs)) return null
  if (typeof value.reason !== 'string') return null
  if (typeof value.writerCallerKind !== 'string') return null
  if (typeof value.writerPid !== 'number') return null
  if (typeof value.lastErrorName !== 'string') return null
  if (typeof value.lastErrorMessage !== 'string') return null
  return {
    schemaVersion: COOLDOWN_BREADCRUMB_SCHEMA_VERSION,
    canonicalProjectRoot: value.canonicalProjectRoot,
    writtenAtMs: value.writtenAtMs,
    untilMs: value.untilMs,
    reason: value.reason,
    writerCallerKind: value.writerCallerKind as CallerKind,
    writerPid: value.writerPid,
    lastErrorName: value.lastErrorName,
    lastErrorMessage: value.lastErrorMessage,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

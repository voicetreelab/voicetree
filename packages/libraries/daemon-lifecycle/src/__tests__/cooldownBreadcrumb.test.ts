import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  clearCooldownBreadcrumb,
  cooldownBreadcrumbPathFor,
  decideActiveCooldown,
  readCooldownBreadcrumb,
  writeCooldownBreadcrumb,
  type CooldownBreadcrumb,
} from '../cooldownBreadcrumb.ts'

let vault: string

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'vt-graphd-bf347-cd-'))
  await mkdir(join(vault, '.voicetree'), { recursive: true })
})

afterEach(async () => {
  await rm(vault, { recursive: true, force: true })
})

function makeBreadcrumb(
  partial: Partial<CooldownBreadcrumb> = {},
): CooldownBreadcrumb {
  const now = 1_700_000_000_000
  return {
    schemaVersion: 1,
    canonicalVault: vault,
    writtenAtMs: now,
    untilMs: now + 5_000,
    reason: 'spawn-failed',
    writerCallerKind: 'test',
    writerPid: process.pid,
    lastErrorName: 'DaemonLaunchTimeout',
    lastErrorMessage: 'spawn timed out',
    ...partial,
  }
}

describe('decideActiveCooldown — pure', () => {
  test('returns null when breadcrumb is absent', () => {
    expect(decideActiveCooldown(Date.now(), null)).toBeNull()
  })

  test('returns null when breadcrumb has expired', () => {
    const breadcrumb = makeBreadcrumb({ untilMs: 1_000 })
    expect(decideActiveCooldown(2_000, breadcrumb)).toBeNull()
  })

  test('returns the breadcrumb cooldown shape when active', () => {
    const breadcrumb = makeBreadcrumb({ untilMs: 5_000, reason: 'spawn-failed' })
    expect(decideActiveCooldown(4_999, breadcrumb)).toEqual({
      untilMs: 5_000,
      reason: 'spawn-failed',
    })
  })

  test('returns null at the exact expiry instant (now >= untilMs)', () => {
    const breadcrumb = makeBreadcrumb({ untilMs: 5_000 })
    expect(decideActiveCooldown(5_000, breadcrumb)).toBeNull()
  })
})

describe('cooldown breadcrumb IO — black-box', () => {
  test('write then read round-trips the breadcrumb', async () => {
    const breadcrumb = makeBreadcrumb({ reason: 'first-attempt' })
    await writeCooldownBreadcrumb(vault, 'graphd', breadcrumb)

    const roundtripped = await readCooldownBreadcrumb(vault, 'graphd')
    expect(roundtripped).toEqual(breadcrumb)

    // File lives at the published path.
    const raw = await readFile(cooldownBreadcrumbPathFor(vault, 'graphd'), 'utf8')
    expect(raw).toContain('"reason": "first-attempt"')
  })

  test('path is sibling to other owner files under .voicetree/, keyed by daemonKind', () => {
    expect(cooldownBreadcrumbPathFor(vault, 'graphd')).toBe(
      join(vault, '.voicetree', 'graphd.cooldown.json'),
    )
    expect(cooldownBreadcrumbPathFor(vault, 'vtd')).toBe(
      join(vault, '.voicetree', 'vtd.cooldown.json'),
    )
  })

  test('read returns null for missing file', async () => {
    expect(await readCooldownBreadcrumb(vault, 'graphd')).toBeNull()
  })

  test('read returns null for corrupt JSON', async () => {
    await writeFile(cooldownBreadcrumbPathFor(vault, 'graphd'), '{ not valid json', 'utf8')
    expect(await readCooldownBreadcrumb(vault, 'graphd')).toBeNull()
  })

  test('read returns null for schema mismatch', async () => {
    await writeFile(
      cooldownBreadcrumbPathFor(vault, 'graphd'),
      JSON.stringify({ schemaVersion: 99, canonicalVault: vault }),
      'utf8',
    )
    expect(await readCooldownBreadcrumb(vault, 'graphd')).toBeNull()
  })

  test('clearCooldownBreadcrumb removes the file and is idempotent', async () => {
    await writeCooldownBreadcrumb(vault, 'graphd', makeBreadcrumb())
    await clearCooldownBreadcrumb(vault, 'graphd')
    expect(await readCooldownBreadcrumb(vault, 'graphd')).toBeNull()
    // Second clear on an absent file does not throw.
    await clearCooldownBreadcrumb(vault, 'graphd')
  })

  test('write atomically replaces an existing breadcrumb', async () => {
    await writeCooldownBreadcrumb(vault, 'graphd', makeBreadcrumb({ reason: 'first' }))
    await writeCooldownBreadcrumb(vault, 'graphd', makeBreadcrumb({ reason: 'second' }))

    const final = await readCooldownBreadcrumb(vault, 'graphd')
    expect(final?.reason).toBe('second')
  })

  test('graphd and vtd breadcrumbs are independent for the same vault', async () => {
    await writeCooldownBreadcrumb(vault, 'graphd', makeBreadcrumb({ reason: 'graphd-spawn-failed' }))
    await writeCooldownBreadcrumb(vault, 'vtd', makeBreadcrumb({ reason: 'vtd-spawn-failed' }))

    const graphd = await readCooldownBreadcrumb(vault, 'graphd')
    const vtd = await readCooldownBreadcrumb(vault, 'vtd')
    expect(graphd?.reason).toBe('graphd-spawn-failed')
    expect(vtd?.reason).toBe('vtd-spawn-failed')

    // Clearing one does not affect the other.
    await clearCooldownBreadcrumb(vault, 'graphd')
    expect(await readCooldownBreadcrumb(vault, 'graphd')).toBeNull()
    expect(await readCooldownBreadcrumb(vault, 'vtd')).not.toBeNull()
  })
})

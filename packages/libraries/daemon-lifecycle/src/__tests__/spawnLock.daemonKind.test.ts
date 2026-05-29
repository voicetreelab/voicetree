/**
 * BF-369 daemonKind separation: graphd and vtd spawn locks for the same
 * vault are independent files that two callers can hold concurrently
 * without blocking each other.
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { acquireSpawnLock, spawnLockPathFor } from '../spawnLock.ts'

let vault: string

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'vt-daemon-lifecycle-lock-'))
  await mkdir(join(vault, '.voicetree'), { recursive: true })
})

afterEach(async () => {
  await rm(vault, { recursive: true, force: true })
})

describe('spawnLock daemonKind separation (BF-369)', () => {
  test('graphd and vtd locks for the same vault resolve to distinct file paths', () => {
    expect(spawnLockPathFor(vault, 'graphd')).toBe(
      join(vault, '.voicetree', 'graphd.spawn.lock'),
    )
    expect(spawnLockPathFor(vault, 'vtd')).toBe(
      join(vault, '.voicetree', 'vtd.spawn.lock'),
    )
    expect(spawnLockPathFor(vault, 'graphd')).not.toBe(spawnLockPathFor(vault, 'vtd'))
  })

  test('two callers acquiring the lock for different daemonKinds on the same vault BOTH succeed concurrently', async () => {
    const [graphdAcq, vtdAcq] = await Promise.all([
      acquireSpawnLock(vault, 'graphd', process.pid),
      acquireSpawnLock(vault, 'vtd', process.pid),
    ])
    try {
      expect(graphdAcq.kind).toBe('acquired')
      expect(vtdAcq.kind).toBe('acquired')
    } finally {
      if (graphdAcq.kind === 'acquired') await graphdAcq.release()
      if (vtdAcq.kind === 'acquired') await vtdAcq.release()
    }
  })

  test('a second acquire of the SAME kind on the same vault is held', async () => {
    const first = await acquireSpawnLock(vault, 'graphd', process.pid)
    expect(first.kind).toBe('acquired')
    try {
      const second = await acquireSpawnLock(vault, 'graphd', process.pid)
      expect(second.kind).toBe('held')
      // The other kind is independent — still acquirable.
      const otherKind = await acquireSpawnLock(vault, 'vtd', process.pid)
      expect(otherKind.kind).toBe('acquired')
      if (otherKind.kind === 'acquired') await otherKind.release()
    } finally {
      if (first.kind === 'acquired') await first.release()
    }
  })
})

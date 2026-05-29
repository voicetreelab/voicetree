/**
 * BF-369 daemonKind separation: graphd and vtd spawn locks for the same
 * project are independent files that two callers can hold concurrently
 * without blocking each other.
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { acquireSpawnLock, spawnLockPathFor } from '../spawnLock.ts'

let project: string

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'vt-daemon-lifecycle-lock-'))
  await mkdir(join(project, '.voicetree'), { recursive: true })
})

afterEach(async () => {
  await rm(project, { recursive: true, force: true })
})

describe('spawnLock daemonKind separation (BF-369)', () => {
  test('graphd and vtd locks for the same project resolve to distinct file paths', () => {
    expect(spawnLockPathFor(project, 'graphd')).toBe(
      join(project, '.voicetree', 'graphd.spawn.lock'),
    )
    expect(spawnLockPathFor(project, 'vtd')).toBe(
      join(project, '.voicetree', 'vtd.spawn.lock'),
    )
    expect(spawnLockPathFor(project, 'graphd')).not.toBe(spawnLockPathFor(project, 'vtd'))
  })

  test('two callers acquiring the lock for different daemonKinds on the same project BOTH succeed concurrently', async () => {
    const [graphdAcq, vtdAcq] = await Promise.all([
      acquireSpawnLock(project, 'graphd', process.pid),
      acquireSpawnLock(project, 'vtd', process.pid),
    ])
    try {
      expect(graphdAcq.kind).toBe('acquired')
      expect(vtdAcq.kind).toBe('acquired')
    } finally {
      if (graphdAcq.kind === 'acquired') await graphdAcq.release()
      if (vtdAcq.kind === 'acquired') await vtdAcq.release()
    }
  })

  test('a second acquire of the SAME kind on the same project is held', async () => {
    const first = await acquireSpawnLock(project, 'graphd', process.pid)
    expect(first.kind).toBe('acquired')
    try {
      const second = await acquireSpawnLock(project, 'graphd', process.pid)
      expect(second.kind).toBe('held')
      // The other kind is independent — still acquirable.
      const otherKind = await acquireSpawnLock(project, 'vtd', process.pid)
      expect(otherKind.kind).toBe('acquired')
      if (otherKind.kind === 'acquired') await otherKind.release()
    } finally {
      if (first.kind === 'acquired') await first.release()
    }
  })
})

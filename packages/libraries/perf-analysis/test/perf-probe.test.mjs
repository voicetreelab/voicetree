import { mkdtemp, readdir, stat } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { perfProbePlan, scheduleHeapSnapshots } from '../src/perf-probe.mjs'

describe('perfProbePlan', () => {
  test('lite tier → 100 Hz sampling, no heap snapshots', () => {
    expect(perfProbePlan({ VOICETREE_PERF_TIER: 'lite' })).toEqual({
      tier: 'lite',
      wallSamplingMicros: 10_000,
      heapSnapshots: false,
    })
  })

  test('deep tier → 1 kHz sampling, heap snapshots on', () => {
    expect(perfProbePlan({ VOICETREE_PERF_TIER: 'deep' })).toEqual({
      tier: 'deep',
      wallSamplingMicros: 1_000,
      heapSnapshots: true,
    })
  })

  test.each([
    ['unset', {}],
    ['empty', { VOICETREE_PERF_TIER: '' }],
    ['explicit off', { VOICETREE_PERF_TIER: 'off' }],
    ['garbage', { VOICETREE_PERF_TIER: 'turbo' }],
    ['legacy boolean is no longer honoured', { VOICETREE_PERF_PROFILE: '1' }],
  ])('%s → off plan', (_label, env) => {
    expect(perfProbePlan(env)).toEqual({ tier: 'off' })
  })

  test('lite always-on rate is an order of magnitude below deep', () => {
    const lite = perfProbePlan({ VOICETREE_PERF_TIER: 'lite' })
    const deep = perfProbePlan({ VOICETREE_PERF_TIER: 'deep' })
    // Larger period micros = fewer samples/interrupts. Lite must sample ~10x
    // less frequently than deep so it is cheap enough to leave on continuously.
    expect(lite.wallSamplingMicros).toBe(deep.wallSamplingMicros * 10)
  })

  test('is pure — repeated calls return fresh, independent plans', () => {
    const a = perfProbePlan({ VOICETREE_PERF_TIER: 'lite' })
    const b = perfProbePlan({ VOICETREE_PERF_TIER: 'lite' })
    expect(a).not.toBe(b)
    a.heapSnapshots = true
    expect(perfProbePlan({ VOICETREE_PERF_TIER: 'lite' }).heapSnapshots).toBe(false)
  })
})

describe('scheduleHeapSnapshots (deep-tier machinery)', () => {
  // Fire every deferred timer synchronously so the whole offset schedule runs
  // within the test, and write a lightweight real file for each snapshot so we
  // assert on observable on-disk output rather than on calls.
  const immediateSchedule = (cb) => {
    cb()
    return { unref() {} }
  }
  const touch = (path) => writeFileSync(path, 'snapshot')

  test('writes one file per offset, named <svc>.tN.heapsnapshot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vt-perf-heap-'))

    scheduleHeapSnapshots({
      heapSnapshotsDir: dir,
      svc: 'vt-electron-main',
      offsetsMs: [0, 5_000, 10_000],
      writeSnapshot: touch,
      schedule: immediateSchedule,
    })

    const files = (await readdir(dir)).sort()
    expect(files).toEqual([
      'vt-electron-main.t0.heapsnapshot',
      'vt-electron-main.t10.heapsnapshot',
      'vt-electron-main.t5.heapsnapshot',
    ])
  })

  test('respects a custom offset list', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vt-perf-heap-'))

    scheduleHeapSnapshots({
      heapSnapshotsDir: dir,
      svc: 'vt-graphd',
      offsetsMs: [0],
      writeSnapshot: touch,
      schedule: immediateSchedule,
    })

    await expect(readdir(dir)).resolves.toEqual(['vt-graphd.t0.heapsnapshot'])
  })

  test('the real default writer produces a genuine V8 heap snapshot on disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vt-perf-heap-real-'))

    // Only the synchronous t0 snapshot, with the real node:v8 writeHeapSnapshot
    // default, to prove the production wiring writes a non-empty snapshot.
    scheduleHeapSnapshots({
      heapSnapshotsDir: dir,
      svc: 'vt-probe',
      offsetsMs: [0],
    })

    const file = join(dir, 'vt-probe.t0.heapsnapshot')
    const info = await stat(file)
    expect(info.size).toBeGreaterThan(0)
  })
})

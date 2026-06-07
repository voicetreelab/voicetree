import { describe, expect, it } from 'vitest'
import { resolveMaxWorkers, type HostLoad } from './vitest.workers'

// Black-box: feed a HostLoad snapshot, assert the fork count. No mocking — the
// host-reading impurity lives in readHostLoad(); resolveMaxWorkers is pure.

const DEVBOX: HostLoad = { cores: 64, loadAvg1m: 0, availableMemGb: 180 }

describe('resolveMaxWorkers', () => {
  it('claims ~half the cores on an idle 64c box (the measured knee, not all cores)', () => {
    expect(resolveMaxWorkers(DEVBOX)).toBe(32)
  })

  it('backs off when other work already loads the box, so concurrent suites share it', () => {
    // A sibling suite saturating ~32 cores leaves ~32 idle → claim ~half of those.
    const underSiblingRun = resolveMaxWorkers({ ...DEVBOX, loadAvg1m: 32 })
    expect(underSiblingRun).toBe(16)
    // Heavier still → keeps shrinking rather than piling on.
    expect(resolveMaxWorkers({ ...DEVBOX, loadAvg1m: 48 })).toBe(8)
  })

  it('never drops below 1 even when the box is fully saturated', () => {
    expect(resolveMaxWorkers({ ...DEVBOX, loadAvg1m: 64 })).toBe(1)
    expect(resolveMaxWorkers({ ...DEVBOX, loadAvg1m: 200 })).toBe(1)
  })

  it('lets RAM bind first when memory is the scarce resource (the OOM guard)', () => {
    // Idle CPU would allow 32, but only 6 GB free → 0.75*6/1.5 = 3 forks.
    expect(resolveMaxWorkers({ ...DEVBOX, availableMemGb: 6 })).toBe(3)
    // Almost no free RAM → serial, never 0 (which would hang vitest).
    expect(resolveMaxWorkers({ ...DEVBOX, availableMemGb: 0.5 })).toBe(1)
  })

  it('stays safe on a small CI runner (4c/16GB → ~2 forks, no oversubscription)', () => {
    expect(resolveMaxWorkers({ cores: 4, loadAvg1m: 0, availableMemGb: 16 })).toBe(2)
  })

  it('honours an explicit VITEST_MAX_FORKS pin over the heuristic', () => {
    expect(resolveMaxWorkers({ ...DEVBOX, envOverride: 8 })).toBe(8)
    expect(resolveMaxWorkers({ ...DEVBOX, envOverride: 4.9 })).toBe(4) // floored
    // A bogus override is ignored; the heuristic resumes.
    expect(resolveMaxWorkers({ ...DEVBOX, envOverride: 0 })).toBe(32)
    expect(resolveMaxWorkers({ ...DEVBOX, envOverride: NaN })).toBe(32)
  })
})

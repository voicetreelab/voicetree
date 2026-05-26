import { describe, expect, test } from 'vitest'
import { startParentWatch, type ParentWatchDeps } from '../parentReparentWatch.ts'

type FakeTimer = { fire: () => void; cleared: boolean }
type Harness = {
  deps: ParentWatchDeps
  setPpid: (n: number) => void
  getTimer: () => FakeTimer | null
}

function makeHarness(initialPpid: number): Harness {
  let ppid = initialPpid
  let timer: FakeTimer | null = null
  const deps: ParentWatchDeps = {
    getPpid: () => ppid,
    setInterval: (cb) => {
      const t: FakeTimer = {
        cleared: false,
        fire: () => cb(),
      }
      timer = t
      return t as unknown as NodeJS.Timeout
    },
    clearInterval: (handle) => {
      ;(handle as unknown as FakeTimer).cleared = true
    },
  }
  return {
    deps,
    setPpid: (n) => {
      ppid = n
    },
    getTimer: () => timer,
  }
}

describe('startParentWatch', () => {
  test('does not arm when initial ppid is already 1 (launchd-spawned)', () => {
    const h = makeHarness(1)
    let fired = false
    const watch = startParentWatch({ onOrphaned: () => (fired = true) }, h.deps)
    expect(watch.armed).toBe(false)
    expect(h.getTimer()).toBe(null)
    expect(fired).toBe(false)
  })

  test('arms when initial ppid is non-1 and fires onOrphaned when ppid becomes 1', () => {
    const h = makeHarness(12345)
    let fired = 0
    const watch = startParentWatch({ onOrphaned: () => fired++ }, h.deps)
    expect(watch.armed).toBe(true)
    // Tick: parent still alive
    h.getTimer()?.fire()
    expect(fired).toBe(0)
    // Parent dies, reparented to 1
    h.setPpid(1)
    h.getTimer()?.fire()
    expect(fired).toBe(1)
    // Subsequent ticks don't refire and timer was cleared
    h.getTimer()?.fire()
    expect(fired).toBe(1)
    expect(h.getTimer()?.cleared).toBe(true)
  })

  test('stop() before orphan event prevents future firing', () => {
    const h = makeHarness(12345)
    let fired = 0
    const watch = startParentWatch({ onOrphaned: () => fired++ }, h.deps)
    watch.stop()
    expect(h.getTimer()?.cleared).toBe(true)
    h.setPpid(1)
    h.getTimer()?.fire()
    expect(fired).toBe(0)
  })
})

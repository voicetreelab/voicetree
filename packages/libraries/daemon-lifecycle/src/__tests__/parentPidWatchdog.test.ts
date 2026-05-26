import { describe, expect, it } from 'vitest'
import {
  startParentPidWatchdog,
  type ParentPidWatchdogScheduler,
  type ParentPidWatchdogTimer,
} from '../parentPidWatchdog.ts'

type FakeTimer = ParentPidWatchdogTimer & {
  fn: () => void
  ms: number
  cleared: boolean
}

type FakeScheduler = ParentPidWatchdogScheduler & {
  pending: Set<FakeTimer>
  immediates: Array<() => void>
  tick: () => void
  runImmediates: () => void
}

function makeScheduler(): FakeScheduler {
  const pending = new Set<FakeTimer>()
  const immediates: Array<() => void> = []
  return {
    clearInterval: (t) => {
      const timer = t as FakeTimer
      timer.cleared = true
      pending.delete(timer)
    },
    immediates,
    pending,
    runImmediates: () => {
      const drained = immediates.splice(0)
      for (const fn of drained) fn()
    },
    setImmediate: (fn) => { immediates.push(fn) },
    setInterval: (fn, ms) => {
      const timer: FakeTimer = { cleared: false, fn, ms, unref: () => {} }
      pending.add(timer)
      return timer
    },
    tick: () => {
      for (const t of [...pending]) if (!t.cleared) t.fn()
    },
  }
}

describe('startParentPidWatchdog', () => {
  it('fires onParentGone when parent dies between ticks', () => {
    const scheduler = makeScheduler()
    let alive = true
    let firedCount = 0

    startParentPidWatchdog({
      isAlive: () => alive,
      onParentGone: () => { firedCount += 1 },
      parentPid: 12345,
      pollIntervalMs: 1000,
      scheduler,
    })

    scheduler.tick()
    expect(firedCount).toBe(0)

    alive = false
    scheduler.tick()
    expect(firedCount).toBe(1)
  })

  it('fires only once even when polled repeatedly after parent dies', () => {
    const scheduler = makeScheduler()
    let firedCount = 0

    startParentPidWatchdog({
      isAlive: () => false,
      onParentGone: () => { firedCount += 1 },
      parentPid: 12345,
      pollIntervalMs: 1000,
      scheduler,
    })

    scheduler.runImmediates()
    scheduler.runImmediates()
    scheduler.tick()
    expect(firedCount).toBe(1)
  })

  it('fires immediately via setImmediate when parent is already gone at startup', () => {
    const scheduler = makeScheduler()
    let fired = false

    startParentPidWatchdog({
      isAlive: () => false,
      onParentGone: () => { fired = true },
      parentPid: 99999,
      scheduler,
    })

    expect(fired).toBe(false)
    expect(scheduler.pending.size).toBe(0)
    scheduler.runImmediates()
    expect(fired).toBe(true)
  })

  it('stop() prevents future firing and clears the timer', () => {
    const scheduler = makeScheduler()
    let firedCount = 0
    let alive = true

    const handle = startParentPidWatchdog({
      isAlive: () => alive,
      onParentGone: () => { firedCount += 1 },
      parentPid: 12345,
      scheduler,
    })

    expect(scheduler.pending.size).toBe(1)
    handle.stop()
    expect([...scheduler.pending][0]?.cleared ?? true).toBe(true)

    alive = false
    scheduler.tick()
    expect(firedCount).toBe(0)
  })

  it('rejects invalid parentPid values', () => {
    const noop = (): void => {}
    expect(() => startParentPidWatchdog({ onParentGone: noop, parentPid: 0 })).toThrow()
    expect(() => startParentPidWatchdog({ onParentGone: noop, parentPid: -1 })).toThrow()
    expect(() => startParentPidWatchdog({ onParentGone: noop, parentPid: 1.5 })).toThrow()
    expect(() => startParentPidWatchdog({ onParentGone: noop, parentPid: Number.NaN })).toThrow()
  })

  it('uses real process.kill against current process (alive case)', () => {
    const scheduler = makeScheduler()
    let fired = false

    startParentPidWatchdog({
      onParentGone: () => { fired = true },
      parentPid: process.pid,
      scheduler,
    })

    scheduler.tick()
    expect(fired).toBe(false)
  })
})

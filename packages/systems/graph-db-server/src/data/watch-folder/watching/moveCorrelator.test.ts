import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createMoveCorrelator, type MoveCorrelator } from './moveCorrelator.ts'
import type { MoveIdentity } from './moveIdentity.ts'

const id = (content: string): MoveIdentity => ({ kind: 'leaf', contentWithoutYamlOrLinks: content })

describe('moveCorrelator', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('buffered unlink is readable then removed by consume', () => {
    const c: MoveCorrelator = createMoveCorrelator({ windowMs: 1000 })
    const identity = id('A')
    c.recordUnlink('note', identity)
    expect(c.pendingUnlinkIdentities('note')).toEqual([identity])
    c.consumeUnlink('note', identity)
    expect(c.pendingUnlinkIdentities('note')).toEqual([])
  })

  test('buffered dropped add is readable then removed by consume', () => {
    const c: MoveCorrelator = createMoveCorrelator({ windowMs: 1000 })
    c.recordDroppedAdd('note', '/p/archive/note.md')
    expect(c.pendingDroppedAddPaths('note')).toEqual(['/p/archive/note.md'])
    c.consumeDroppedAdd('note', '/p/archive/note.md')
    expect(c.pendingDroppedAddPaths('note')).toEqual([])
  })

  test('entries expire after the window', () => {
    const c: MoveCorrelator = createMoveCorrelator({ windowMs: 1000 })
    c.recordUnlink('note', id('A'))
    c.recordDroppedAdd('note', '/p/note.md')
    vi.advanceTimersByTime(1001)
    expect(c.pendingUnlinkIdentities('note')).toEqual([])
    expect(c.pendingDroppedAddPaths('note')).toEqual([])
  })

  test('multiple entries under one basename are tracked and consumed individually', () => {
    const c: MoveCorrelator = createMoveCorrelator({ windowMs: 1000 })
    const a = id('A')
    const b = id('B')
    c.recordUnlink('note', a)
    c.recordUnlink('note', b)
    expect(c.pendingUnlinkIdentities('note')).toEqual([a, b])
    c.consumeUnlink('note', a)
    expect(c.pendingUnlinkIdentities('note')).toEqual([b])
  })

  test('unrelated basenames do not interfere', () => {
    const c: MoveCorrelator = createMoveCorrelator({ windowMs: 1000 })
    c.recordUnlink('alpha', id('A'))
    expect(c.pendingUnlinkIdentities('beta')).toEqual([])
  })

  test('dispose clears entries and no timer fires afterwards', () => {
    const c: MoveCorrelator = createMoveCorrelator({ windowMs: 1000 })
    c.recordUnlink('note', id('A'))
    c.recordDroppedAdd('note', '/p/note.md')
    c.dispose()
    expect(c.pendingUnlinkIdentities('note')).toEqual([])
    expect(c.pendingDroppedAddPaths('note')).toEqual([])
    // No outstanding timers should remain to fire after teardown.
    expect(vi.getTimerCount()).toBe(0)
  })
})

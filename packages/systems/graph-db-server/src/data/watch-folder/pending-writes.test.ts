import path from 'path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  consumeBroadcastSuppression,
  markPendingWrite,
} from './pending-writes.ts'

describe('pending write broadcast suppression', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the editor suppression set when consuming a pending write', () => {
    const filePath = path.join('/tmp', `pending-${randomUUID()}.md`)

    markPendingWrite(filePath, { suppressBroadcastTo: 'editor-1' })

    expect([...consumeBroadcastSuppression(filePath)]).toEqual(['editor-1'])
    expect([...consumeBroadcastSuppression(filePath)]).toEqual([])
  })

  it('accumulates editor ids for repeated marks on the same path', () => {
    const filePath = path.join('/tmp', `pending-${randomUUID()}.md`)

    markPendingWrite(filePath, { suppressBroadcastTo: 'editor-1' })
    markPendingWrite(filePath, { suppressBroadcastTo: 'editor-2' })

    expect([...consumeBroadcastSuppression(filePath)].sort()).toEqual([
      'editor-1',
      'editor-2',
    ])
  })

  it('expires pending suppression records after the ttl', () => {
    vi.useFakeTimers()
    const filePath = path.join('/tmp', `pending-${randomUUID()}.md`)

    markPendingWrite(filePath, { suppressBroadcastTo: 'editor-1' })
    vi.advanceTimersByTime(5000)

    expect([...consumeBroadcastSuppression(filePath)]).toEqual([])
  })
})

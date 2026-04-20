/* vt-allow-direct-daemon-mutation-import: graph-state primitive behaviour test */

import { describe, it, expect, beforeEach } from 'vitest'

import {
    getCollapseSet,
    dispatchCollapse,
    dispatchExpand,
    subscribeCollapseSet,
    clearCollapseSet,
} from '../../src/state/collapseSetStore'

beforeEach(() => {
    clearCollapseSet()
})

describe('collapseSetStore — dispatchCollapse', () => {
    it('adds a folder to the collapseSet', () => {
        dispatchCollapse('/vault/tasks/')
        expect(getCollapseSet().has('/vault/tasks/')).toBe(true)
    })

    it('accumulates multiple folders', () => {
        dispatchCollapse('/vault/tasks/')
        dispatchCollapse('/vault/knowledge/')
        expect(getCollapseSet().size).toBe(2)
        expect(getCollapseSet().has('/vault/knowledge/')).toBe(true)
    })

    it('is idempotent — same reference returned when already collapsed', () => {
        dispatchCollapse('/vault/tasks/')
        const before = getCollapseSet()
        dispatchCollapse('/vault/tasks/')
        expect(getCollapseSet()).toBe(before)
    })
})

describe('collapseSetStore — dispatchExpand', () => {
    it('removes a folder from the collapseSet', () => {
        dispatchCollapse('/vault/tasks/')
        dispatchExpand('/vault/tasks/')
        expect(getCollapseSet().has('/vault/tasks/')).toBe(false)
        expect(getCollapseSet().size).toBe(0)
    })

    it('is idempotent — no-op when folder not collapsed', () => {
        const before = getCollapseSet()
        dispatchExpand('/vault/tasks/')
        expect(getCollapseSet()).toBe(before)
    })
})

describe('collapseSetStore — explicit target set', () => {
    it('returns an updated explicit set without mutating the singleton store', () => {
        const sessionSet = new Set<string>()

        const next = dispatchCollapse(sessionSet, '/vault/tasks/')

        expect(next).not.toBe(sessionSet)
        expect(next.has('/vault/tasks/')).toBe(true)
        expect(getCollapseSet().size).toBe(0)
    })

    it('returns an expanded explicit set without mutating the singleton store', () => {
        const sessionSet = new Set<string>(['/vault/tasks/', '/vault/docs/'])

        const next = dispatchExpand(sessionSet, '/vault/tasks/')

        expect([...next]).toEqual(['/vault/docs/'])
        expect(getCollapseSet().size).toBe(0)
    })
})

describe('collapseSetStore — subscribeCollapseSet', () => {
    it('fires once per dispatchCollapse', () => {
        const received: ReadonlySet<string>[] = []
        const unsub = subscribeCollapseSet((s) => received.push(s))

        dispatchCollapse('/vault/tasks/')
        unsub()

        expect(received).toHaveLength(1)
        expect(received[0]!.has('/vault/tasks/')).toBe(true)
    })

    it('fires once per dispatchExpand', () => {
        dispatchCollapse('/vault/tasks/')
        const received: ReadonlySet<string>[] = []
        const unsub = subscribeCollapseSet((s) => received.push(s))

        dispatchExpand('/vault/tasks/')
        unsub()

        expect(received).toHaveLength(1)
        expect(received[0]!.size).toBe(0)
    })

    it('does not fire when dispatchCollapse is a no-op (already collapsed)', () => {
        dispatchCollapse('/vault/tasks/')
        const received: ReadonlySet<string>[] = []
        const unsub = subscribeCollapseSet((s) => received.push(s))

        dispatchCollapse('/vault/tasks/')
        unsub()

        expect(received).toHaveLength(0)
    })

    it('fires once per dispatch across multiple dispatches', () => {
        let callCount = 0
        const unsub = subscribeCollapseSet(() => { callCount++ })

        dispatchCollapse('/vault/a/')
        dispatchCollapse('/vault/b/')

        unsub()
        expect(callCount).toBe(2)
    })

    it('unsubscribe stops further notifications', () => {
        const received: ReadonlySet<string>[] = []
        const unsub = subscribeCollapseSet((s) => received.push(s))

        dispatchCollapse('/vault/tasks/')
        unsub()
        dispatchExpand('/vault/tasks/')

        expect(received).toHaveLength(1)
    })
})

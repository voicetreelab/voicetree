import { beforeEach, describe, expect, it } from 'vitest'

import {
    _resetForTests,
    dispatchDeselect,
    dispatchSelect,
    getSelection,
    isSelected,
    subscribeSelection,
} from '../../src/state/selectionStore'

describe('selectionStore', () => {
    beforeEach(() => {
        _resetForTests()
    })

    it('initial state is empty', () => {
        expect(getSelection().size).toBe(0)
        expect(isSelected('/a.md')).toBe(false)
    })

    it('dispatchSelect (replace) sets selection and notifies subscriber once', () => {
        const received: ReadonlySet<string>[] = []
        const unsub = subscribeSelection((s) => { received.push(s) })

        dispatchSelect(['/a.md', '/b.md'])

        expect([...getSelection()]).toEqual(['/a.md', '/b.md'])
        expect(isSelected('/a.md')).toBe(true)
        expect(isSelected('/c.md')).toBe(false)
        expect(received).toHaveLength(1)
        unsub()
    })

    it('dispatchSelect (additive) adds to existing selection, fires once', () => {
        dispatchSelect(['/a.md'])

        const received: ReadonlySet<string>[] = []
        const unsub = subscribeSelection((s) => { received.push(s) })

        dispatchSelect(['/b.md'], true)

        expect([...getSelection()]).toEqual(['/a.md', '/b.md'])
        expect(received).toHaveLength(1)
        unsub()
    })

    it('dispatchSelect (replace) replaces previous selection', () => {
        dispatchSelect(['/a.md', '/b.md'])
        dispatchSelect(['/c.md'])

        expect([...getSelection()]).toEqual(['/c.md'])
        expect(isSelected('/a.md')).toBe(false)
        expect(isSelected('/c.md')).toBe(true)
    })

    it('dispatchDeselect removes specified IDs', () => {
        dispatchSelect(['/a.md', '/b.md', '/c.md'])
        dispatchDeselect(['/b.md'])

        expect([...getSelection()]).toEqual(['/a.md', '/c.md'])
        expect(isSelected('/b.md')).toBe(false)
    })

    it('dispatchDeselect notifies subscriber once', () => {
        dispatchSelect(['/a.md', '/b.md'])

        const received: ReadonlySet<string>[] = []
        const unsub = subscribeSelection((s) => { received.push(s) })

        dispatchDeselect(['/a.md'])

        expect(received).toHaveLength(1)
        unsub()
    })

    it('dispatchDeselect on absent ID does not notify', () => {
        dispatchSelect(['/a.md'])

        const received: ReadonlySet<string>[] = []
        const unsub = subscribeSelection((s) => { received.push(s) })

        dispatchDeselect(['/not-there.md'])

        expect(received).toHaveLength(0)
        unsub()
    })

    it('subscribeSelection returns working unsubscribe', () => {
        const received: ReadonlySet<string>[] = []
        const unsub = subscribeSelection((s) => { received.push(s) })

        dispatchSelect(['/a.md'])
        expect(received).toHaveLength(1)

        unsub()
        dispatchSelect(['/b.md'])
        expect(received).toHaveLength(1)
    })

    it('no notification when selection unchanged (additive no-op)', () => {
        dispatchSelect(['/a.md'])

        const received: ReadonlySet<string>[] = []
        const unsub = subscribeSelection((s) => { received.push(s) })

        dispatchSelect(['/a.md'], true) // already selected

        expect(received).toHaveLength(0)
        unsub()
    })
})

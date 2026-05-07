import { describe, expect, it } from 'vitest'

import { applyCommand, applyCommandWithDelta, emptyState } from '../../src/applyCommand'

describe('applyCommand SetPan (BF-167)', () => {
    it('sets state.layout.pan and emits layoutChanged.pan', () => {
        const initial = emptyState()
        const { state, delta } = applyCommandWithDelta(initial, {
            type: 'SetPan',
            pan: { x: 100, y: -50 },
        })

        expect(state.layout.pan).toEqual({ x: 100, y: -50 })
        expect(state.meta.revision).toBe(initial.meta.revision + 1)
        expect(delta.layoutChanged?.pan).toEqual({ x: 100, y: -50 })
    })

    it('is no-op when pan is unchanged (omits layoutChanged but bumps revision)', () => {
        const after = applyCommand(emptyState(), {
            type: 'SetPan',
            pan: { x: 5, y: 5 },
        })
        const { state, delta } = applyCommandWithDelta(after, {
            type: 'SetPan',
            pan: { x: 5, y: 5 },
        })

        expect(state.layout).toBe(after.layout)
        expect(state.meta.revision).toBe(after.meta.revision + 1)
        expect(delta.layoutChanged).toBeUndefined()
    })

    it('treats different pan values as a change', () => {
        const after = applyCommand(emptyState(), {
            type: 'SetPan',
            pan: { x: 0, y: 0 },
        })
        const { state, delta } = applyCommandWithDelta(after, {
            type: 'SetPan',
            pan: { x: 0, y: 1 },
        })

        expect(state.layout.pan).toEqual({ x: 0, y: 1 })
        expect(delta.layoutChanged?.pan).toEqual({ x: 0, y: 1 })
    })
})

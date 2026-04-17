import { describe, expect, it } from 'vitest'

import { applyCommand, applyCommandWithDelta, emptyState } from '../../src/applyCommand'

describe('applyCommand RequestFit (BF-167)', () => {
    it('records fit on layout with provided paddingPx', () => {
        const initial = emptyState()
        const { state, delta } = applyCommandWithDelta(initial, {
            type: 'RequestFit',
            paddingPx: 80,
        })

        expect(state.layout.fit).toEqual({ paddingPx: 80 })
        expect(delta.layoutChanged?.fit).toEqual({ paddingPx: 80 })
        expect(state.meta.revision).toBe(initial.meta.revision + 1)
    })

    it('defaults paddingPx to 50 when omitted', () => {
        const { state, delta } = applyCommandWithDelta(emptyState(), { type: 'RequestFit' })

        expect(state.layout.fit).toEqual({ paddingPx: 50 })
        expect(delta.layoutChanged?.fit).toEqual({ paddingPx: 50 })
    })

    it('always emits layoutChanged.fit (gesture, not stable state)', () => {
        // Even if paddingPx unchanged, fit should re-fire — graph contents
        // may have changed and the renderer needs to re-fit.
        const after = applyCommand(emptyState(), { type: 'RequestFit', paddingPx: 30 })
        const { delta } = applyCommandWithDelta(after, { type: 'RequestFit', paddingPx: 30 })

        expect(delta.layoutChanged?.fit).toEqual({ paddingPx: 30 })
    })
})

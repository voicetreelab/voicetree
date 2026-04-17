import { describe, expect, it } from 'vitest'

import { applyCommand, applyCommandWithDelta, emptyState } from '../../src/applyCommand'

describe('applyCommand SetZoom (BF-167)', () => {
    it('sets state.layout.zoom and emits layoutChanged.zoom', () => {
        const initial = emptyState()
        const { state, delta } = applyCommandWithDelta(initial, { type: 'SetZoom', zoom: 1.5 })

        expect(state.layout.zoom).toBe(1.5)
        expect(state.meta.revision).toBe(initial.meta.revision + 1)
        expect(delta.layoutChanged?.zoom).toBe(1.5)
    })

    it('is no-op when zoom is unchanged (omits layoutChanged but still bumps revision)', () => {
        const after = applyCommand(emptyState(), { type: 'SetZoom', zoom: 2 })
        const { state, delta } = applyCommandWithDelta(after, { type: 'SetZoom', zoom: 2 })

        expect(state.layout).toBe(after.layout)
        expect(state.meta.revision).toBe(after.meta.revision + 1)
        expect(delta.layoutChanged).toBeUndefined()
    })

    it('replaces zoom (last-wins) without touching positions/pan/fit', () => {
        const positioned = {
            ...emptyState(),
            layout: {
                positions: new Map([['/a.md', { x: 1, y: 2 }]]),
                pan: { x: 10, y: 20 },
                fit: null,
            },
        }
        const { state } = applyCommandWithDelta(positioned, { type: 'SetZoom', zoom: 0.5 })

        expect(state.layout.zoom).toBe(0.5)
        expect(state.layout.pan).toEqual({ x: 10, y: 20 })
        expect(state.layout.positions.get('/a.md')).toEqual({ x: 1, y: 2 })
        expect(state.layout.fit).toBeNull()
    })
})

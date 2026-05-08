import { describe, expect, it } from 'vitest'

import { applyCommandWithDelta, emptyState } from '../../src/applyCommand'

describe('applyCommand SetPositions (BF-167)', () => {
    it('merges positions by nodeId (last-wins per id)', () => {
        const initial = {
            ...emptyState(),
            layout: {
                positions: new Map([
                    ['/a.md', { x: 1, y: 1 }],
                    ['/b.md', { x: 2, y: 2 }],
                ]),
            },
        }
        const incoming = new Map([
            ['/b.md', { x: 20, y: 20 }],
            ['/c.md', { x: 3, y: 3 }],
        ])

        const { state, delta } = applyCommandWithDelta(initial, {
            type: 'SetPositions',
            positions: incoming,
        })

        expect(state.layout.positions.get('/a.md')).toEqual({ x: 1, y: 1 })
        expect(state.layout.positions.get('/b.md')).toEqual({ x: 20, y: 20 })
        expect(state.layout.positions.get('/c.md')).toEqual({ x: 3, y: 3 })

        expect(delta.layoutChanged?.positions?.get('/b.md')).toEqual({ x: 20, y: 20 })
        expect(delta.layoutChanged?.positions?.get('/c.md')).toEqual({ x: 3, y: 3 })
        expect(delta.layoutChanged?.positions?.has('/a.md')).toBe(false)
    })

    it('omits unchanged positions from delta (per-id idempotence)', () => {
        const initial = {
            ...emptyState(),
            layout: {
                positions: new Map([['/a.md', { x: 1, y: 1 }]]),
            },
        }
        const { state, delta } = applyCommandWithDelta(initial, {
            type: 'SetPositions',
            positions: new Map([['/a.md', { x: 1, y: 1 }]]),
        })

        expect(state.layout).toBe(initial.layout)
        expect(delta.layoutChanged).toBeUndefined()
        expect(state.meta.revision).toBe(initial.meta.revision + 1)
    })

    it('handles an empty positions map as a no-op', () => {
        const initial = emptyState()
        const { state, delta } = applyCommandWithDelta(initial, {
            type: 'SetPositions',
            positions: new Map(),
        })

        expect(state.layout).toBe(initial.layout)
        expect(delta.layoutChanged).toBeUndefined()
    })
})

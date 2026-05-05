import { expect, test } from 'vitest'

import { emptyState } from './emptyState'

test('emptyState returns a revision-0 empty state', () => {
    const state = emptyState()

    expect(state.meta.schemaVersion).toBe(1)
    expect(state.meta.revision).toBe(0)
    expect(Object.keys(state.graph.nodes)).toEqual([])
    expect(state.roots.loaded.size).toBe(0)
    expect(state.roots.folderTree.length).toBe(0)
    expect(state.collapseSet.size).toBe(0)
    expect(state.selection.size).toBe(0)
    expect(state.layout.positions.size).toBe(0)
})

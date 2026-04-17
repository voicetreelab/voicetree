import assert from 'node:assert/strict'
import { test } from 'node:test'

import { emptyState } from './emptyState'

test('emptyState returns a revision-0 empty state', () => {
    const state = emptyState()

    assert.equal(state.meta.schemaVersion, 1)
    assert.equal(state.meta.revision, 0)
    assert.deepEqual(Object.keys(state.graph.nodes), [])
    assert.equal(state.roots.loaded.size, 0)
    assert.equal(state.roots.folderTree.length, 0)
    assert.equal(state.collapseSet.size, 0)
    assert.equal(state.selection.size, 0)
    assert.equal(state.layout.positions.size, 0)
})

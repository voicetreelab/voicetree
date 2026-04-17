import assert from 'node:assert/strict'

import { emptyState } from '@vt/graph-state'

const state = emptyState()

assert.equal(state.meta.schemaVersion, 1)
assert.equal(state.meta.revision, 0)
assert.equal(state.roots.loaded.size, 0)
assert.equal(state.layout.positions.size, 0)

console.log('OK')

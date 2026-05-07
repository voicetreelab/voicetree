import { describe, expect, it } from 'vitest'

import { applyCommandWithDelta } from '../src/applyCommand'
import { loadSnapshot, readSnapshotDocument, serializeState } from '../src/fixtures'

const ROOT_B = '/tmp/graph-state-fixtures/root-b'
const REMOTE_ID = `${ROOT_B}/remote.md`

describe('applyCommand UnloadRoot', () => {
    it('removes root-b nodes and root from loaded', () => {
        const initial = loadSnapshot('051-two-roots-loaded')
        const { state, delta } = applyCommandWithDelta(initial, { type: 'UnloadRoot', root: ROOT_B })

        expect(state.roots.loaded.has(ROOT_B)).toBe(false)
        expect(state.graph.nodes[REMOTE_ID]).toBeUndefined()
        expect(delta.rootsUnloaded).toEqual([ROOT_B])
        expect(state.meta.revision).toBe(initial.meta.revision + 1)
    })

    it('matches fixture 050-two-roots-root-a-only', () => {
        const initial = loadSnapshot('051-two-roots-loaded')
        const { state } = applyCommandWithDelta(initial, { type: 'UnloadRoot', root: ROOT_B })

        const snapshot = readSnapshotDocument('050-two-roots-root-a-only')
        expect(serializeState(state)).toEqual({
            ...snapshot.state,
            meta: { ...snapshot.state.meta, revision: state.meta.revision },
        })
        expect(state.meta.revision - initial.meta.revision).toBe(1)
    })

    it('removes root-b folder-tree entry', () => {
        const initial = loadSnapshot('051-two-roots-loaded')
        const { state } = applyCommandWithDelta(initial, { type: 'UnloadRoot', root: ROOT_B })

        expect(state.roots.folderTree).toHaveLength(1)
        expect(state.roots.folderTree[0].absolutePath).not.toBe(ROOT_B)
    })

    it('cleans selection when unloaded nodes were selected', () => {
        const initial = loadSnapshot('051-two-roots-loaded')
        const withSelection = {
            ...initial,
            selection: new Set([REMOTE_ID, ...initial.selection]),
        }
        const { state, delta } = applyCommandWithDelta(withSelection, { type: 'UnloadRoot', root: ROOT_B })

        expect(state.selection.has(REMOTE_ID)).toBe(false)
        expect(delta.rootsUnloaded).toEqual([ROOT_B])
    })

    it('is a no-op for root not in loaded set', () => {
        const initial = loadSnapshot('050-two-roots-root-a-only')
        const { state, delta } = applyCommandWithDelta(initial, { type: 'UnloadRoot', root: ROOT_B })

        expect(state.roots.loaded.has(ROOT_B)).toBe(false)
        expect(delta.rootsUnloaded).toEqual([])
        expect(state.meta.revision).toBe(initial.meta.revision + 1)
    })
})

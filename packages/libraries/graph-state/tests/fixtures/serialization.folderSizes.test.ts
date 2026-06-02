/**
 * Black-box round-trip test for state.layout.folderSizes through
 * serializeState → hydrateState. Folder sizes (keyed by FolderId) are spatial
 * layout, so they must survive serialization like positions do.
 */
import { describe, expect, it } from 'vitest'

import { emptyState, serializeState, hydrateState } from '../../src'
import type { State } from '../../src/contract'

function stateWithFolderSizes(folderSizes: ReadonlyMap<string, { width: number; height: number }>): State {
    const base = emptyState()
    return { ...base, layout: { ...base.layout, folderSizes } }
}

describe('layout.folderSizes serialization', () => {
    it('round-trips folder sizes keyed by directory id', () => {
        const folderSizes = new Map([
            ['/proj/work/', { width: 420, height: 360 }],
            ['/proj/notes/', { width: 200, height: 120 }],
        ])
        const hydrated = hydrateState(serializeState(stateWithFolderSizes(folderSizes)))
        expect(hydrated.layout.folderSizes?.get('/proj/work/')).toEqual({ width: 420, height: 360 })
        expect(hydrated.layout.folderSizes?.get('/proj/notes/')).toEqual({ width: 200, height: 120 })
    })

    it('omits folderSizes entirely when empty', () => {
        const serialized = serializeState(stateWithFolderSizes(new Map()))
        expect(serialized.layout.folderSizes).toBeUndefined()
        expect(hydrateState(serialized).layout.folderSizes).toBeUndefined()
    })
})

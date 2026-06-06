import { describe, it, expect } from 'vitest'
import { createGraph, createNewNodeNoParent, type Graph } from '@vt/graph-model/graph'
import { resolveNewNodeWriteDir } from './resolveNewNodeWriteDir'

/**
 * The right-click menu detects the folder node under the cursor (its id is an absolute
 * directory path carrying a trailing slash) and passes it here. The new node should be
 * written into that folder, falling back to the project-wide write folder otherwise.
 */
describe('resolveNewNodeWriteDir', () => {
    const writeFolder: string = '/proj/write-folder'

    it('falls back to the write folder when no folder was clicked', () => {
        expect(resolveNewNodeWriteDir(undefined, writeFolder)).toBe(writeFolder)
    })

    it('uses the clicked folder, stripping its trailing slash', () => {
        expect(resolveNewNodeWriteDir('/proj/notes/', writeFolder)).toBe('/proj/notes')
    })

    it('uses a clicked folder id that already has no trailing slash', () => {
        expect(resolveNewNodeWriteDir('/proj/notes', writeFolder)).toBe('/proj/notes')
    })

    it('handles nested clicked folders', () => {
        expect(resolveNewNodeWriteDir('/proj/notes/sub/deep/', writeFolder)).toBe('/proj/notes/sub/deep')
    })

    it('strips redundant trailing slashes', () => {
        expect(resolveNewNodeWriteDir('/proj/notes///', writeFolder)).toBe('/proj/notes')
    })

    it('falls back to the write folder for a degenerate root folder id', () => {
        // A bare "/" strips to "" — never a valid write target, so use the write folder.
        expect(resolveNewNodeWriteDir('/', writeFolder)).toBe(writeFolder)
    })

    it('falls back to the write folder for an empty clicked folder id', () => {
        expect(resolveNewNodeWriteDir('', writeFolder)).toBe(writeFolder)
    })
})

/**
 * Integration with graph-model's node-creation: a node created after a click inside a
 * folder lands in that folder, not the project write folder.
 */
describe('resolveNewNodeWriteDir → createNewNodeNoParent', () => {
    const writeFolder: string = '/proj/write-folder'
    const emptyGraph: Graph = createGraph({})

    it('places the new node inside the clicked folder', () => {
        const targetDir: string = resolveNewNodeWriteDir('/proj/notes/', writeFolder)
        const { newNode } = createNewNodeNoParent({ x: 10, y: 20 }, targetDir, emptyGraph)

        expect(newNode.absoluteFilePathIsID.startsWith('/proj/notes/')).toBe(true)
        expect(newNode.absoluteFilePathIsID.startsWith('/proj/notes//')).toBe(false)
    })

    it('places the new node in the write folder when the click missed all folders', () => {
        const targetDir: string = resolveNewNodeWriteDir(undefined, writeFolder)
        const { newNode } = createNewNodeNoParent({ x: 10, y: 20 }, targetDir, emptyGraph)

        expect(newNode.absoluteFilePathIsID.startsWith('/proj/write-folder/')).toBe(true)
    })
})

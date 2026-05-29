import * as O from 'fp-ts/lib/Option.js'
import { describe, expect, it } from 'vitest'

import { type AbsolutePath, type FolderTreeNode, type GraphNode } from '@vt/graph-model'
import { applyCommandWithDelta, emptyState } from '../../src/applyCommand'
import {
    findWriteTargetPath,
    getBasename,
    joinPath,
    normalizePathValue,
    pathContains,
    updateFolderTreeForAddedNode,
    updateFolderTreeForRemovedNode,
    updateLayoutForAddedNode,
    updateLayoutForRemovedNode,
} from '../../src/apply/folderTreeHelpers'
import type { State } from '../../src/contract'

const ROOT = '/tmp/folder-tree/root' as AbsolutePath
const CHILD_ROOT = '/tmp/folder-tree/root/child' as AbsolutePath

function folder(
    absolutePath: string,
    children: FolderTreeNode['children'] = [],
    options: { readonly isWriteTarget?: boolean; readonly loadState?: FolderTreeNode['loadState'] } = {},
): FolderTreeNode {
    return {
        name: getBasename(absolutePath),
        absolutePath: absolutePath as AbsolutePath,
        children,
        loadState: options.loadState ?? 'loaded',
        isWriteTarget: options.isWriteTarget ?? false,
    }
}

function node(id: string, position = O.none): GraphNode {
    return {
        absoluteFilePathIsID: id,
        contentWithoutYamlOrLinks: `# ${getBasename(id)}\n`,
        outgoingEdges: [],
        nodeUIMetadata: {
            color: O.none,
            position,
            additionalYAMLProps: {},
        },
    }
}

function stateWithRoots(roots: State['roots']): State {
    return {
        ...emptyState(),
        roots,
    }
}

describe('folderTreeHelpers path utilities', () => {
    it('normalizes slashes and extracts basenames from trailing-slash paths', () => {
        expect(normalizePathValue('C:\\project\\notes\\')).toBe('C:/project/notes/')
        expect(getBasename('/tmp/project/notes///')).toBe('notes')
        expect(getBasename('C:\\project\\daily.md')).toBe('daily.md')
    })

    it('checks containment on path boundaries and joins below normalized parents', () => {
        expect(pathContains('/tmp/project/', '/tmp/project')).toBe(true)
        expect(pathContains('/tmp/project', '/tmp/project/notes/a.md')).toBe(true)
        expect(pathContains('/tmp/project', '/tmp/project-other/a.md')).toBe(false)
        expect(pathContains('/tmp/project', '/tmp/projected/a.md')).toBe(false)
        expect(joinPath('/tmp/project///' as AbsolutePath, 'notes')).toBe('/tmp/project/notes')
    })
})

describe('folderTreeHelpers root and tree updates', () => {
    it('finds nested write targets while ignoring file children', () => {
        const tree = [
            folder('/tmp/read', [
                {
                    name: 'readme.md',
                    absolutePath: '/tmp/read/readme.md' as AbsolutePath,
                    isInGraph: true,
                },
                folder('/tmp/read/nested', [], { isWriteTarget: true }),
            ]),
        ]

        expect(findWriteTargetPath(tree)).toBe('/tmp/read/nested')
    })

    it('creates a folder tree under the deepest loaded root that contains a new node', () => {
        const roots = {
            loaded: new Set<string>([ROOT, CHILD_ROOT]),
            folderTree: [],
        }
        const added = node('/tmp/folder-tree/root/child/grand/file.md')
        const graph = { ...emptyState().graph, nodes: { [added.absoluteFilePathIsID]: added } }

        const next = updateFolderTreeForAddedNode(roots, added.absoluteFilePathIsID, graph)

        expect(next.folderTree).toHaveLength(1)
        expect(next.folderTree[0]).toMatchObject({
            name: 'child',
            absolutePath: CHILD_ROOT,
            children: [{
                name: 'grand',
                absolutePath: '/tmp/folder-tree/root/child/grand',
                children: [{
                    name: 'file.md',
                    absolutePath: '/tmp/folder-tree/root/child/grand/file.md',
                    isInGraph: true,
                }],
            }],
        })
    })

    it('does not change roots when adding a node outside every loaded root', () => {
        const roots = {
            loaded: new Set<string>([ROOT]),
            folderTree: [folder(ROOT)],
        }
        const added = node('/tmp/other/file.md')
        const graph = { ...emptyState().graph, nodes: { [added.absoluteFilePathIsID]: added } }

        expect(updateFolderTreeForAddedNode(roots, added.absoluteFilePathIsID, graph)).toBe(roots)
    })

    it('removes a nested file without deleting sibling files or directories', () => {
        const removed = node('/tmp/folder-tree/root/tasks/old.md')
        const kept = node('/tmp/folder-tree/root/tasks/keep.md')
        const initial = applyCommandWithDelta(
            applyCommandWithDelta(stateWithRoots({
                loaded: new Set<string>([ROOT]),
                folderTree: [folder(ROOT)],
            }), { type: 'AddNode', node: removed }).state,
            { type: 'AddNode', node: kept },
        ).state

        const result = applyCommandWithDelta(initial, {
            type: 'RemoveNode',
            id: removed.absoluteFilePathIsID,
        })
        const tasks = result.state.roots.folderTree[0].children[0]

        expect(tasks).toMatchObject({
            name: 'tasks',
            absolutePath: '/tmp/folder-tree/root/tasks',
            children: [{
                name: 'keep.md',
                absolutePath: kept.absoluteFilePathIsID,
                isInGraph: true,
            }],
        })
        expect(result.state.graph.nodes[removed.absoluteFilePathIsID]).toBeUndefined()
        expect(result.state.graph.nodes[kept.absoluteFilePathIsID]).toBeDefined()
    })

    it('does not prune children when asked to remove the root path itself', () => {
        const roots = {
            loaded: new Set<string>([ROOT]),
            folderTree: [folder(ROOT, [folder('/tmp/folder-tree/root/tasks')])],
        }

        const next = updateFolderTreeForRemovedNode(roots, ROOT, emptyState().graph)

        expect(next.folderTree[0].children).toHaveLength(1)
        expect(next.folderTree[0].children[0]).toMatchObject({
            name: 'tasks',
            absolutePath: '/tmp/folder-tree/root/tasks',
        })
    })
})

describe('folderTreeHelpers layout updates', () => {
    it('keeps layout unchanged when added node has no position', () => {
        const layout = { positions: new Map() }

        expect(updateLayoutForAddedNode(layout, node('/tmp/a.md'))).toBe(layout)
    })

    it('keeps layout unchanged when the node position is already current', () => {
        const positioned = node('/tmp/a.md', O.some({ x: 1, y: 2 }))
        const layout = { positions: new Map([[positioned.absoluteFilePathIsID, { x: 1, y: 2 }]]) }

        expect(updateLayoutForAddedNode(layout, positioned)).toBe(layout)
    })

    it('updates layout when either coordinate changes and preserves it for absent removals', () => {
        const id = '/tmp/a.md'
        const layout = { positions: new Map([[id, { x: 1, y: 2 }]]) }
        const moved = updateLayoutForAddedNode(layout, node(id, O.some({ x: 1, y: 3 })))

        expect(moved).not.toBe(layout)
        expect(moved.positions.get(id)).toEqual({ x: 1, y: 3 })
        expect(updateLayoutForRemovedNode(moved, '/tmp/missing.md')).toBe(moved)
    })
})

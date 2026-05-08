import * as E from 'fp-ts/lib/Either.js'
import * as O from 'fp-ts/lib/Option.js'
import { afterEach, describe, expect, it } from 'vitest'

import {
    buildGraphFromFiles,
    createGraph,
    type DirectoryEntry,
    type GraphNode,
} from '@vt/graph-model'
import { applyLoadRoot, applyUnloadRoot } from '../src/apply/roots'
import { loadSnapshot } from '../src/fixtures'
import { clearRootIOForTests, configureRootIO } from '../src/rootIO'
import {
    clearFolderVisibilityStoreForTests,
    configureFolderVisibilityStore,
    getFolderVisibility,
    type FolderVisibilityDatabase,
} from '../src/state/folderVisibilityStore'
import type { FolderState } from '../src/state/folderVisibility/types'

const ROOT_A = '/tmp/graph-state-fixtures/root-a'
const ROOT_B = '/tmp/graph-state-fixtures/root-b'
const ROOT_C = '/tmp/graph-state-fixtures/root-c'
const OVERVIEW_ID = `${ROOT_A}/overview.md`
const ROOT_B_NOTE_ID = `${ROOT_B}/remote.md`
const ROOT_C_NOTE_ID = `${ROOT_C}/fresh.md`

afterEach(() => {
    clearRootIOForTests()
    clearFolderVisibilityStoreForTests()
})

function createMemoryFolderVisibilityDatabase(): FolderVisibilityDatabase {
    const rows = new Map<string, { view_id: string; path: string; state: FolderState }>()
    const key = (viewId: string, rowPath: string): string => `${viewId}\0${rowPath}`

    return {
        prepare: () => ({
            all: (viewId: string) => [...rows.values()]
                .filter(row => row.view_id === viewId)
                .sort((left, right) => left.path.localeCompare(right.path))
                .map(({ path, state }) => ({ path, state })),
            get: (viewId: string, rowPath: string) => rows.get(key(viewId, rowPath)),
            run: (viewId: string, rowPath: string, state: FolderState) => {
                rows.set(key(viewId, rowPath), { view_id: viewId, path: rowPath, state })
                return { changes: 1 }
            },
        }),
        transaction: fn => (...args) => fn(...args),
    }
}

function rootDirectory(rootPath: string, notePath: string): DirectoryEntry {
    return {
        name: rootPath.slice(rootPath.lastIndexOf('/') + 1),
        absolutePath: rootPath,
        isDirectory: true,
        children: [{
            name: notePath.slice(notePath.lastIndexOf('/') + 1),
            absolutePath: notePath,
            isDirectory: false,
        }],
    }
}

function noteNode(id: string): GraphNode {
    return {
        kind: 'leaf',
        outgoingEdges: [],
        absoluteFilePathIsID: id,
        contentWithoutYamlOrLinks: `# ${id.slice(id.lastIndexOf('/') + 1)}\n`,
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map(),
        },
    }
}

describe('apply roots mutation coverage', () => {
    it('loads a new root, preserves colliding existing nodes, and records visibility', async () => {
        configureFolderVisibilityStore(createMemoryFolderVisibilityDatabase())
        configureRootIO({
            getDirectoryTree: async (rootPath) => rootDirectory(rootPath, ROOT_C_NOTE_ID),
            loadGraphFromDisk: async (vaultPaths) => {
                if (vaultPaths.length !== 1 || vaultPaths[0] !== ROOT_C) {
                    return E.left({ message: 'unexpected roots', vaultPaths })
                }
                return E.right(buildGraphFromFiles([
                    {
                        absolutePath: OVERVIEW_ID,
                        content: '# mutated overview\n\nThis must not replace the existing node.\n',
                    },
                    {
                        absolutePath: ROOT_C_NOTE_ID,
                        content: '# fresh\n\nNew root note.\n',
                    },
                ]))
            },
        })
        const initial = loadSnapshot('050-two-roots-root-a-only')

        const { state, delta } = await applyLoadRoot(initial, { type: 'LoadRoot', root: ROOT_C })

        expect(state.roots.loaded.has(ROOT_C)).toBe(true)
        expect(state.roots.folderTree.map(root => root.absolutePath)).toEqual([ROOT_A, ROOT_C])
        expect(state.graph.nodes[ROOT_C_NOTE_ID]?.contentWithoutYamlOrLinks).toContain('New root note')
        expect(state.graph.nodes[OVERVIEW_ID]?.contentWithoutYamlOrLinks).toContain('Top-level summary')
        expect(delta.rootsLoaded).toEqual([ROOT_C])
        expect(delta.graph?.map(entry => entry.type)).toEqual(['UpsertNode'])
        expect(getFolderVisibility('main')).toEqual(new Map([[ROOT_C, 'expanded']]))
    })

    it('surfaces load failures with the requested root in the error message', async () => {
        configureRootIO({
            getDirectoryTree: async (rootPath) => rootDirectory(rootPath, ROOT_C_NOTE_ID),
            loadGraphFromDisk: async () => E.left({ code: 'READ_FAILED' }),
        })

        await expect(applyLoadRoot(loadSnapshot('050-two-roots-root-a-only'), {
            type: 'LoadRoot',
            root: ROOT_C,
        })).rejects.toThrow(`LoadRoot failed for "${ROOT_C}"`)
    })

    it('unloads root nodes and cleans selection, positions, collapse state, and visibility', () => {
        configureFolderVisibilityStore(createMemoryFolderVisibilityDatabase())
        const initial = loadSnapshot('051-two-roots-loaded')
        const stateWithRootLevelData = {
            ...initial,
            graph: createGraph({
                ...initial.graph.nodes,
                [ROOT_B]: noteNode(ROOT_B),
            }),
            selection: new Set([ROOT_A, ROOT_B, ROOT_B_NOTE_ID]),
            layout: {
                ...initial.layout,
                positions: new Map([
                    [ROOT_A, { x: 1, y: 1 }],
                    [ROOT_B, { x: 2, y: 2 }],
                    [ROOT_B_NOTE_ID, { x: 3, y: 3 }],
                ]),
            },
            collapseSet: new Set([`${ROOT_A}/tasks`, ROOT_B, `${ROOT_B}/nested`]),
        }

        const { state, delta } = applyUnloadRoot(stateWithRootLevelData, {
            type: 'UnloadRoot',
            root: ROOT_B,
        })

        expect(state.graph.nodes[ROOT_B]).toBeUndefined()
        expect(state.graph.nodes[ROOT_B_NOTE_ID]).toBeUndefined()
        expect(state.selection).toEqual(new Set([ROOT_A]))
        expect(state.layout.positions).toEqual(new Map([[ROOT_A, { x: 1, y: 1 }]]))
        expect(state.collapseSet).toEqual(new Set([`${ROOT_A}/tasks`]))
        expect(delta.rootsUnloaded).toEqual([ROOT_B])
        expect(delta.graph?.some(entry => entry.type === 'DeleteNode' && entry.nodeId === ROOT_B)).toBe(true)
        expect(delta.graph?.some(entry => entry.type === 'DeleteNode' && entry.nodeId === ROOT_B_NOTE_ID)).toBe(true)
        expect(getFolderVisibility('main')).toEqual(new Map([[ROOT_B, 'hidden']]))
    })
})

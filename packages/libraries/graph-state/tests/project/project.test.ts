import * as O from 'fp-ts/lib/Option.js'
import { describe, expect, it } from 'vitest'

import { toAbsolutePath } from '@vt/graph-model'

import { emptyState } from '../../src'
import { loadProjection, listSnapshotDocuments } from '../../src/fixtures.ts'
import { project } from '../../src/project.ts'

const snapshots = listSnapshotDocuments()

function makeLeafNode(nodeId: string, contentWithoutYamlOrLinks: string) {
    return {
        kind: 'leaf' as const,
        outgoingEdges: [],
        absoluteFilePathIsID: nodeId,
        contentWithoutYamlOrLinks,
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: {},
        },
    }
}

function makeTopicState({
    files,
    collapsed = false,
}: {
    readonly files: Readonly<Record<string, string>>
    readonly collapsed?: boolean
}) {
    const rootPath = toAbsolutePath('/tmp/project')
    const folderPath = toAbsolutePath('/tmp/project/topic')
    const folderId = `${folderPath}/`
    const graphNodes = Object.fromEntries(
        Object.entries(files).map(([name, content]) => {
            const nodeId = toAbsolutePath(`/tmp/project/topic/${name}`)
            return [nodeId, makeLeafNode(nodeId, content)]
        }),
    )

    return {
        state: {
            ...emptyState(),
            graph: {
                ...emptyState().graph,
                nodes: graphNodes,
            },
            roots: {
                loaded: new Set([rootPath]),
                folderTree: [{
                    name: 'project',
                    absolutePath: rootPath,
                    loadState: 'loaded' as const,
                    isWriteTarget: true,
                    children: [{
                        name: 'topic',
                        absolutePath: folderPath,
                        loadState: 'loaded' as const,
                        isWriteTarget: false,
                        children: Object.keys(files).map((name) => ({
                            name,
                            absolutePath: toAbsolutePath(`/tmp/project/topic/${name}`),
                            isInGraph: true,
                        })),
                    }],
                }],
            },
            collapseSet: collapsed ? new Set([folderId]) : new Set(),
        },
        folderId,
    }
}

describe('project()', () => {
    it('has a golden projection for every snapshot fixture', () => {
        expect(snapshots).toHaveLength(25)
    })

    for (const { doc, state } of snapshots) {
        it(`matches the committed projection for ${doc.id}`, () => {
            expect(project(state)).toEqual(loadProjection(doc.id))
        })
    }

    it('prunes folders whose subtree has no projectable markdown files', () => {
        const rootPath = toAbsolutePath('/tmp/project')
        const emptyFolderPath = toAbsolutePath('/tmp/project/empty')
        const contentFolderPath = toAbsolutePath('/tmp/project/notes')
        const notePath = toAbsolutePath('/tmp/project/notes/hello.md')

        const state = {
            ...emptyState(),
            graph: {
                ...emptyState().graph,
                nodes: {
                    [notePath]: {
                        kind: 'leaf',
                        outgoingEdges: [],
                        absoluteFilePathIsID: notePath,
                        contentWithoutYamlOrLinks: '# hello\n',
                        nodeUIMetadata: {
                            color: O.none,
                            position: O.none,
                            additionalYAMLProps: {},
                        },
                    },
                },
            },
            roots: {
                loaded: new Set([rootPath]),
                folderTree: [{
                    name: 'project',
                    absolutePath: rootPath,
                    loadState: 'loaded' as const,
                    isWriteTarget: true,
                    children: [
                        {
                            name: 'empty',
                            absolutePath: emptyFolderPath,
                            loadState: 'loaded' as const,
                            isWriteTarget: false,
                            children: [{
                                name: 'ghost.md',
                                absolutePath: toAbsolutePath('/tmp/project/empty/ghost.md'),
                                isInGraph: false,
                            }],
                        },
                        {
                            name: 'notes',
                            absolutePath: contentFolderPath,
                            loadState: 'loaded' as const,
                            isWriteTarget: false,
                            children: [{
                                name: 'hello.md',
                                absolutePath: notePath,
                                isInGraph: true,
                            }],
                        },
                    ],
                }],
            },
        }

        const spec = project(state)
        const folderIds = spec.nodes
            .filter((node) => node.kind === 'folder')
            .map((node) => node.id)

        expect(folderIds).not.toContain('/tmp/project/empty/')
        expect(folderIds).toContain('/tmp/project/notes/')
        expect(spec.nodes).toContainEqual(expect.objectContaining({
            id: notePath,
            kind: 'file',
            parent: '/tmp/project/notes/',
        }))
    })

    describe('folder node content', () => {
        it('prefers index.md over basename.md', () => {
            const { state, folderId } = makeTopicState({
                files: {
                    'index.md': '# Topic\n\nbody',
                    'topic.md': '# Topic fallback\n\nbody',
                    'childA.md': '# Child A\n',
                },
            })

            expect(project(state).nodes).toContainEqual(expect.objectContaining({
                id: folderId,
                kind: 'folder',
                content: '# Topic\n\nbody',
            }))
        })

        it('falls back to basename.md when index.md is missing', () => {
            const { state, folderId } = makeTopicState({
                files: {
                    'topic.md': '# Topic\n\nbody',
                    'childA.md': '# Child A\n',
                },
            })

            expect(project(state).nodes).toContainEqual(expect.objectContaining({
                id: folderId,
                kind: 'folder',
                content: '# Topic\n\nbody',
            }))
        })

        it('uses empty content when no folder-note exists', () => {
            const { state, folderId } = makeTopicState({
                files: {
                    'childA.md': '# Child A\n',
                },
            })

            expect(project(state).nodes).toContainEqual(expect.objectContaining({
                id: folderId,
                kind: 'folder',
                content: '',
            }))
        })

        it('keeps folder-note content on collapsed folders', () => {
            const { state, folderId } = makeTopicState({
                files: {
                    'index.md': '# Topic\n\nbody',
                    'topic.md': '# Topic fallback\n\nbody',
                    'childA.md': '# Child A\n',
                },
                collapsed: true,
            })

            expect(project(state).nodes).toContainEqual(expect.objectContaining({
                id: folderId,
                kind: 'folder-collapsed',
                content: '# Topic\n\nbody',
            }))
        })
    })

    describe('folder size projection', () => {
        // Folder size is keyed by the folder's DIRECTORY id in
        // state.layout.folderSizes (the folder compound is not a graph node and
        // need not have a note). Build a topic folder, then attach a size keyed
        // by its folderId.
        function topicStateWithFolderSize(
            size: { readonly width: number; readonly height: number } | undefined,
            collapsed = false,
        ) {
            const { state, folderId } = makeTopicState({
                files: { 'topic.md': '# Topic\n\nbody', 'childA.md': '# Child A\n' },
                collapsed,
            })
            return {
                folderId,
                state: {
                    ...state,
                    layout: {
                        ...state.layout,
                        folderSizes: size ? new Map([[folderId, size]]) : new Map(),
                    },
                },
            }
        }

        it('projects the folder size (by directory id) onto an expanded folder node', () => {
            const { state, folderId } = topicStateWithFolderSize({ width: 420, height: 360 })
            expect(project(state).nodes).toContainEqual(expect.objectContaining({
                id: folderId,
                kind: 'folder',
                size: { width: 420, height: 360 },
            }))
        })

        it('omits size on an expanded folder with no folderSizes entry', () => {
            const { state, folderId } = topicStateWithFolderSize(undefined)
            const folder = project(state).nodes.find((n) => n.id === folderId)
            expect(folder?.kind).toBe('folder')
            expect(folder?.size).toBeUndefined()
        })

        it('does not project size onto a collapsed folder pill', () => {
            const { state, folderId } = topicStateWithFolderSize({ width: 420, height: 360 }, true)
            const folder = project(state).nodes.find((n) => n.id === folderId)
            expect(folder?.kind).toBe('folder-collapsed')
            expect(folder?.size).toBeUndefined()
        })
    })
})

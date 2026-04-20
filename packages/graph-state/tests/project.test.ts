import * as O from 'fp-ts/lib/Option.js'
import { describe, expect, it } from 'vitest'

import { toAbsolutePath } from '@vt/graph-model'

import { emptyState } from '../src'
import { loadProjection, listSnapshotDocuments } from '../src/fixtures.ts'
import { project } from '../src/project.ts'

const snapshots = listSnapshotDocuments()

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
                        outgoingEdges: [],
                        absoluteFilePathIsID: notePath,
                        contentWithoutYamlOrLinks: '# hello\n',
                        nodeUIMetadata: {
                            color: O.none,
                            position: O.none,
                            additionalYAMLProps: new Map(),
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
            kind: 'node',
            parent: '/tmp/project/notes/',
        }))
    })
})

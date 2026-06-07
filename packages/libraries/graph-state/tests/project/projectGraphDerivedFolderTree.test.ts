import * as O from 'fp-ts/lib/Option.js'
import { describe, expect, it } from 'vitest'

import { toAbsolutePath, type FolderTreeNode, type Graph } from '@vt/graph-model'

import { projectGraphDerivedFolderTree } from '../../src/projectGraphDerivedFolderTree'

function makeGraph(paths: readonly string[]): Graph {
    return {
        nodes: Object.fromEntries(paths.map((path) => [toAbsolutePath(path), leaf(path)])),
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map(),
    }
}

function leaf(path: string): Graph['nodes'][string] {
    const nodeId = toAbsolutePath(path)
    return {
        kind: 'leaf' as const,
        outgoingEdges: [],
        absoluteFilePathIsID: nodeId,
        contentWithoutYamlOrLinks: '# Task\n',
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: {},
        },
    }
}

function collectFolderPaths(root: FolderTreeNode): readonly string[] {
    const paths: string[] = [root.absolutePath]
    for (const child of root.children) {
        if ('children' in child) paths.push(...collectFolderPaths(child))
    }
    return paths
}

function childFolder(root: FolderTreeNode, name: string): FolderTreeNode {
    const child = root.children.find((entry) => entry.name === name)
    if (!child || !('children' in child)) throw new Error(`missing folder ${name}`)
    return child
}

describe('projectGraphDerivedFolderTree', () => {
    it('projects graph-only task folders under the active project root', () => {
        const projectRoot = '/Users/example/repos/forecast-runs/ACLED'
        const taskFolder = `${projectRoot}/task-folder-live-state`
        const notePath = `${taskFolder}/task-folder-live-state.md`

        const tree = projectGraphDerivedFolderTree({
            graph: makeGraph([notePath]),
            projectRoot,
            readPaths: [projectRoot],
            projectPaths: [projectRoot],
            writeFolderPath: projectRoot,
        })

        expect(tree).not.toBeNull()
        expect(tree).toMatchObject({
            name: 'ACLED',
            absolutePath: toAbsolutePath(projectRoot),
            loadState: 'loaded',
            isWriteTarget: true,
            children: [{
                name: 'task-folder-live-state',
                absolutePath: toAbsolutePath(taskFolder),
                loadState: 'not-loaded',
                isWriteTarget: false,
                children: [{
                    name: 'task-folder-live-state.md',
                    absolutePath: toAbsolutePath(notePath),
                    isInGraph: true,
                }],
            }],
        })
    })

    it('includes read, project, and write folders even before they contain graph nodes', () => {
        const projectRoot = '/tmp/project'
        const readPath = '/tmp/project/read-only'
        const projectPath = '/tmp/project/nested/project-path'
        const writePath = '/tmp/project/nested/write-target'

        const tree = projectGraphDerivedFolderTree({
            graph: makeGraph([]),
            projectRoot,
            readPaths: [readPath],
            projectPaths: [projectPath],
            writeFolderPath: writePath,
        })

        expect(tree).not.toBeNull()
        expect(collectFolderPaths(tree!)).toEqual([
            toAbsolutePath(projectRoot),
            toAbsolutePath(readPath),
            toAbsolutePath('/tmp/project/nested'),
            toAbsolutePath(projectPath),
            toAbsolutePath(writePath),
        ])
        expect(childFolder(tree!, 'read-only').loadState).toBe('loaded')
        expect(childFolder(childFolder(tree!, 'nested'), 'project-path').loadState).toBe('loaded')
        expect(childFolder(childFolder(tree!, 'nested'), 'write-target').isWriteTarget).toBe(true)
    })

    it('excludes files and roots outside the active project root', () => {
        const projectRoot = '/tmp/project'
        const insideNote = '/tmp/project/tasks/a.md'
        const outsideNote = '/tmp/project-other/tasks/b.md'

        const tree = projectGraphDerivedFolderTree({
            graph: makeGraph([insideNote, outsideNote]),
            projectRoot,
            readPaths: ['/tmp/project-other'],
            projectPaths: ['/tmp/project/tasks'],
            writeFolderPath: '/tmp/project-other',
        })

        expect(tree).not.toBeNull()
        expect(collectFolderPaths(tree!)).toEqual([
            toAbsolutePath(projectRoot),
            toAbsolutePath('/tmp/project/tasks'),
        ])
        expect(childFolder(tree!, 'tasks').children).toEqual([{
            name: 'a.md',
            absolutePath: toAbsolutePath(insideNote),
            isInGraph: true,
        }])
    })

    it('normalizes trailing slashes on project and candidate folders', () => {
        const projectRoot = '/tmp/project/'
        const notePath = '/tmp/project/tasks/a.md'

        const tree = projectGraphDerivedFolderTree({
            graph: makeGraph([notePath]),
            projectRoot,
            readPaths: ['/tmp/project/tasks/'],
            projectPaths: [],
            writeFolderPath: '/tmp/project/tasks/',
        })

        expect(tree).not.toBeNull()
        expect(tree!.absolutePath).toBe(toAbsolutePath('/tmp/project'))
        expect(childFolder(tree!, 'tasks')).toMatchObject({
            absolutePath: toAbsolutePath('/tmp/project/tasks'),
            loadState: 'loaded',
            isWriteTarget: true,
        })
    })

    it('returns null when no project root anchors the projection', () => {
        expect(projectGraphDerivedFolderTree({
            graph: makeGraph(['/tmp/project/tasks/a.md']),
            projectRoot: null,
            readPaths: ['/tmp/project'],
            projectPaths: ['/tmp/project'],
            writeFolderPath: '/tmp/project',
        })).toBeNull()
    })
})

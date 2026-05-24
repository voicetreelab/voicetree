import * as O from 'fp-ts/lib/Option.js'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'

import type { FolderTreeNode, GraphNode } from '@vt/graph-model'
import { toAbsolutePath } from '@vt/graph-model'

import { emptyState } from '../../src'
import type { FolderId, ProjectedEdge, State } from '../../src/contract'
import { project } from '../../src/project'

const ROOT_PATH = toAbsolutePath('/tmp/bf110-scale')
const TOP_FOLDER_COUNT = 5
const SUBFOLDER_COUNT = 5
const LEAF_COUNT = 25
const CROSS_FOLDER_TARGET_COUNT = 25
const PERF_BUDGET_MS = 500

interface ScaleFixture {
    readonly state: State
    readonly collapsedFolderId: FolderId
    readonly expectedCountsByTarget: ReadonlyMap<string, number>
    readonly fileNodeCount: number
    readonly hiddenCrossFolderEdgeCount: number
}

function folderId(absolutePath: string): FolderId {
    return `${absolutePath}/`
}

function makeNode(id: string, targetIds: readonly string[]): GraphNode {
    return {
        kind: 'leaf',
        outgoingEdges: targetIds.map((targetId) => ({ targetId, label: '' })),
        absoluteFilePathIsID: id,
        contentWithoutYamlOrLinks: `# ${id.slice(id.lastIndexOf('/') + 1)}`,
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map(),
            isContextNode: false,
        },
    }
}

function buildScaleFixture(): ScaleFixture {
    const topFolders: FolderTreeNode[] = []
    const nodeIdsByTopFolder: string[][] = []

    for (let topIndex = 0; topIndex < TOP_FOLDER_COUNT; topIndex++) {
        const topName = `folder-${topIndex}`
        const topPath = toAbsolutePath(`${ROOT_PATH}/${topName}`)
        const subfolders: FolderTreeNode[] = []
        const topFolderNodeIds: string[] = []

        for (let subIndex = 0; subIndex < SUBFOLDER_COUNT; subIndex++) {
            const subName = `sub-${subIndex}`
            const subPath = toAbsolutePath(`${topPath}/${subName}`)
            const files: FolderTreeNode['children'] = []

            for (let leafIndex = 0; leafIndex < LEAF_COUNT; leafIndex++) {
                const name = `note-${leafIndex}.md`
                const nodeId = toAbsolutePath(`${subPath}/${name}`)
                files.push({ name, absolutePath: nodeId, isInGraph: true })
                topFolderNodeIds.push(nodeId)
            }

            subfolders.push({
                name: subName,
                absolutePath: subPath,
                loadState: 'loaded',
                isWriteTarget: false,
                children: files,
            })
        }

        topFolders.push({
            name: topName,
            absolutePath: topPath,
            loadState: 'loaded',
            isWriteTarget: topIndex === 0,
            children: subfolders,
        })
        nodeIdsByTopFolder.push(topFolderNodeIds)
    }

    const collapsedFolderId = folderId(toAbsolutePath(`${ROOT_PATH}/folder-0`))
    const hiddenSourceIds = nodeIdsByTopFolder[0]
    const targetIds = nodeIdsByTopFolder.slice(1).flat().slice(0, CROSS_FOLDER_TARGET_COUNT)
    const outgoingBySource = new Map<string, readonly string[]>()
    const expectedCountsByTarget = new Map<string, number>()

    for (let index = 0; index < hiddenSourceIds.length; index++) {
        const sourceId = hiddenSourceIds[index]
        const targetId = targetIds[index % targetIds.length]
        outgoingBySource.set(sourceId, [targetId])
        expectedCountsByTarget.set(targetId, (expectedCountsByTarget.get(targetId) ?? 0) + 1)
    }

    const graphNodes: Record<string, GraphNode> = {}
    for (const nodeIds of nodeIdsByTopFolder) {
        for (const nodeId of nodeIds) {
            graphNodes[nodeId] = makeNode(nodeId, outgoingBySource.get(nodeId) ?? [])
        }
    }

    return {
        state: {
            ...emptyState(),
            graph: {
                ...emptyState().graph,
                nodes: graphNodes,
            },
            roots: {
                loaded: new Set([ROOT_PATH]),
                folderTree: [{
                    name: 'bf110-scale',
                    absolutePath: ROOT_PATH,
                    loadState: 'loaded',
                    isWriteTarget: true,
                    children: topFolders,
                }],
            },
            collapseSet: new Set([collapsedFolderId]),
        },
        collapsedFolderId,
        expectedCountsByTarget,
        fileNodeCount: Object.keys(graphNodes).length,
        hiddenCrossFolderEdgeCount: hiddenSourceIds.length,
    }
}

function countOriginalEdges(edges: readonly ProjectedEdge[]): number {
    return edges.reduce((sum, edge) => sum + (edge.edgeCount ?? 1), 0)
}

describe('project() scale behavior', () => {
    it('aggregates collapsed-folder cross-boundary edges at 625-node nested scale within the local budget', () => {
        const fixture = buildScaleFixture()

        const startedAt = performance.now()
        const projected = project(fixture.state)
        const elapsedMs = performance.now() - startedAt

        const syntheticEdges = projected.edges.filter((edge) =>
            edge.kind === 'synthetic'
            && edge.source === fixture.collapsedFolderId
        )
        const targets = new Set(syntheticEdges.map((edge) => edge.target))
        const actualCountsByTarget = new Map(
            syntheticEdges.map((edge) => [edge.target, edge.edgeCount ?? 1] as const),
        )

        expect(fixture.fileNodeCount).toBe(625)
        expect(fixture.hiddenCrossFolderEdgeCount / fixture.fileNodeCount).toBe(0.2)
        expect(projected.nodes).toContainEqual(expect.objectContaining({
            id: fixture.collapsedFolderId,
            kind: 'folder-collapsed',
        }))
        expect(syntheticEdges).toHaveLength(fixture.expectedCountsByTarget.size)
        expect(targets.size).toBe(syntheticEdges.length)
        expect(countOriginalEdges(syntheticEdges)).toBe(fixture.hiddenCrossFolderEdgeCount)
        expect(actualCountsByTarget).toEqual(fixture.expectedCountsByTarget)
        for (const edge of syntheticEdges) {
            expect(edge.classes).toContain('synthetic-folder-edge')
            expect(edge.edgeCount).toBe(fixture.expectedCountsByTarget.get(edge.target))
        }

        if (process.env.CI !== 'true') {
            expect(elapsedMs).toBeLessThanOrEqual(PERF_BUDGET_MS)
        }
        expect(elapsedMs).toBeGreaterThanOrEqual(0)
        console.info(`BF-110 scale projection: ${elapsedMs.toFixed(2)}ms for ${fixture.fileNodeCount} file nodes, ${fixture.hiddenCrossFolderEdgeCount} hidden cross-folder edges`)
    })
})

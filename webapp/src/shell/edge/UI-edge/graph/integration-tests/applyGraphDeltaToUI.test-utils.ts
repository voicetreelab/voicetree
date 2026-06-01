import type { Core } from 'cytoscape'
import * as O from 'fp-ts/lib/Option.js'
import type { ProjectedGraph, ProjectedNode } from '@vt/graph-state/contract'
import { applyGraphDeltaToUI } from '@/shell/edge/UI-edge/graph/actions/applyGraphDeltaToUI'
import { projectDelta } from '@/shell/edge/UI-edge/graph/integration-tests/projectGraphDelta'
import type { GraphDelta, GraphNode, UpsertNodeDelta, DeleteNode } from '@vt/graph-model/graph'
import type { FolderTreeNode } from '@vt/graph-model'
import { syncFolderTreeFromMain } from '@/shell/edge/UI-edge/state/stores/FolderTreeStore'

export { O }

export function upsert(node: GraphNode): UpsertNodeDelta {
    return { type: 'UpsertNode', nodeToUpsert: node, previousNode: O.none }
}

export function del(nodeId: string): DeleteNode {
    return { type: 'DeleteNode', nodeId, deletedNode: O.none }
}

export function applyDeltaToUI(cy: Core, delta: GraphDelta): void {
    return applyGraphDeltaToUI(cy, projectDelta(delta))
}

export function applySpecToUI(cy: Core, spec: ProjectedGraph): void {
    return applyGraphDeltaToUI(cy, spec)
}

export function folderSpecNode(
    kind: 'folder' | 'folder-collapsed',
    overrides: Partial<ProjectedNode> = {},
): ProjectedNode {
    return {
        id: '/project/topic/',
        kind,
        label: 'Topic',
        relPath: 'topic/',
        basename: 'Topic',
        folderPath: '/project/',
        content: '# Topic\n\nbody',
        loadState: 'loaded',
        isWriteTarget: false,
        ...(kind === 'folder-collapsed' ? { childCount: 2 } : {}),
        ...overrides,
    }
}

export function specWithNodes(...nodes: ProjectedNode[]): ProjectedGraph {
    return {
        nodes,
        edges: [],
        rootPath: '/project',
        revision: 1,
        forests: [],
        arboricity: 0,
        recentNodeIds: [],
    }
}

export function syncFolderTree(rootPath: string = '/project'): void {
    const tree: FolderTreeNode = {
        name: 'project',
        absolutePath: rootPath,
        loadState: 'loaded',
        isWriteTarget: true,
        children: [
            {
                name: 'auth',
                absolutePath: `${rootPath}/auth`,
                loadState: 'loaded',
                isWriteTarget: true,
                children: [
                    {
                        name: 'login-flow.md',
                        absolutePath: `${rootPath}/auth/login-flow.md`,
                        isInGraph: true,
                    },
                    {
                        name: 'internal',
                        absolutePath: `${rootPath}/auth/internal`,
                        loadState: 'loaded',
                        isWriteTarget: true,
                        children: [
                            {
                                name: 'refresh-token.md',
                                absolutePath: `${rootPath}/auth/internal/refresh-token.md`,
                                isInGraph: true,
                            },
                        ],
                    },
                ],
            },
        ],
    }
    syncFolderTreeFromMain(tree)
}

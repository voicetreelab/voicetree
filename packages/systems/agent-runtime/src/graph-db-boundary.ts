import * as createContextNodeModule from '@vt/graph-db-server/context-nodes/createContextNode'
import * as createContextNodeFromSelectedNodesModule from '@vt/graph-db-server/context-nodes/createContextNodeFromSelectedNodes'
import * as getUnseenNodesAroundContextNodeModule from '@vt/graph-db-server/context-nodes/getUnseenNodesAroundContextNode'
import type { UnseenNode } from '@vt/graph-db-server/context-nodes/getUnseenNodesAroundContextNode'
import * as updateContextNodeContainedIdsModule from '@vt/graph-db-server/context-nodes/updateContextNodeContainedIds'
import * as graphDeltaPersistenceModule from '@vt/graph-db-server/graph/applyGraphDelta'
import * as graphStore from '@vt/graph-db-server/state/graph-store'
import type { Graph } from '@vt/graph-model/graph'
import * as watchFolderStore from '@vt/graph-db-server/state/watch-folder-store'
import * as vaultAllowlist from '@vt/graph-db-server/watch-folder/vault-allowlist'
import * as watchFolder from '@vt/graph-db-server/watch-folder/watchFolder'

export type { UnseenNode }

export const graphDbContextNodes = {
    createContextNode: (...args: Parameters<typeof createContextNodeModule.createContextNode>): ReturnType<typeof createContextNodeModule.createContextNode> =>
        createContextNodeModule.createContextNode(...args),
    createContextNodeFromSelectedNodes: (...args: Parameters<typeof createContextNodeFromSelectedNodesModule.createContextNodeFromSelectedNodes>): ReturnType<typeof createContextNodeFromSelectedNodesModule.createContextNodeFromSelectedNodes> =>
        createContextNodeFromSelectedNodesModule.createContextNodeFromSelectedNodes(...args),
    getUnseenNodesAroundContextNode: (...args: Parameters<typeof getUnseenNodesAroundContextNodeModule.getUnseenNodesAroundContextNode>): ReturnType<typeof getUnseenNodesAroundContextNodeModule.getUnseenNodesAroundContextNode> =>
        getUnseenNodesAroundContextNodeModule.getUnseenNodesAroundContextNode(...args),
    updateContextNodeContainedIds: (...args: Parameters<typeof updateContextNodeContainedIdsModule.updateContextNodeContainedIds>): ReturnType<typeof updateContextNodeContainedIdsModule.updateContextNodeContainedIds> =>
        updateContextNodeContainedIdsModule.updateContextNodeContainedIds(...args),
} as const

export const graphDbState = {
    getGraph: (): Graph => graphStore.getGraph(),
    setGraph: (graph: Graph): void => graphStore.setGraph(graph),
} as const

export const graphDbWatch = {
    getProjectRootWatchedDirectory: (...args: Parameters<typeof watchFolderStore.getProjectRootWatchedDirectory>): ReturnType<typeof watchFolderStore.getProjectRootWatchedDirectory> =>
        watchFolderStore.getProjectRootWatchedDirectory(...args),
    getVaultPaths: (...args: Parameters<typeof vaultAllowlist.getVaultPaths>): ReturnType<typeof vaultAllowlist.getVaultPaths> =>
        vaultAllowlist.getVaultPaths(...args),
    getWatchStatus: (...args: Parameters<typeof watchFolder.getWatchStatus>): ReturnType<typeof watchFolder.getWatchStatus> =>
        watchFolder.getWatchStatus(...args),
    getWritePath: (...args: Parameters<typeof vaultAllowlist.getWritePath>): ReturnType<typeof vaultAllowlist.getWritePath> =>
        vaultAllowlist.getWritePath(...args),
} as const

export const graphDbPersistence = {
    applyGraphDeltaToDBThroughMemAndUIAndEditors: (...args: Parameters<typeof graphDeltaPersistenceModule.applyGraphDeltaToDBThroughMemAndUIAndEditors>): ReturnType<typeof graphDeltaPersistenceModule.applyGraphDeltaToDBThroughMemAndUIAndEditors> =>
        graphDeltaPersistenceModule.applyGraphDeltaToDBThroughMemAndUIAndEditors(...args),
    refreshGraphChangeSideEffects: (...args: Parameters<typeof graphDeltaPersistenceModule.refreshGraphChangeSideEffects>): ReturnType<typeof graphDeltaPersistenceModule.refreshGraphChangeSideEffects> =>
        graphDeltaPersistenceModule.refreshGraphChangeSideEffects(...args),
} as const

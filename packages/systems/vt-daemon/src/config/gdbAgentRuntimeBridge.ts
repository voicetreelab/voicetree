// Pure builder that adapts a `GraphDbClient` (vt-graphd RPC client) into the
// `GraphStateBridge` shape consumed by the agent-runtime module
// (`getRuntimeGraph`, `runtimeCreateContextNode`, `applyRuntimeGraphDelta`, …).
//
// This is the agent-spawn-pipeline sibling of `gdbGraphBridge.ts` (which adapts
// the same client into the narrower `GraphBridge` shape used by the MCP tool
// catalog). The agent-runtime needs a superset of methods — context-node
// creation, write-folder, watch status — but the underlying RPC client carries
// them all, so this builder is a thin adaptation.
//
// `getGraph` rehydrates via `normalizeDaemonGraph` for the same reason the
// MCP bridge does: the daemon serializes `Graph` over JSON, collapsing the
// Graph-level Map indexes — replaying as a delta onto an empty graph rebuilds
// them through the canonical write path.

import * as O from 'fp-ts/lib/Option.js'
import type {GraphDbClient} from '@vt/graph-db-client'
import type {
    FilePath,
    Graph,
    GraphDelta,
    NodeIdAndFilePath,
} from '@vt/graph-model/graph'
import type {UnseenNode} from '@vt/graph-db-protocol'
import type {
    GraphStateBridge,
    WatchStatus,
} from '../agent-runtime/runtime/runtime-config.ts'
import {normalizeDaemonGraph} from './gdbGraphBridge.ts'

export function buildGdbAgentRuntimeGraphBridge(
    client: GraphDbClient,
    projectRoot: string,
): GraphStateBridge {
    return {
        getGraph: async (): Promise<Graph> => normalizeDaemonGraph(await client.getGraph()),
        getVaultPaths: async (): Promise<readonly FilePath[]> => {
            const vs = await client.getVault()
            const seen: Set<string> = new Set<string>()
            const out: string[] = []
            for (const p of [vs.writeFolder, ...vs.readPaths]) {
                if (p && !seen.has(p)) {
                    seen.add(p)
                    out.push(p)
                }
            }
            return out
        },
        getWriteFolder: async (): Promise<O.Option<FilePath>> =>
            O.fromNullable((await client.getVault()).writeFolder ?? null),
        getProjectRoot: async (): Promise<FilePath | null> => projectRoot,
        // vtd's vault IS the watched directory — vt-graphd watches it as a
        // sibling process. Reporting `isWatching: true` matches the daemon's
        // invariant that a vault is always watched when vtd is up.
        getWatchStatus: async (): Promise<WatchStatus> => ({
            isWatching: true,
            directory: projectRoot,
        }),
        applyGraphDelta: async (
            delta: GraphDelta,
            recordForUndo?: boolean,
        ): Promise<void> => {
            await client.applyGraphDelta(delta as unknown as unknown[], {
                recordForUndo: recordForUndo ?? true,
            })
        },
        createContextNode: async (
            parentNodeId: NodeIdAndFilePath,
            semanticNodeIds: readonly NodeIdAndFilePath[] = [],
        ): Promise<NodeIdAndFilePath> => {
            const result = await client.createContextNode(parentNodeId, [...semanticNodeIds])
            return result.nodeId as NodeIdAndFilePath
        },
        createContextNodeFromSelectedNodes: async (
            taskNodeId: NodeIdAndFilePath,
            selectedNodeIds: readonly NodeIdAndFilePath[],
        ): Promise<NodeIdAndFilePath> => {
            const result = await client.createContextNodeFromSelectedNodes(
                taskNodeId,
                selectedNodeIds,
            )
            return result.nodeId as NodeIdAndFilePath
        },
        getUnseenNodesAroundContextNode: (
            contextNodeId: NodeIdAndFilePath,
            searchFromNode?: NodeIdAndFilePath,
        ): Promise<readonly UnseenNode[]> =>
            client.getUnseenNodesAroundContextNode(contextNodeId, searchFromNode),
        updateContextNodeContainedIds: async (
            contextNodeId: NodeIdAndFilePath,
            newNodeIds: readonly string[],
        ): Promise<void> => {
            await client.updateContextNodeContainedIds(contextNodeId, newNodeIds)
        },
    }
}

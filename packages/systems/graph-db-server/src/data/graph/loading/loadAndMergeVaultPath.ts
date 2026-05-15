import * as E from "fp-ts/lib/Either.js";
import * as O from "fp-ts/lib/Option.js";
import { applyGraphDeltaToGraph } from '@vt/graph-model/graph';
import type { FilePath, Graph, GraphDelta, Position } from '@vt/graph-model/graph';
import { mergePositionsIntoGraph } from '@vt/graph-model/spatial';
import type { FileLimitExceededError } from "./fileLimitEnforce";
import {
    applyGraphDeltaToMemState,
    refreshGraphChangeSideEffects
} from "../mutations/applyGraphDelta";
import {
    loadVaultPathAdditively,
    resolveLinkedNodesInWatchedFolder,
} from "./loadGraphFromDisk";
import { notifyTextToTreeServerOfDirectory } from "./notifyTextToTreeServer";
import { setGraph, getGraph } from "@vt/graph-db-server/state/graph-store";
import { getProjectRootWatchedDirectory } from "@vt/graph-db-server/state/watch-folder-store";
import { createStarterNode } from "@vt/graph-db-server/watch-folder/create-starter-node";
import { traceGraphdSpan } from "@vt/graph-db-server/watch-folder/paths/traceGraphdSpan";

export interface LoadVaultPathOptions {
  isWritePath: boolean;
  createStarterIfEmpty?: boolean;
}

export type LoadVaultPathResult = {
    success: boolean;
    error?: string;
};

export async function loadAndMergeVaultPath(
    vaultPath: FilePath,
    options: LoadVaultPathOptions = { isWritePath: false },
    positions?: ReadonlyMap<string, Position>
): Promise<LoadVaultPathResult> {
    const existingGraph: Graph = getGraph();
    const watchedFolderPath: FilePath | null = getProjectRootWatchedDirectory();

    const loadResult: E.Either<FileLimitExceededError, { graph: Graph; delta: GraphDelta }> =
        await traceGraphdSpan('vault.load-and-merge.load-vault-path-additively', async (span) => {
            span.setAttribute('vaultPath', vaultPath);
            return await loadVaultPathAdditively(vaultPath, existingGraph);
        });

    if (E.isLeft(loadResult)) {
        return {
            success: false,
            error: `File limit exceeded: ${loadResult.left.fileCount} files (max: ${loadResult.left.maxFiles})`
        };
    }

    let currentGraph: Graph = loadResult.right.graph;
    let accumulatedDelta: GraphDelta = loadResult.right.delta;

    if (positions && positions.size > 0) {
        await traceGraphdSpan('vault.load-and-merge.merge-positions', async (span) => {
            span.setAttribute('positions.count', positions.size);
            currentGraph = mergePositionsIntoGraph(currentGraph, positions);
            accumulatedDelta = accumulatedDelta.map(d =>
                d.type === 'UpsertNode' && currentGraph.nodes[d.nodeToUpsert.absoluteFilePathIsID]
                    ? { ...d, nodeToUpsert: currentGraph.nodes[d.nodeToUpsert.absoluteFilePathIsID] }
                    : d
            );
        });
    }

    if (watchedFolderPath) {
        const resolutionDelta: GraphDelta = await traceGraphdSpan('vault.load-and-merge.resolve-linked-nodes', async (span) => {
            span.setAttribute('watchedFolderPath', watchedFolderPath);
            return await resolveLinkedNodesInWatchedFolder(currentGraph, watchedFolderPath);
        });
        if (resolutionDelta.length > 0) {
            currentGraph = applyGraphDeltaToGraph(currentGraph, resolutionDelta);
            accumulatedDelta = [...accumulatedDelta, ...resolutionDelta];
        }
    }

    if (options.isWritePath && (options.createStarterIfEmpty ?? true)) {
        await traceGraphdSpan('vault.load-and-merge.create-starter-node-if-empty', async (span) => {
            const nodesInPath: readonly string[] = Object.keys(currentGraph.nodes).filter(nodeId =>
                nodeId.startsWith(vaultPath + '/') || nodeId === vaultPath
            );
            span.setAttribute('nodesInPath.count', nodesInPath.length);
            if (nodesInPath.length === 0) {
                const starterGraph: Graph = await createStarterNode(vaultPath);
                currentGraph = { ...currentGraph, nodes: { ...currentGraph.nodes, ...starterGraph.nodes } };
                const starterNodeId: string = Object.keys(starterGraph.nodes)[0];
                if (starterNodeId) {
                    accumulatedDelta = [...accumulatedDelta, {
                        type: 'UpsertNode' as const,
                        nodeToUpsert: starterGraph.nodes[starterNodeId],
                        previousNode: O.none,
                    }];
                }
            }
        });
    }

    await traceGraphdSpan('vault.load-and-merge.commit-side-effects', async (span) => {
        span.setAttribute('delta.count', accumulatedDelta.length);
        setGraph(currentGraph);
        if (accumulatedDelta.length > 0) {
            refreshGraphChangeSideEffects();
        }
        if (options.isWritePath) {
            notifyTextToTreeServerOfDirectory(vaultPath);
        }
    });

    return { success: true };
}

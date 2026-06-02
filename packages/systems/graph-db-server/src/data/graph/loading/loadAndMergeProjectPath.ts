import * as E from "fp-ts/lib/Either.js";
import * as O from "fp-ts/lib/Option.js";
import { applyGraphDeltaToGraph } from '@vt/graph-model/graph';
import type { FilePath, Graph, GraphDelta, NodeLayout } from '@vt/graph-model/graph';
import type { Size } from '@vt/graph-model/graph';
import { mergeNodeLayoutIntoGraph } from '@vt/graph-model/spatial';
import type { FileLimitExceededError } from "./fileLimitEnforce";
import {
    applyGraphDeltaToMemState,
    refreshGraphChangeSideEffects
} from "../mutations/applyGraphDelta";
import {
    loadProjectPathAdditively,
    resolveAbsoluteLinkedNodes,
} from "./loadGraphFromDisk";
import { notifyTextToTreeServerOfDirectory } from "./notifyTextToTreeServer";
import { setGraph, getGraph, isFolderLayoutKey, mergeFolderLayout } from "@vt/graph-db-server/state/graph-store";
import { createStarterNode } from "@vt/graph-db-server/watch-folder/create-starter-node";
import { traceGraphdSpan } from "@vt/graph-db-server/watch-folder/paths/traceGraphdSpan";

/** Extract the folder-keyed size records (FolderId → Size) from a loaded sidecar map. */
function folderSizesFromNodeLayout(nodeLayout: ReadonlyMap<string, NodeLayout>): Map<string, Size> {
    const sizes = new Map<string, Size>();
    for (const [id, layout] of nodeLayout) {
        if (isFolderLayoutKey(id) && layout.size !== undefined) {
            sizes.set(id, layout.size);
        }
    }
    return sizes;
}

export interface LoadProjectPathOptions {
  isWriteFolderPath: boolean;
  createStarterIfEmpty?: boolean;
}

export type FileLimitDetails = {
    readonly fileCount: number;
    readonly maxFiles: number;
};

export type ProjectLoadOutcome =
    | { readonly kind: 'ok' }
    | { readonly kind: 'fileLimit'; readonly details: FileLimitDetails }
    | { readonly kind: 'failed'; readonly reason: string };

export function describeProjectLoadFailure(
    outcome: Exclude<ProjectLoadOutcome, { kind: 'ok' }>,
): string {
    switch (outcome.kind) {
        case 'fileLimit':
            return `File limit exceeded: ${outcome.details.fileCount} files (max: ${outcome.details.maxFiles})`;
        case 'failed':
            return outcome.reason;
    }
}

export async function loadAndMergeProjectPath(
    projectRoot: FilePath,
    options: LoadProjectPathOptions = { isWriteFolderPath: false },
    nodeLayout?: ReadonlyMap<string, NodeLayout>
): Promise<ProjectLoadOutcome> {
    const existingGraph: Graph = getGraph();

    const loadResult: E.Either<FileLimitExceededError, { graph: Graph; delta: GraphDelta }> =
        await traceGraphdSpan('project.load-and-merge.load-project-path-additively', async (span) => {
            span.setAttribute('projectRoot', projectRoot);
            return await loadProjectPathAdditively(projectRoot, existingGraph);
        });

    if (E.isLeft(loadResult)) {
        return {
            kind: 'fileLimit',
            details: {
                fileCount: loadResult.left.fileCount,
                maxFiles: loadResult.left.maxFiles,
            },
        };
    }

    let currentGraph: Graph = loadResult.right.graph;
    let accumulatedDelta: GraphDelta = loadResult.right.delta;

    if (nodeLayout && nodeLayout.size > 0) {
        await traceGraphdSpan('project.load-and-merge.merge-node-layout', async (span) => {
            span.setAttribute('nodeLayout.count', nodeLayout.size);
            // Folder-keyed records have no graph node — they seed the folder
            // layout store. Node-keyed records merge onto graph nodes (folder
            // keys are ignored by mergeNodeLayoutIntoGraph as they match none).
            mergeFolderLayout(folderSizesFromNodeLayout(nodeLayout));
            currentGraph = mergeNodeLayoutIntoGraph(currentGraph, nodeLayout);
            accumulatedDelta = accumulatedDelta.map(d =>
                d.type === 'UpsertNode' && currentGraph.nodes[d.nodeToUpsert.absoluteFilePathIsID]
                    ? { ...d, nodeToUpsert: currentGraph.nodes[d.nodeToUpsert.absoluteFilePathIsID] }
                    : d
            );
        });
    }

    // Follow the absolute links of the just-loaded folder nodes (delta-scoped).
    // Relative links are healed against loaded nodes by the graph-model indexes
    // during loadProjectPathAdditively; only absolute targets need disk loading.
    {
        const resolutionDelta: GraphDelta = await traceGraphdSpan('project.load-and-merge.resolve-linked-nodes', async (span) => {
            span.setAttribute('delta.count', accumulatedDelta.length);
            return await resolveAbsoluteLinkedNodes(currentGraph, accumulatedDelta);
        });
        if (resolutionDelta.length > 0) {
            currentGraph = applyGraphDeltaToGraph(currentGraph, resolutionDelta);
            accumulatedDelta = [...accumulatedDelta, ...resolutionDelta];
        }
    }

    if (options.isWriteFolderPath && (options.createStarterIfEmpty ?? true)) {
        await traceGraphdSpan('project.load-and-merge.create-starter-node-if-empty', async (span) => {
            const nodesInPath: readonly string[] = Object.keys(currentGraph.nodes).filter(nodeId =>
                nodeId.startsWith(projectRoot + '/') || nodeId === projectRoot
            );
            span.setAttribute('nodesInPath.count', nodesInPath.length);
            if (nodesInPath.length === 0) {
                const starterGraph: Graph = await createStarterNode(projectRoot);
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

    await traceGraphdSpan('project.load-and-merge.commit-side-effects', async (span) => {
        span.setAttribute('delta.count', accumulatedDelta.length);
        setGraph(currentGraph);
        if (accumulatedDelta.length > 0) {
            refreshGraphChangeSideEffects();
        }
        if (options.isWriteFolderPath) {
            notifyTextToTreeServerOfDirectory(projectRoot);
        }
    });

    return { kind: 'ok' };
}

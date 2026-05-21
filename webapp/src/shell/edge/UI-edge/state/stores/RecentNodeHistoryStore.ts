/**
 * RecentNodeHistoryStore - Edge state for recent node history
 * Follows the same pattern as EditorStore.ts
 */
import {
    addEntriesToHistory,
    createEmptyHistory,
    type GraphNode,
    type UpsertNodeDelta,
    type RecentNodeHistory
} from '@vt/graph-model/graph';
import type {ProjectedGraph, ProjectedNode} from '@vt/graph-state/contract';
import * as O from 'fp-ts/lib/Option.js';

let recentNodeHistory: RecentNodeHistory = createEmptyHistory();

// Subscription callbacks for recent node history changes
type RecentNodeHistoryCallback = (history: RecentNodeHistory) => void;
const subscribers: Set<RecentNodeHistoryCallback> = new Set();

function notifySubscribers(): void {
    for (const callback of subscribers) {
        callback(recentNodeHistory);
    }
}

/**
 * Subscribe to recent node history changes.
 * @returns unsubscribe function
 */
export function subscribeToRecentNodeHistoryChange(callback: (history: RecentNodeHistory) => void): () => void {
    subscribers.add(callback);
    return () => {
        subscribers.delete(callback);
    };
}

export function getRecentNodeHistory(): RecentNodeHistory {
    return recentNodeHistory;
}

function projectedNodeToRecentEntry(node: ProjectedNode): UpsertNodeDelta {
    const graphNode: GraphNode = {
        kind: node.kind === 'file' ? 'leaf' : 'folder',
        outgoingEdges: [],
        absoluteFilePathIsID: node.id,
        contentWithoutYamlOrLinks: node.content,
        nodeUIMetadata: {
            color: node.color ? O.some(node.color) : O.none,
            position: node.position ? O.some(node.position) : O.none,
            additionalYAMLProps: Object.fromEntries(node.additionalYAMLProps ?? []),
            isContextNode: node.isContextNode,
        },
    };

    return {
        type: 'UpsertNode',
        nodeToUpsert: graphNode,
        previousNode: O.none,
    };
}

export function updateRecentNodeHistoryFromProjectedGraph(graph: ProjectedGraph): RecentNodeHistory {
    const nodeById: ReadonlyMap<string, ProjectedNode> = new Map(
        graph.nodes.map((node: ProjectedNode) => [node.id, node])
    );
    const entries: readonly UpsertNodeDelta[] = graph.recentNodeIds
        .map((nodeId: string) => nodeById.get(nodeId))
        .filter((node): node is ProjectedNode => node?.kind === 'file' && !node.isContextNode)
        .map(projectedNodeToRecentEntry);

    recentNodeHistory = addEntriesToHistory(recentNodeHistory, entries);
    notifySubscribers();
    return recentNodeHistory;
}

export function clearRecentNodeHistory(): RecentNodeHistory {
    recentNodeHistory = createEmptyHistory();
    notifySubscribers();
    return recentNodeHistory;
}

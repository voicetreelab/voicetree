import type {Graph, GraphNode, Size} from '@vt/graph-model/graph';
import { createEmptyGraph } from '@vt/graph-model/graph';

// The ONLY mutable cell for graph-scoped spatial state in the functional
// architecture. It holds BOTH the graph (whose nodes carry position/size) and
// the expanded-folder sizes keyed by FolderId — a folder compound is not a
// graph node, but its size is the same spatial-layout concern, loaded/saved
// with the graph as one unit, so it shares this single cell rather than a
// second module-level singleton.
interface GraphState {
    graph: Graph;
    folderSizes: Map<string, Size>;
}

let state: GraphState = { graph: createEmptyGraph(), folderSizes: new Map() };

// Getter/setter for controlled access to graph state
export const getGraph: () => Graph = (): Graph => {
    return state.graph;
};

// Sets the graph, preserving folder sizes (they are not part of the graph value).
export const setGraph: (graph: Graph) => void = (graph: Graph): void => {
    state.graph = graph;
};

export const getNode: (nodeId: string) => GraphNode | undefined = (nodeId: string): GraphNode | undefined => {
    return state.graph.nodes[nodeId];
};

/**
 * A node-layout sidecar key belongs to a folder iff it is a FolderId — a
 * directory id with a trailing slash. File-node ids are absolute file paths and
 * never end in `/`, so this cleanly separates folder-size records (which have no
 * graph node) from node-layout records (which merge onto graph nodes).
 */
export function isFolderLayoutKey(id: string): boolean {
    return id.endsWith('/');
}

export function getFolderLayout(): ReadonlyMap<string, Size> {
    return state.folderSizes;
}

/** Merge entries last-wins (additive load + incremental resize writes). */
export function mergeFolderLayout(entries: ReadonlyMap<string, Size>): void {
    for (const [folderId, size] of entries) {
        state.folderSizes.set(folderId, size);
    }
}

export function clearFolderLayout(): void {
    state.folderSizes = new Map();
}

import type {FilePath, Graph, GraphDelta} from "@/functional_graph/pure/types.ts";
import * as O from "fp-ts/lib/Option.js";
import {loadGraphFromDisk} from "@/functional_graph/shell/main/load-graph-from-disk.ts";

// The ONLY mutable state in the functional architecture
// Initialized to empty/none - will be populated when file watching starts
// eslint-disable-next-line functional/no-let
let currentVaultPath: O.Option<FilePath> = O.none;

// eslint-disable-next-line functional/no-let
let currentGraph: Graph = { nodes: {} };

// Getter/setter for controlled access to graph state
export const getGraph = (): Graph => {
    return currentGraph;
};

export const setGraph = (graph: Graph): void => {
    currentGraph = graph;
};

// Getter/setter for controlled access to vault path
export const getVaultPath = (): O.Option<FilePath> => {
    return currentVaultPath;
};

export const setVaultPath = (path: FilePath): void => {
    currentVaultPath = O.some(path);
};


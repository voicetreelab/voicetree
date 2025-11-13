import type {FilePath, Graph} from "@/functional/pure/graph/types.ts";
import * as O from "fp-ts/lib/Option.js";

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

// Getter/setter for controlled access to vault absolutePath
export const getVaultPath = (): O.Option<FilePath> => {
    return currentVaultPath;
};

export const setVaultPath = (path: FilePath): void => {
    currentVaultPath = O.some(path);
};

export const clearVaultPath = (): void => {
    currentVaultPath = O.none;
};


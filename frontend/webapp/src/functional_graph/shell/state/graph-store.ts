import type {FilePath, Graph} from "@/functional_graph/pure/types.ts";
import {loadGraphFromDisk} from "@/functional_graph/shell/main/load-graph-from-disk.ts";
import FileWatchHandler from "@/functional_graph/shell/main/file-watch-handler.ts";
import * as O from "fp-ts/Option";


const fileWatchManager = new FileWatchHandler(); // todo needs to be a module not a class


// The ONLY mutable state in the functional architecture
// eslint-disable-next-line functional/no-let
let currentVaultPath: O.Option<FilePath> = await fileWatchManager.loadLastDirectory();

// eslint-disable-next-line functional/no-let
let currentGraph: Graph = await loadGraphFromDisk(currentVaultPath)


// Getter/setter for controlled access to graph state
export const getGraph = (): Graph => {
    if (!currentGraph) {
        throw new Error('Graph not initialized');
    }
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
    currentVaultPath = O.fromNullable(path);
};

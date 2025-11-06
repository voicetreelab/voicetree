// THIS FUNCTION takes path
// returns graph
// has side effects of sending to UI
// setting up file watchers
// closing old watchers

import {loadGraphFromDisk} from "@/functional_graph/shell/main/load-graph-from-disk.ts";
import type {FilePath, GraphDelta} from "@/functional_graph/pure/types.ts";
import {setGraph} from "@/functional_graph/shell/state/graph-store.ts";
import {app} from "electron";
import path from "path";
import * as O from "fp-ts/Option";
import {promises as fs} from "fs";
import chokidar, {FSWatcher} from "chokidar/esm";

// eslint-disable-next-line functional/no-let
let watcher: FSWatcher | null = null;

export async function initialLoad()  {
    const lastDirectory = await loadLastDirectory();
    if (O.isSome(lastDirectory)) {
        await loadFolder(O.toNullable(lastDirectory))
    }
}

function getConfigPath(): string {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'voicetree-config.json');
}

// Load last watched directory from config
 async function loadLastDirectory(): Promise<O.Option<FilePath>> {
    try {
        const configPath = getConfigPath();
        const data = await fs.readFile(configPath, 'utf8');
        const config = JSON.parse(data);
        return O.fromNullable(config.lastDirectory);
    } catch (error) {
        console.error("loadLastdirectory", error);
        // Config file doesn't exist yet (first run) - return None
        return O.none;
    }
}

export async function loadFolder(vaultPath : Path)  {
    currentGraph : Graph = await loadGraphFromDisk(vaultPath);

    // mapGraphtoDelta is a pure function
    // it's because a whole graph at once, can be consisdered also as the graph delta
    // for an initial load, the delta IS the WHOLE graph, everything must be added.
    const graphDelta : GraphDelta = mapGraphToDelta(currentGraph);

    //apply graph Delta to UI
    applyGraphDeltaToUI(graphDelta)

    setGraph(currentGraph);

    //todo
    // watcher = chokidar.watch(directoryPath, {watchConfig}
}

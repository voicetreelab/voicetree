import type {GraphDelta} from "@/functional/pure/graph/types.ts";
import type {BrowserWindow} from "electron";
import {getGraph, setGraph} from "@/functional/shell/main/state/graph-store.ts";
import {applyGraphDeltaToGraph} from "@/functional/pure/graph/graphDelta/applyGraphDeltaToGraph.ts";

export function applyGraphDeltaToMemStateAndUI(delta : GraphDelta, mainWindow: BrowserWindow) : void {
    const currentGraph = getGraph();
    const newGraph = applyGraphDeltaToGraph(currentGraph, delta);

    setGraph(newGraph);

    if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('graph:stateChanged', delta);
    }
}

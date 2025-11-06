import type {GraphDelta} from "@/functional_graph/pure/types.ts";
import type {BrowserWindow} from "electron";
import {getGraph, setGraph} from "@/functional_graph/shell/state/graph-store.ts";
import {applyGraphDeltaToGraph} from "@/functional_graph/pure/graphDelta/applyGraphDeltaToGraph.ts";

export function applyGraphDeltaToStateAndUI(delta : GraphDelta, mainWindow: BrowserWindow) : void {
    const currentGraph = getGraph();
    const newGraph = applyGraphDeltaToGraph(currentGraph, delta);

    setGraph(newGraph);

    if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('graph:stateChanged', delta);
    }
}

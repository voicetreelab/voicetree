import type {GraphDelta} from "@/pure/graph";
import type {BrowserWindow} from "electron";
import {getGraph, setGraph} from "@/shell/edge/main/state/graph-store.ts";
import {applyGraphDeltaToGraph} from "@/pure/graph";

export function applyGraphDeltaToMemStateAndUI(delta : GraphDelta, mainWindow: BrowserWindow) : void {
    const currentGraph = getGraph();
    const newGraph = applyGraphDeltaToGraph(currentGraph, delta);

    setGraph(newGraph);

    if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('graph:stateChanged', delta);
    }
}

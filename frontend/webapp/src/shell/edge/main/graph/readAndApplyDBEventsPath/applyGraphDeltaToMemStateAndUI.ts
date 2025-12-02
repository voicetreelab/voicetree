import type {GraphDelta, Graph} from "@/pure/graph";
import type {BrowserWindow} from "electron";
import {getGraph, setGraph} from "@/shell/edge/main/state/graph-store";
import {applyGraphDeltaToGraph} from "@/pure/graph";

export function applyGraphDeltaToMemStateAndUI(delta : GraphDelta, mainWindow: BrowserWindow) : void {
    const currentGraph: Graph = getGraph();
    const newGraph: Graph = applyGraphDeltaToGraph(currentGraph, delta);

    setGraph(newGraph);

    if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('graph:stateChanged', delta);
    }
}

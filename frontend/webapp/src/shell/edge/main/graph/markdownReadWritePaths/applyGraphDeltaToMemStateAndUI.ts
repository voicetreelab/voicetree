import type {GraphDelta, Graph} from "@/pure/graph";
import {getGraph, setGraph} from "@/shell/edge/main/state/graph-store";
import {applyGraphDeltaToGraph} from "@/pure/graph";
import {getMainWindow} from "@/shell/edge/main/state/app-electron-state";

export function applyGraphDeltaToMemStateAndUI(delta : GraphDelta) : void {
    const currentGraph: Graph = getGraph();
    const newGraph: Graph = applyGraphDeltaToGraph(currentGraph, delta);

    setGraph(newGraph);

    const mainWindow: Electron.CrossProcessExports.BrowserWindow | null = getMainWindow();
    if (!mainWindow) return;
    if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('graph:stateChanged', delta); //todo, this has some weirdness, it's not just applyToUI
    }
}

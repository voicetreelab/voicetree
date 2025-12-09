import type {GraphDelta, Graph} from "@/pure/graph";
import {getGraph, setGraph} from "@/shell/edge/main/state/graph-store";
import {applyGraphDeltaToGraph} from "@/pure/graph";
import {getMainWindow} from "@/shell/edge/main/state/app-electron-state";

export function applyGraphDeltaToMemStateAndUI(delta: GraphDelta, deltaSourceFromEditor: boolean = false): void {
    const currentGraph: Graph = getGraph();
    const newGraph: Graph = applyGraphDeltaToGraph(currentGraph, delta);

    setGraph(newGraph);

    // Skip broadcasting to UI when delta came from editor - prevents feedback loop
    // Editor already has the content, broadcasting would cause cursor jump bugs
    if (deltaSourceFromEditor) {
        return;
    }

    const mainWindow: Electron.CrossProcessExports.BrowserWindow | null = getMainWindow();
    if (!mainWindow) return;
    if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('graph:stateChanged', delta);
    }
}

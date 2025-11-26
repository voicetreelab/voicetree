import type {GraphDelta} from "@/pure/graph";
import type {BrowserWindow} from "electron";
import {getGraph, setGraph} from "@/shell/edge/main/state/graph-store";
import {applyGraphDeltaToGraph} from "@/pure/graph";

export function applyGraphDeltaToMemStateAndUI(delta : GraphDelta, mainWindow: BrowserWindow) : void {
    const currentGraph: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").Graph = getGraph();
    const newGraph: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").Graph = applyGraphDeltaToGraph(currentGraph, delta);

    setGraph(newGraph);

    if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('graph:stateChanged', delta);
    }
}

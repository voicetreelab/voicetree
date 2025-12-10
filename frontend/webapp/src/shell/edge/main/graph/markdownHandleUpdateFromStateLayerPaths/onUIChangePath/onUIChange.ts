import type {GraphDelta} from "@/pure/graph";
import {uiAPI} from "@/shell/edge/main/ui-api-proxy";
import {
    applyGraphDeltaToDBThroughMemAndUI
} from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/applyGraphDeltaToDBThroughMemAndUI";

export async function applyGraphDeltaToDBThroughMemAndUIAndEditors(
    delta: GraphDelta,
    recordForUndo: boolean = true
): Promise<void> {
    await applyGraphDeltaToDBThroughMemAndUI(delta, recordForUndo)
    uiAPI.updateFloatingEditorsFromExternal(delta)
}
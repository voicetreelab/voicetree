import * as E from 'fp-ts/lib/Either.js'
import * as O from 'fp-ts/lib/Option.js'
import {pipe} from 'fp-ts/lib/function.js'
import {applyGraphDeltaToGraph, type Env, type Graph, type GraphDelta, type NodeDelta} from '@/pure/graph'
import {apply_graph_deltas_to_db} from '@/shell/edge/main/graph/graphActionsToDBEffects'
import {getWatchedDirectory} from '@/shell/edge/main/graph/watchFolder'
import {recordUserActionAndSetDeltaHistoryState} from '@/shell/edge/main/state/undo-store'
import type {Either} from "fp-ts/es6/Either";
import {getGraph, setGraph} from "@/shell/edge/main/state/graph-store";
import {getMainWindow} from "@/shell/edge/main/state/app-electron-state";
import {deleteNodeMaintainingTransitiveEdges} from '@/pure/graph/graph-operations/removeNodeMaintainingTransitiveEdges';


export function applyGraphDeltaToMemState(delta: GraphDelta): void {
    const currentGraph: Graph = getGraph();
    const newGraph: Graph = applyGraphDeltaToGraph(currentGraph, delta);
    setGraph(newGraph);
}

export function broadcastGraphDeltaToUI(delta: GraphDelta): void {
    const mainWindow: Electron.CrossProcessExports.BrowserWindow | null = getMainWindow();
    if (!mainWindow) return;
    if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('graph:stateChanged', delta);
    }
}



export async function applyGraphDeltaToDBThroughMemAndUI(
    delta: GraphDelta,
    recordForUndo: boolean = true
): Promise<void> {
    // Expand DeleteNode deltas to include transitive edge updates
    const currentGraph: Graph = getGraph()
    const expandedDelta: GraphDelta = delta.flatMap((d: NodeDelta) =>
        d.type === 'DeleteNode'
            ? deleteNodeMaintainingTransitiveEdges(currentGraph, d.nodeId)
            : [d]
    )

    // Record for undo BEFORE applying (so we can reverse from current state)
    if (recordForUndo) {
        recordUserActionAndSetDeltaHistoryState(expandedDelta)
    }

    applyGraphDeltaToMemState(expandedDelta)

    broadcastGraphDeltaToUI(expandedDelta)

    // Extract watched directory (fail fast at edge)
    const watchedDirectory: string = pipe(
        O.fromNullable(getWatchedDirectory()),
        O.getOrElseW(() => {
            throw new Error('Watched directory not initialized')
        })
    )

    // Construct env and execute effect
    const env: Env = {watchedDirectory}
    const result: Either<Error, GraphDelta> = await apply_graph_deltas_to_db(expandedDelta)(env)()

    // Handle errors (fail fast)
    if (E.isLeft(result)) {
        throw result.left
    }
}
import type {FSEvent, GraphDelta, Graph} from "@/pure/graph";
import {mapFSEventsToGraphDelta} from "@/pure/graph";
import type {BrowserWindow} from "electron";
import {applyGraphDeltaToMemStateAndUI} from "@/shell/edge/main/graph/markdownReadWritePaths/applyGraphDeltaToMemStateAndUI";
import {getGraph} from "@/shell/edge/main/state/graph-store";
import {hashGraphDelta, compareDeltasForDebugging} from "@/pure/graph/deltaHashing";
import {acknowledgeIfPresent, getUnacknowledgedDeltas} from "@/shell/edge/main/state/unacknowledged-deltas-store";

/**
 * Handle filesystem events by:
 * 1. Computing the GraphDelta from the filesystem event
 * 2. Applying delta to graph state
 * 3. Broadcasting delta to UI-edge
 *
 * This is the central handler that connects:
 * - Pure layer: mapFSEventsToGraphDelta
 * - State + UI-edge layer: applyGraphDeltaToMemStateAndUI
 *
 * @param fsEvent - Filesystem event (add, change, or delete)
 * @param vaultPath - Absolute path to vault
 * @param mainWindow - Electron window to send updates to
 */
export function handleFSEventWithStateAndUISides(
    fsEvent: FSEvent,
    vaultPath: string,
    mainWindow: BrowserWindow
): void {
    // 1. Get current graph state to resolve wikilinks
    const currentGraph: Graph = getGraph();

    // 2. Map filesystem event to graph delta (pure)
    const delta: GraphDelta = mapFSEventsToGraphDelta(fsEvent, vaultPath, currentGraph);

    // 3. Skip if this delta was already applied by write path (acknowledge and return)
    const deltaHash = hashGraphDelta(delta)
    if (acknowledgeIfPresent(deltaHash)) {
        console.log("[handleFSEvent] Acknowledged own delta, skipping")
        return;
    }

    // Debug: If not acknowledged but we have pending deltas, log comparison
    const pendingDeltas = getUnacknowledgedDeltas()
    if (pendingDeltas.length > 0) {
        console.log(`[handleFSEvent] Delta NOT acknowledged. Hash: ${deltaHash}`)
        console.log(`[handleFSEvent] ${pendingDeltas.length} pending delta(s):`)
        for (const [pendingHash, pendingDelta] of pendingDeltas) {
            console.log(`  - Pending hash: ${pendingHash}`)
            const comparison = compareDeltasForDebugging(pendingDelta, delta)
            if (!comparison.matching) {
                console.log(`  - Differences:`, comparison.differences)
            }
        }
    }

    applyGraphDeltaToMemStateAndUI(delta);
}

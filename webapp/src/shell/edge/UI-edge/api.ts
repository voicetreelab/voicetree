/**
 * UI API - Functions callable from main process via IPC
 *
 * This mirrors the mainAPI pattern: main process can call these functions
 * using the uiAPI proxy, which sends IPC messages that are handled here.
 *
 * Pattern:
 * - Main: uiAPI.launchTerminalOntoUI(nodeId, data)  // typed proxy
 * - IPC: 'ui:call' with funcName and args
 * - Renderer: uiAPI[funcName](...args)  // actual implementation
 */

import {launchTerminalOntoUI} from "@/shell/edge/UI-edge/floating-windows/terminals/launchTerminalOntoUI";
import {
    createAnchoredFloatingEditor,
    updateFloatingEditors
} from "@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD";
import {getCyInstance} from "@/shell/edge/UI-edge/state/cytoscape-state";
import {getResponsivePadding} from "@/utils/responsivePadding";
import type {GraphDelta, NodeIdAndFilePath} from "@/pure/graph";
import {isImageNode} from "@/pure/graph";
import type {Core} from "cytoscape";
import type {TerminalRecord} from "@/shell/edge/main/terminals/terminal-registry";
import {syncFromMain} from "@/shell/edge/UI-edge/state/TerminalStore";
import {syncVaultStateFromMain} from "@/shell/edge/UI-edge/state/VaultPathStore";
import type {VaultPathState} from "@/shell/edge/UI-edge/state/VaultPathStore";

import {setIsTrackpadScrolling} from "@/shell/edge/UI-edge/state/trackpad-state";
import {closeTerminalById} from "@/shell/edge/UI-edge/floating-windows/terminals/closeTerminalById";
import {getInjectBarHandle} from "@/shell/UI/floating-windows/terminals/InjectBar";
import type {TerminalId} from "@/shell/edge/UI-edge/floating-windows/types";

/**
 * Update floating editors from external FS changes
 * Called from main process read path when external edits are detected
 */
function updateFloatingEditorsFromExternal(delta: GraphDelta): void {
    const cy: Core = getCyInstance();
    updateFloatingEditors(cy, delta);
}

/**
 * Create an editor for a node created by an external FS change.
 * This is the auto-pin path for truly external file additions.
 * Called from main process FS watcher when it detects a new file was added externally.
 *
 * @param nodeId - ID of the node to create editor for
 * @param isAgentNode - If true, node was created by an agent (has agent_name in YAML)
 *                      Agent nodes are auto-pinned with no limit.
 */
function createEditorForExternalNode(nodeId: NodeIdAndFilePath, isAgentNode: boolean = false): void {
    // Don't auto-open floating editor for image nodes
    if (isImageNode(nodeId)) {
        return;
    }
    const cy: Core = getCyInstance();
    void createAnchoredFloatingEditor(cy, nodeId, false, true, isAgentNode);
}

/**
 * Fit viewport to remaining nodes after vault removal.
 * Called from main process when a vault path is removed from the allowlist.
 */
function fitViewport(): void {
    const cy: Core = getCyInstance();
    if (cy.nodes().length > 0) {
        cy.fit(undefined, getResponsivePadding(cy, 10));
    }
}

/**
 * Sync terminal state from main process to renderer.
 * Called from main process after any terminal registry mutation.
 * Phase 3: Main process is source of truth, renderer is display-only cache.
 */
function syncTerminals(records: TerminalRecord[]): void {
    syncFromMain(records);
}

/**
 * Sync vault path state from main process to renderer.
 * Called from main process after any vault path or starred folder mutation.
 */
function syncVaultState(state: VaultPathState): void {
    syncVaultStateFromMain(state);
}

/**
 * Update InjectBar badge count for a terminal.
 * Called from main process after graph deltas change the unseen node count.
 * Renderer uses this to update the badge without polling.
 */
function updateInjectBadge(terminalId: string, count: number): void {
    const handle: ReturnType<typeof getInjectBarHandle> = getInjectBarHandle(terminalId as TerminalId);
    if (handle) {
        handle.updateBadgeCount(count);
    }
}

/**
 * Log a hook execution result to the renderer dev console.
 * Called from main process after onNewNode (or other) hooks run.
 */
function logHookResult(message: string): void {
    console.log(message);
}

// Settings change subscriber registry
type SettingsChangeCallback = () => void;
const settingsChangeListeners: Set<SettingsChangeCallback> = new Set();

export function onSettingsChange(cb: SettingsChangeCallback): () => void {
    settingsChangeListeners.add(cb);
    return () => { settingsChangeListeners.delete(cb); };
}

// Export as object (like mainAPI)
// eslint-disable-next-line @typescript-eslint/typedef
export const uiAPIHandler = {
    launchTerminalOntoUI,
    updateFloatingEditorsFromExternal,
    createEditorForExternalNode,
    fitViewport,
    syncTerminals,
    syncVaultState,
    setIsTrackpadScrolling,
    closeTerminalById,
    updateInjectBadge,
    logHookResult,
    onSettingsChanged: (): void => {
        for (const cb of settingsChangeListeners) cb();
    },
};

export type UIAPIType = typeof uiAPIHandler;

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
import {applyLiveCommandToRenderer} from "@/shell/edge/UI-edge/graph/actions/applyLiveCommandToRenderer";
import {
    updateFloatingEditors
} from "@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD";
import {createAnchoredFloatingEditor} from "@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD";
import {getCyInstance} from "@/shell/edge/UI-edge/state/controllers/cytoscape-state";
import {cyFitIntoVisibleViewport, getResponsivePadding} from "@/utils/responsivePadding";
import type {GraphDelta, NodeIdAndFilePath} from "@vt/graph-model/graph";
import {isImageNode} from "@vt/graph-model/graph";
import type {Core} from "cytoscape";
import type {RecoverableAgentSession, TerminalRecord, UnclaimedTmuxSession} from '@vt/vt-daemon-client';
import {syncFromMain} from "@/shell/edge/UI-edge/state/stores/TerminalStore";
import {syncUnclaimedTmuxFromMain} from "@/shell/edge/UI-edge/state/stores/recovery/UnclaimedTmuxStore";
import {syncRecoverySessionsFromMain} from "@/shell/edge/UI-edge/state/stores/recovery/RecoverySessionsStore";
import {updateHeadlessBadges} from "@/shell/edge/UI-edge/floating-windows/anchoring/headless-badge-overlay";
import {syncProjectStateFromMain} from "@/shell/edge/UI-edge/state/stores/ProjectPathStore";
import type {ProjectPathState} from "@/shell/edge/UI-edge/state/stores/ProjectPathStore";
import {syncFolderTreeFromMain, syncStarredTreesFromMain, syncExternalTreesFromMain} from "@/shell/edge/UI-edge/state/stores/FolderTreeStore";
import type {FolderTreeNode} from "@vt/graph-model/folders";

import {setIsTrackpadScrolling} from "@/shell/edge/UI-edge/state/controllers/trackpad-state";
import {closeTerminalById} from "@/shell/edge/UI-edge/floating-windows/terminals/closeTerminalById";
import {getInjectBarHandle} from "@/shell/UI/floating-windows/terminals/InjectBar";
import type {TerminalId} from "@/shell/edge/UI-edge/floating-windows/anchoring/types";
import { deriveImplicitRoots } from '@vt/graph-state/state/folderVisibility/implicitRoots';
import { getFolderVisibility } from '@vt/graph-state/state/folderVisibilityStore';

function hasVisibleRoots(): boolean {
    try {
        return deriveImplicitRoots(getFolderVisibility('main')).size > 0;
    } catch {
        return false;
    }
}

/**
 * Update floating editors from external FS changes
 * Called from main process read path when external edits are detected
 */
function updateFloatingEditorsFromExternal(
    delta: GraphDelta,
    suppressForSubscribers: readonly string[] = [],
): void {
    const cy: Core = getCyInstance();
    updateFloatingEditors(cy, delta, suppressForSubscribers);
}

/**
 * Update floating editors from daemon SSE deltas.
 * Echo filtering already happened at the SSE layer, so these are external
 * changes unless explicitly suppressed for the originating editor.
 */
function updateFloatingEditorsFromDaemon(
    delta: GraphDelta,
    suppressForSubscribers: readonly string[] = [],
): void {
    const cy: Core = getCyInstance();
    updateFloatingEditors(cy, delta, suppressForSubscribers);
}

/**
 * Create an editor for a node created by an external FS change.
 * This is the auto-pin path for truly external file additions.
 * Called from main process FS watcher when it detects a new file was added externally.
 *
 * @param nodeId - ID of the node to create editor for
 * @param _isAgentNode - Unused (kept for IPC contract compatibility)
 */
function createEditorForExternalNode(nodeId: NodeIdAndFilePath, _isAgentNode: boolean = false): void {
    // Don't auto-open floating editor for image nodes
    if (isImageNode(nodeId)) {
        return;
    }
    const cy: Core = getCyInstance();
    void createAnchoredFloatingEditor(cy, nodeId, false);
}

/**
 * Fit viewport to remaining nodes after project removal.
 * Called from main process when a project path is removed from the allowlist.
 */
function fitViewport(): void {
    if (hasVisibleRoots()) {
        const cy: Core = getCyInstance();
        cyFitIntoVisibleViewport(cy, undefined, getResponsivePadding(cy, 10));
    }
}

/**
 * Sync terminal state from main process to renderer.
 * Called from main process after any terminal registry mutation.
 * Phase 3: Main process is source of truth, renderer is display-only cache.
 */
function syncTerminals(records: TerminalRecord[]): void {
    syncFromMain(records);
    // Update headless agent badge overlays on task nodes
    updateHeadlessBadges();
}

function syncUnclaimedTmuxSessions(sessions: readonly UnclaimedTmuxSession[]): void {
    syncUnclaimedTmuxFromMain(sessions);
}

function syncRecoverySessions(sessions: readonly RecoverableAgentSession[]): void {
    syncRecoverySessionsFromMain(sessions);
}

/**
 * Sync project path state from main process to renderer.
 * Called from main process after any project path or starred folder mutation.
 */
function syncProjectState(state: ProjectPathState): void {
    syncProjectStateFromMain(state);
}

/**
 * Sync folder tree from main process to renderer.
 * Called from main process after directory tree scan completes.
 */
function syncFolderTree(tree: FolderTreeNode): void {
    syncFolderTreeFromMain(tree);
}

function syncStarredFolderTrees(trees: Readonly<Record<string, FolderTreeNode>>): void {
    syncStarredTreesFromMain(trees);
}

function syncExternalFolderTrees(trees: Readonly<Record<string, FolderTreeNode>>): void {
    syncExternalTreesFromMain(trees);
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
export const uiAPIHandler = {
    launchTerminalOntoUI,
    updateFloatingEditorsFromExternal,
    updateFloatingEditorsFromDaemon,
    createEditorForExternalNode,
    fitViewport,
    syncTerminals,
    syncProjectState,
    syncFolderTree,
    syncStarredFolderTrees,
    syncExternalFolderTrees,
    setIsTrackpadScrolling,
    closeTerminalById,
    updateInjectBadge,
    syncUnclaimedTmuxSessions,
    syncRecoverySessions,
    logHookResult,
    onSettingsChanged: (): void => {
        for (const cb of settingsChangeListeners) cb();
    },
    applyLiveCommand: (command: unknown): void => {
        void applyLiveCommandToRenderer(command)
    },
};

export type UIAPIType = typeof uiAPIHandler;

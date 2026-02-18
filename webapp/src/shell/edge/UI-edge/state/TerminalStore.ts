import {getTerminalId, type TerminalId, type FloatingWindowUIData} from "@/shell/edge/UI-edge/floating-windows/types";
import type {NodeIdAndFilePath} from "@/pure/graph";
import type {} from '@/shell/electron';
import * as O from "fp-ts/lib/Option.js";
import {type Option} from "fp-ts/lib/Option.js";
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import type {TerminalRecord} from "@/shell/edge/main/terminals/terminal-registry";
import {resetAgentTabsStore} from "@/shell/edge/UI-edge/state/AgentTabsStore";

const terminals: Map<TerminalId, TerminalData> = new Map<TerminalId, TerminalData>();

// Subscription callbacks for terminal changes
type TerminalChangeCallback = (terminals: TerminalData[]) => void;
const subscribers: Set<TerminalChangeCallback> = new Set();

// Active terminal state (which terminal has gold outline/is selected)
let activeTerminalId: TerminalId | null = null;

// Subscription callbacks for active terminal changes
type ActiveTerminalCallback = (terminalId: TerminalId | null) => void;
const activeTerminalSubscribers: Set<ActiveTerminalCallback> = new Set();

function notifyActiveTerminalChange(): void {
    for (const callback of activeTerminalSubscribers) {
        callback(activeTerminalId);
    }
}

export function subscribeToActiveTerminalChange(callback: ActiveTerminalCallback): () => void {
    activeTerminalSubscribers.add(callback);
    return () => {
        activeTerminalSubscribers.delete(callback);
    };
}

export function setActiveTerminalId(terminalId: TerminalId | null): void {
    activeTerminalId = terminalId;
    notifyActiveTerminalChange();
}

export function getActiveTerminalId(): TerminalId | null {
    return activeTerminalId;
}

/**
 * Subscribe to terminal changes (add/remove)
 * @returns unsubscribe function
 */
export function subscribeToTerminalChanges(callback: TerminalChangeCallback): () => void {
    subscribers.add(callback);
    return () => {
        subscribers.delete(callback);
    };
}

/**
 * Notify all subscribers of terminal changes
 */
function notifySubscribers(): void {
    const terminalList: TerminalData[] = Array.from(terminals.values());
    for (const callback of subscribers) {
        callback(terminalList);
    }
}

/**
 * Sync terminal state from main process.
 * This is the primary way terminal data arrives in the renderer - pushed from main.
 * Preserves renderer-local UI references while updating data from main.
 * Phase 3: Renderer is display-only, main is source of truth.
 */
export function syncFromMain(records: TerminalRecord[]): void {
    // Build set of incoming terminal IDs for removal detection
    const incomingIds: Set<string> = new Set(records.map(r => r.terminalId));

    // Detect and handle removals (terminals in local store but not in incoming)
    for (const [terminalId] of terminals) {
        if (!incomingIds.has(terminalId)) {
            // Terminal was removed in main - remove from local store
            // Note: UI cleanup (floating window disposal) is handled separately
            terminals.delete(terminalId);
        }
    }

    // Update/add terminals from incoming records
    for (const record of records) {
        const terminalId: TerminalId = record.terminalId as TerminalId;
        const existing: TerminalData | undefined = terminals.get(terminalId);

        if (existing) {
            // Update existing terminal, preserving renderer-local UI reference
            terminals.set(terminalId, {
                ...record.terminalData,
                ui: existing.ui,  // Preserve existing UI
            });
        } else {
            // New terminal from main - add without UI (will be set by launchTerminalOntoUI)
            terminals.set(terminalId, record.terminalData);
        }
    }

    notifySubscribers();
}

/**
 * Set the UI reference for a terminal (renderer-local state).
 * Called by launchTerminalOntoUI after creating the floating window.
 *
 * If terminal exists in store, attaches UI to it.
 * If terminal doesn't exist yet (race condition: launchTerminalOntoUI arrived
 * before syncTerminals), stores the terminalData with UI - it will be merged
 * when syncFromMain arrives.
 */
export function setTerminalUI(terminalId: TerminalId, ui: FloatingWindowUIData, terminalData?: TerminalData): void {
    const existing: TerminalData | undefined = terminals.get(terminalId);
    if (existing) {
        terminals.set(terminalId, { ...existing, ui });
    } else if (terminalData) {
        // Race condition fallback: terminal not in store yet, add it with UI
        terminals.set(terminalId, { ...terminalData, ui });
        notifySubscribers();
    }
}

export function getTerminals(): Map<TerminalId, TerminalData> {
    return terminals;
}

export function addTerminal(terminal: TerminalData): void {
    terminals.set(getTerminalId(terminal), terminal);
    notifySubscribers();
}

export function getTerminal(terminalId: TerminalId): Option<TerminalData> {
    const terminal: TerminalData | undefined = terminals.get(terminalId);
    return terminal ? O.some(terminal) : O.none;
}

export function getTerminalByNodeId(nodeId: NodeIdAndFilePath): Option<TerminalData> {
    for (const terminal of terminals.values()) {
        if (terminal.attachedToContextNodeId === nodeId) {
            return O.some(terminal);
        }
    }
    return O.none;
}

export function removeTerminal(terminalId: TerminalId): void {
    terminals.delete(terminalId);
    notifySubscribers();
}

export function removeTerminalByData(terminal: TerminalData): void {
    terminals.delete(getTerminalId(terminal));
    notifySubscribers();
}

/**
 * Update specific fields of a terminal (immutable update pattern)
 * Returns the updated terminal, or undefined if not found
 * NOTE: Only use for structural changes (isPinned) that require full re-render.
 * For running state (isDone, lastOutputTime, activityCount), use updateTerminalRunningState.
 */
export function updateTerminal(
    terminalId: TerminalId,
    updates: Partial<Pick<TerminalData, 'isPinned'>>
): TerminalData | undefined {
    const existing: TerminalData | undefined = terminals.get(terminalId);
    if (!existing) return undefined;

    const updated: TerminalData = { ...existing, ...updates };
    terminals.set(terminalId, updated);
    notifySubscribers();

    return updated;
}

/**
 * Update running state fields without triggering a full re-render.
 * Use targeted DOM updates (agentTabsDOMUpdates) after calling this.
 * Returns the updated terminal with previous isDone state for change detection.
 */
export function updateTerminalRunningState(
    terminalId: TerminalId,
    updates: Partial<Pick<TerminalData, 'isDone' | 'lastOutputTime' | 'activityCount'>>
): { terminal: TerminalData; previousIsDone: boolean } | undefined {
    const existing: TerminalData | undefined = terminals.get(terminalId);
    if (!existing) return undefined;

    const previousIsDone: boolean = existing.isDone;
    const updated: TerminalData = { ...existing, ...updates };
    terminals.set(terminalId, updated);

    // Sync isDone changes to main process for MCP list_agents
    if (updates.isDone !== undefined && updates.isDone !== previousIsDone) {
        void window.electronAPI?.main.updateTerminalIsDone(terminalId, updates.isDone);
    }

    return { terminal: updated, previousIsDone };
}

/**
 * @deprecated Use addTerminal instead
 */
export const addTerminalToMapState: (terminal: TerminalData) => void = addTerminal;
/**
 * @deprecated Use removeTerminalByData instead
 */
export const removeTerminalFromMapState: (terminal: TerminalData) => void = removeTerminalByData;
/**
 * @deprecated Use removeTerminal instead
 */
export const removeTerminalFromMapStateById: (terminalId: TerminalId) => void = removeTerminal;

export function getNextTerminalCount(
    terminalsMap: Map<TerminalId, TerminalData>,
    nodeId: NodeIdAndFilePath
): number {
    let maxCount: number = -1;
    for (const data of terminalsMap.values()) {
        if (data.attachedToContextNodeId === nodeId && data.terminalCount > maxCount) {
            maxCount = data.terminalCount;
        }
    }
    return maxCount + 1;
}

/**
 * Update activity count and notify subscribers.
 * Unlike updateTerminalRunningState (which skips notification for high-frequency lastOutputTime),
 * activity count changes are infrequent and visually important, so we notify.
 */
export function updateTerminalActivityAndNotify(
    terminalId: TerminalId,
    activityCount: number
): void {
    const existing: TerminalData | undefined = terminals.get(terminalId);
    if (!existing) return;
    terminals.set(terminalId, { ...existing, activityCount });
    notifySubscribers();
}

/**
 * Clear all terminals from state.
 * Also resets derived agent tabs state (activeTerminalId, displayOrder).
 */
export function clearTerminals(): void {
    terminals.clear();
    activeTerminalId = null;
    notifySubscribers();
    notifyActiveTerminalChange();
    // Reset derived agent tabs state
    resetAgentTabsStore();
}
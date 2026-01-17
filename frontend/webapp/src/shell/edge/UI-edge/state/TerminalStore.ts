import {getTerminalId, type TerminalId} from "@/shell/edge/UI-edge/floating-windows/types";
import type {NodeIdAndFilePath} from "@/pure/graph";
import * as O from "fp-ts/lib/Option.js";
import {type Option} from "fp-ts/lib/Option.js";
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";

const terminals: Map<TerminalId, TerminalData> = new Map<TerminalId, TerminalData>();

// Subscription callbacks for terminal changes
type TerminalChangeCallback = (terminals: TerminalData[]) => void;
const subscribers: Set<TerminalChangeCallback> = new Set();

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
        if (terminal.attachedToNodeId === nodeId) {
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
 */
export function updateTerminal(
    terminalId: TerminalId,
    updates: Partial<Pick<TerminalData, 'isPinned' | 'isDone' | 'lastOutputTime' | 'activityCount'>>
): TerminalData | undefined {
    const existing: TerminalData | undefined = terminals.get(terminalId);
    if (!existing) return undefined;

    const updated: TerminalData = { ...existing, ...updates };
    terminals.set(terminalId, updated);
    notifySubscribers();
    return updated;
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
        if (data.attachedToNodeId === nodeId && data.terminalCount > maxCount) {
            maxCount = data.terminalCount;
        }
    }
    return maxCount + 1;
}

/**
 * Clear all terminals from state (for testing)
 * @internal - Only for test usage
 */
export function clearTerminals(): void {
    terminals.clear();
    notifySubscribers();
}
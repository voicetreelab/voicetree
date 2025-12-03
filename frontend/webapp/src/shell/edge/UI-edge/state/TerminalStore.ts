import {getTerminalId, type TerminalId, type TerminalData} from "@/shell/edge/UI-edge/floating-windows/types-v2";
import type {NodeIdAndFilePath} from "@/pure/graph";
import * as O from "fp-ts/Option";
import {type Option} from "fp-ts/Option";

const terminals: Map<TerminalId, TerminalData> = new Map<TerminalId, TerminalData>();

export function getTerminals(): Map<TerminalId, TerminalData> {
    return terminals;
}

export function addTerminal(terminal: TerminalData): void {
    terminals.set(getTerminalId(terminal), terminal);
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
}

export function removeTerminalByData(terminal: TerminalData): void {
    terminals.delete(getTerminalId(terminal));
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
}
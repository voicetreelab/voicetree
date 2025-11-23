import type {NodeIdAndFilePath} from "@/pure/graph";
import {getTerminalId, type TerminalData, type TerminalId} from "@/shell/edge/UI-edge/floating-windows/types.ts";

export const vanillaFloatingWindowInstances = new Map<string, { dispose: () => void }>();
// todo, we can remove this once we have terminals map, and editors map.

/**
 * Get a vanilla instance by window ID (for testing)
 * @internal - Only for test usage
 */
export function getVanillaInstance(windowId: string): { dispose: () => void } | undefined {
    return vanillaFloatingWindowInstances.get(windowId);
}

const terminals = new Map<TerminalId, TerminalData>();

export function getTerminals(): Map<TerminalId, TerminalData> {
    return terminals;
}

export function addTerminalToMapState(terminal: TerminalData): void {
    terminals.set(getTerminalId(terminal), terminal);
}

export function removeTerminalFromMapState(terminal: TerminalData): void {
    terminals.delete(getTerminalId(terminal));
}

export function removeTerminalFromMapStateById(terminalId: TerminalId): void {
    terminals.delete(terminalId);
}

export function getNextTerminalCount(
    terminals: Map<TerminalId, TerminalData>,
    nodeId: NodeIdAndFilePath
): number {
    let maxCount = -1;
    for (const [_, data] of terminals) {
        if (data.attachedToNodeId === nodeId && data.terminalCount > maxCount) {
            maxCount = data.terminalCount;
        }
    }
    return maxCount + 1;
}

import type {NodeIdAndFilePath} from "@/pure/graph";
import type {TerminalData, TerminalId} from "@/shell/edge/UI-edge/floating-windows/types.ts";

export const vanillaFloatingWindowInstances = new Map<string, { dispose: () => void }>();
// todo, we can remove this once we have terminals map, and editors map.

/**
 * Get a vanilla instance by window ID (for testing)
 * @internal - Only for test usage
 */
export function getVanillaInstance(windowId: string): { dispose: () => void } | undefined {
    return vanillaFloatingWindowInstances.get(windowId);
}

export const terminals =  new Map<TerminalId, TerminalData>();
import type {Core} from "cytoscape";
import {getCyInstance} from "@/shell/edge/UI-edge/state/cytoscape-state";
import {getTerminal} from "@/shell/edge/UI-edge/state/TerminalStore";
import type {TerminalId} from "@/shell/edge/UI-edge/floating-windows/types";
import * as O from "fp-ts/Option";
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import {closeTerminal} from "@/shell/edge/UI-edge/floating-windows/terminals/closeTerminal";

/**
 * Close a terminal by ID from main process (e.g., MCP close_agent tool).
 * Mimics what happens when user clicks the red traffic light button:
 * - Removes from registry
 * - Disposes floating window
 * - Deletes context node if last terminal
 */
export function closeTerminalById(terminalId: string): void {
    const cy: Core = getCyInstance();
    const terminalOpt: O.Option<TerminalData> = getTerminal(terminalId as TerminalId);
    if (O.isNone(terminalOpt)) {
        console.warn(`[closeTerminalById] Terminal not found: ${terminalId}`);
        return;
    }
    void closeTerminal(terminalOpt.value, cy);
}
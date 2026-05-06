/**
 * Per-window terminal ownership tracking, lifted out of TerminalManager so the
 * manager itself stays Node-only. The webapp records which renderer window
 * (by numeric id) spawned each terminal and uses it to bulk-kill leftover
 * PTYs when that window closes.
 */

import type TerminalManager from '@/shell/edge/main/terminals/terminal-manager';

const terminalToWindow: Map<string, number> = new Map();

export function trackTerminalForWindow(terminalId: string, windowId: number): void {
    terminalToWindow.set(terminalId, windowId);
}

export function untrackTerminal(terminalId: string): void {
    terminalToWindow.delete(terminalId);
}

export function cleanupTerminalsForWindow(
    terminalManager: TerminalManager,
    windowId: number,
): void {
    const ids: string[] = [];
    for (const [terminalId, ownerWindow] of terminalToWindow.entries()) {
        if (ownerWindow === windowId) ids.push(terminalId);
    }
    for (const id of ids) terminalToWindow.delete(id);
    terminalManager.cleanupForWindow(ids);
}

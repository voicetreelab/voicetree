import { ipcMain } from 'electron'
import type TerminalManager from '@vt/agent-runtime'
import type { TerminalSpawnResult } from '@vt/agent-runtime'
import {
    trackTerminalForWindow,
    untrackTerminal,
} from '@/shell/edge/main/agent/terminals/terminal-window-tracker'

// Bridge between Electron IPC and the runtime-agnostic TerminalManager.
// Interactive terminals are tmux-backed; the renderer panel talks WebSocket
// to the relay directly for input/output. The only IPC the renderer needs
// at spawn time is session creation.
export function registerTerminalIpcHandlers(
    terminalManager: TerminalManager,
    getToolsDirectory: () => string,
): void {
    ipcMain.handle('terminal:spawn', async (event, terminalData) => {
        const senderId: number = event.sender.id
        const result: TerminalSpawnResult = await terminalManager.spawnTmuxBacked({
            terminalData,
            getToolsDirectory,
            onData: (): void => {},
            onExit: (terminalId: string): void => { untrackTerminal(terminalId) },
        })
        if (result.success && !result.terminalId.startsWith('error-')) {
            trackTerminalForWindow(result.terminalId, senderId)
        }
        return result
    })
}

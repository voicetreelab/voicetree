import { ipcMain } from 'electron'
import type TerminalManager from '@/shell/edge/main/terminals/terminal-manager'
import type { TerminalSpawnResult } from '@/shell/edge/main/terminals/terminal-manager'
import {
    trackTerminalForWindow,
    untrackTerminal,
} from '@/shell/edge/main/terminals/terminal-window-tracker'

// Bridge between Electron IPC and the runtime-agnostic TerminalManager.
// The handler is the only place that knows about `event.sender`; it wraps
// renderer IPC sends as onData/onExit callbacks for the manager.
export function registerTerminalIpcHandlers(
    terminalManager: TerminalManager,
    getToolsDirectory: () => string,
): void {
    ipcMain.handle('terminal:spawn', async (event, terminalData) => {
        const sender: Electron.WebContents = event.sender
        const senderId: number = sender.id

        const result: TerminalSpawnResult = await terminalManager.spawn({
            terminalData,
            getToolsDirectory,
            onData: (terminalId: string, data: string): void => {
                try {
                    sender.send('terminal:data', terminalId, data)
                } catch (error) {
                    console.error(`Failed to send terminal data for ${terminalId}:`, error)
                }
            },
            onExit: (terminalId: string, exitCode: number): void => {
                try {
                    sender.send('terminal:exit', terminalId, exitCode)
                } catch (error) {
                    console.error(`Failed to send terminal exit for ${terminalId}:`, error)
                }
                untrackTerminal(terminalId)
            },
        })

        // Don't track error terminals (no PTY behind them).
        if (result.success && !result.terminalId.startsWith('error-')) {
            trackTerminalForWindow(result.terminalId, senderId)
        }
        return result
    })

    ipcMain.handle('terminal:write', async (_event, terminalId, data) => {
        return terminalManager.write(terminalId, data)
    })

    ipcMain.handle('terminal:resize', async (_event, terminalId, cols, rows) => {
        return terminalManager.resize(terminalId, cols, rows)
    })

    ipcMain.handle('terminal:kill', async (_event, terminalId) => {
        return terminalManager.kill(terminalId)
    })
}

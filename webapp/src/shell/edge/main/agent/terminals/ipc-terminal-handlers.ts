import { ipcMain } from 'electron'
import type TerminalManager from '@vt/agent-runtime'
import type { TerminalSpawnResult } from '@vt/agent-runtime'
import type { VTSettings } from '@vt/graph-model/settings'
import { loadSettings } from '@/shell/edge/main/settings/settings_IO'
import { shouldBypassElectronNodePtySpawn } from '@/shell/edge/main/agent/terminals/terminal-backend-gate'
import {
    trackTerminalForWindow,
    untrackTerminal,
} from '@/shell/edge/main/agent/terminals/terminal-window-tracker'

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
        const settings: VTSettings = await loadSettings()

        if (shouldBypassElectronNodePtySpawn(settings)) {
            // Phase 4 + M1-fix: under ptyBackend='tmux', the renderer panel speaks
            // WebSocket to the relay directly. The session it attaches to must
            // already exist — without this call the panel hangs in "tmux reconnecting".
            const tmuxResult: TerminalSpawnResult = await terminalManager.spawnTmuxBacked({
                terminalData,
                getToolsDirectory,
                onData: (): void => {},
                onExit: (terminalId: string): void => { untrackTerminal(terminalId) },
            })
            if (tmuxResult.success && !tmuxResult.terminalId.startsWith('error-')) {
                trackTerminalForWindow(tmuxResult.terminalId, senderId)
            }
            return tmuxResult
        }

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

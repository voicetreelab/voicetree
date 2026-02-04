/**
 * Singleton terminal manager instance.
 *
 * Allows terminal manager to be accessed from both main.ts and MCP server
 * without circular dependencies.
 */

import TerminalManager from '@/shell/edge/main/terminals/terminal-manager'

const terminalManager: TerminalManager = new TerminalManager()

export function getTerminalManager(): TerminalManager {
    return terminalManager
}

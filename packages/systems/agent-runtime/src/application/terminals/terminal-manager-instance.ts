/**
 * Singleton terminal manager instance.
 *
 * Allows terminal manager to be accessed from both main.ts and MCP server
 * without circular dependencies.
 */

import {TerminalManager} from './terminal-manager'

// Lazy singleton: constructed on first access so importing the barrel
// (e.g. for type-only consumers in test environments without node-pty)
// does not eagerly load the PTY runtime.
let terminalManager: TerminalManager | null = null

export function getTerminalManager(): TerminalManager {
    if (!terminalManager) {
        terminalManager = new TerminalManager()
    }
    return terminalManager
}

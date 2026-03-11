/**
 * Sends text to a terminal as simulated keyboard input.
 * Uses escape codes to enter insert mode and writes characters
 * individually with delays to ensure reliable delivery to the PTY.
 */

import {getTerminalManager} from '@/shell/edge/main/terminals/terminal-manager-instance'
import type {TerminalOperationResult} from '@/shell/edge/main/terminals/terminal-manager'

const CHAR_DELAY_MS: number = 5
const ESC_DELAY_MS: number = 100
const INSERT_MODE_DELAY_MS: number = 50
const SUBMIT_SEQUENCE: string = '\x1b\r'

export async function sendTextToTerminal(terminalId: string, text: string): Promise<TerminalOperationResult> {
    const terminalManager: ReturnType<typeof getTerminalManager> = getTerminalManager()

    // Universal preamble that works for both vi-mode (Claude) and emacs-mode (Codex, Gemini):
    //   ESC ESC  → vi: enters normal mode. emacs: harmless meta-key noise.
    //   i        → vi: enters insert mode.  emacs: types stray 'i'.
    //   Ctrl-U   → both: kill-line clears input buffer (removes stray 'i' in emacs, no-op in vi).
    // Must happen BEFORE the message — sending ESC after \r cancels generation.
    terminalManager.write(terminalId, '\x1b')
    await new Promise(resolve => setTimeout(resolve, ESC_DELAY_MS))
    terminalManager.write(terminalId, '\x1b')
    await new Promise(resolve => setTimeout(resolve, ESC_DELAY_MS))
    terminalManager.write(terminalId, 'i')
    await new Promise(resolve => setTimeout(resolve, INSERT_MODE_DELAY_MS))
    terminalManager.write(terminalId, '\x15') // Ctrl-U: kill line
    await new Promise(resolve => setTimeout(resolve, CHAR_DELAY_MS))

    // Submit using Option/Alt+Enter bytes (ESC+CR). This matches headful Codex terminals.
    const fullMessage: string = text + SUBMIT_SEQUENCE
    for (let i: number = 0; i < fullMessage.length; i++) {
        await new Promise(resolve => setTimeout(resolve, CHAR_DELAY_MS))
        const result: TerminalOperationResult = terminalManager.write(terminalId, fullMessage[i])
        if (!result.success) {
            return result
        }
    }

    return {success: true}
}

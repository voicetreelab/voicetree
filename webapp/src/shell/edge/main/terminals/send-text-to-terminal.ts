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

export async function sendTextToTerminal(terminalId: string, text: string): Promise<TerminalOperationResult> {
    const terminalManager: ReturnType<typeof getTerminalManager> = getTerminalManager()

    // Write each character with a small delay, then \r to submit
    // Works universally: emacs-mode CLIs (Codex, Gemini) and vi-mode CLIs (Claude) in insert mode
    const fullMessage: string = text + '\r'
    for (let i: number = 0; i < fullMessage.length; i++) {
        await new Promise(resolve => setTimeout(resolve, CHAR_DELAY_MS))
        const result: TerminalOperationResult = terminalManager.write(terminalId, fullMessage[i])
        if (!result.success) {
            return result
        }
    }

    // Defensive vi-mode reset: ESC ESC i ensures Claude CLI returns to insert mode
    // For non-vi CLIs this arrives after submission and is harmless noise
    await new Promise(resolve => setTimeout(resolve, ESC_DELAY_MS))
    terminalManager.write(terminalId, '\x1b')
    await new Promise(resolve => setTimeout(resolve, ESC_DELAY_MS))
    terminalManager.write(terminalId, '\x1b')
    await new Promise(resolve => setTimeout(resolve, INSERT_MODE_DELAY_MS))
    terminalManager.write(terminalId, 'i')

    return {success: true}
}

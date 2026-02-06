/**
 * Sends text to a terminal as simulated keyboard input.
 * Uses escape codes to enter insert mode and writes characters
 * individually with delays to ensure reliable delivery to the PTY.
 */

import {getTerminalManager} from '@/shell/edge/main/terminals/terminal-manager-instance'
import type {TerminalOperationResult} from '@/shell/edge/main/terminals/terminal-manager'

const ESC_DELAY_MS: number = 100
const INSERT_MODE_DELAY_MS: number = 50
const CHAR_DELAY_MS: number = 5

export async function sendTextToTerminal(terminalId: string, text: string): Promise<TerminalOperationResult> {
    const terminalManager = getTerminalManager()

    // Send ESC twice to exit any mode and return to normal mode
    terminalManager.write(terminalId, '\x1b')
    await new Promise(resolve => setTimeout(resolve, ESC_DELAY_MS))
    terminalManager.write(terminalId, '\x1b')
    await new Promise(resolve => setTimeout(resolve, ESC_DELAY_MS))

    // Enter insert mode
    terminalManager.write(terminalId, 'i')
    await new Promise(resolve => setTimeout(resolve, INSERT_MODE_DELAY_MS))

    // Write each character with a small delay, then \r to submit
    const fullMessage: string = text + '\r'
    for (let i = 0; i < fullMessage.length; i++) {
        await new Promise(resolve => setTimeout(resolve, CHAR_DELAY_MS))
        const result: TerminalOperationResult = terminalManager.write(terminalId, fullMessage[i])
        if (!result.success) {
            return result
        }
    }

    return {success: true}
}

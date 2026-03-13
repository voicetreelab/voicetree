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
const PREAMBLE_DUMMY: string = ' '

const terminalWriteQueues: Map<string, Promise<void>> = new Map()

function enqueueTerminalWrite<T>(
    terminalId: string,
    operation: () => Promise<T>
): Promise<T> {
    const prior: Promise<void> = terminalWriteQueues.get(terminalId) ?? Promise.resolve()
    const safePrior: Promise<void> = prior.catch(() => undefined).then(() => undefined)
    const operationPromise: Promise<T> = safePrior.then(operation)

    const marker: Promise<void> = operationPromise.then(
        () => undefined,
        () => undefined
    )
    terminalWriteQueues.set(terminalId, marker)
    return operationPromise.finally(() => {
        if (terminalWriteQueues.get(terminalId) === marker) {
            terminalWriteQueues.delete(terminalId)
        }
    })
}

export async function sendTextToTerminal(terminalId: string, text: string): Promise<TerminalOperationResult> {
    return enqueueTerminalWrite(terminalId, async () => {
    const terminalManager: ReturnType<typeof getTerminalManager> = getTerminalManager()

    // Universal preamble that works for both vi-mode (Claude) and emacs-mode (Codex, Gemini):
    // Dummy no-op character before ESC to mitigate first-byte timing misses on some PTY paths.
    terminalManager.write(terminalId, PREAMBLE_DUMMY)
    await new Promise(resolve => setTimeout(resolve, ESC_DELAY_MS))

    //   ESC      → vi: enters normal mode; emacs: harmless meta-key noise.
    //   i        → vi: enters insert mode.  emacs: types stray 'i'.
    //   Ctrl-U   → both: kill-line clears input buffer (removes stray 'i' in emacs, no-op in vi).
    // Must happen BEFORE the message — sending ESC after \r cancels generation.
    terminalManager.write(terminalId, '\x1b')
    await new Promise(resolve => setTimeout(resolve, ESC_DELAY_MS))
    terminalManager.write(terminalId, 'i')
    await new Promise(resolve => setTimeout(resolve, INSERT_MODE_DELAY_MS))
    terminalManager.write(terminalId, '\x15') // Ctrl-U: kill line
    await new Promise(resolve => setTimeout(resolve, CHAR_DELAY_MS))

    // Submit using Option/Alt+Enter bytes (ESC+CR). This matches headful Codex terminals.
    const fullMessage: string = text + '\x1b\r'
    for (let i: number = 0; i < fullMessage.length; i++) {
        await new Promise(resolve => setTimeout(resolve, CHAR_DELAY_MS))
        const result: TerminalOperationResult = terminalManager.write(terminalId, fullMessage[i])
        if (!result.success) {
            return result
        }
    }

    // Plain CR fallback for Claude Code (vi-mode readline interprets ESC+CR differently).
    // Harmless for Codex/OpenCode — arrives after Option+Enter already submitted.
    await new Promise(resolve => setTimeout(resolve, ESC_DELAY_MS))
    terminalManager.write(terminalId, '\r')

    return {success: true}
    })
}

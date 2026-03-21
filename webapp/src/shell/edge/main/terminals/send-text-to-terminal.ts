/**
 * Sends text to a terminal as simulated keyboard input.
 * Uses escape codes to enter insert mode, writes the sanitized message body,
 * and submits with a dual escape sequence.
 */

import {getTerminalManager} from '@/shell/edge/main/terminals/terminal-manager-instance'
import type {TerminalOperationResult} from '@/shell/edge/main/terminals/terminal-manager'

const CHAR_DELAY_MS: number = 5
const ESC_DELAY_MS: number = 100
const INSERT_MODE_DELAY_MS: number = 50
const PREAMBLE_DUMMY: string = ' '
const BATCH_CHAR_LIMIT: number = 150
const BATCH_DELAY_MS: number = 40

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

    // Sanitize: strip characters that readline interprets as key commands.
    // \n = Enter (accept-line, triggers autocomplete), \r = CR, \t = Tab (triggers completion),
    // ANSI arrow sequences = cursor movement. Formatting is irrelevant for agent messages.
    const sanitized: string = text
        .replace(/\r?\n/g, ' ')
        .replace(/\t/g, ' ')
        .replace(/\x1b\[[A-D]/g, '')
        .replace(/ {2,}/g, ' ')
        .trim()

    // Write message body in character-count-limited batches.
    // A single bulk write of long text triggers Claude Code's "[N lines pasted]"
    // collapse, which swallows the text. Small character batches stay under the
    // threshold while keeping writes atomic from the PTY's perspective.
    for (let i: number = 0; i < sanitized.length; i += BATCH_CHAR_LIMIT) {
        const batchText: string = sanitized.slice(i, i + BATCH_CHAR_LIMIT)
        const writeResult: TerminalOperationResult = terminalManager.write(terminalId, batchText)
        if (!writeResult.success) {
            return writeResult
        }
        if (i + BATCH_CHAR_LIMIT < sanitized.length) {
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS))
        }
    }

    // Dual submit for cross-agent compatibility:
    //   1. ESC+CR as single write → Option/Alt+Enter for Codex/OpenCode
    //   2. Plain CR after delay   → Enter for Claude Code (vi-mode readline)
    // Both must be single writes — splitting ESC+CR after bulk body is unreliable for Gemini.
    await new Promise(resolve => setTimeout(resolve, CHAR_DELAY_MS))
    terminalManager.write(terminalId, '\x1b\r')
    await new Promise(resolve => setTimeout(resolve, ESC_DELAY_MS))
    terminalManager.write(terminalId, '\r')

    return {success: true}
    })
}

/**
 * Send text to a tmux-backed terminal as agent input.
 *
 * Delegates to `tmux send-keys` (via `sendTmuxHeadlessAgentInput`), which
 * operates at the key-event level and submits with a separate Enter. There
 * is no need for the vi/emacs-mode escape dance, bracketed-paste batching,
 * or dual-submit ceremony that the legacy node-pty byte-stream path used.
 *
 * A per-terminal FIFO mutex ensures concurrent calls to the same terminal
 * don't interleave — important when multiple effects (unseen-node injection,
 * idle-gate notification, send_message) target the same agent.
 */

import {sendTmuxHeadlessAgentInput} from '../headless/tmuxHeadlessRuntime'
import type {TerminalOperationResult} from '../terminals/terminal-manager'

const terminalWriteQueues: Map<string, Promise<void>> = new Map()

export function sanitizeTerminalInput(text: string): string {
    return text
        .replace(/\r\n/g, ' ')
        .replace(/\r/g, ' ')
        .replace(/\n/g, ' ')
        .replace(/\t/g, ' ')
        .replace(/\x1b\[[A-D]/g, '')
        .replace(/ {2,}/g, ' ')
        .trim()
}

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

export function sendTextToTerminal(
    terminalId: string,
    text: string,
): Promise<TerminalOperationResult> {
    return enqueueTerminalWrite(terminalId, () => sendTmuxHeadlessAgentInput(terminalId, text))
}

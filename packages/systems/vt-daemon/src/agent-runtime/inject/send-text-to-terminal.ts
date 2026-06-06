/**
 * Inject text into a tmux-backed terminal as if the user typed it into the
 * TUI's chat field, then submit.
 *
 * Routes every byte through `tmux send-keys -l --` (literal mode), which
 * writes raw bytes to the pane's pty. This is the same byte stream the
 * legacy node-pty path produced; the surrounding ceremony — vi-mode entry,
 * bracketed-paste wrapping, and dual submit — is unchanged from that path
 * because real TUIs (Claude Code, Codex, Gemini) still rely on every step:
 *
 *   - PREAMBLE: a no-op space, then ESC → 'i' → Ctrl-U. Puts vi-mode
 *     readlines (Claude) into insert mode and kill-lines any prior input;
 *     harmless on emacs-mode readlines (Codex, Gemini).
 *
 *   - BODY: sanitized + wrapped in bracketed paste (\x1b[200~ … \x1b[201~)
 *     and chunked at BATCH_CHAR_LIMIT chars. Without the wrap, raw `\n`
 *     bytes in the body are interpreted as Enter (flipping Claude's input
 *     into multi-line mode, after which plain Enter no longer submits).
 *     The chunking + small inter-chunk delay prevents Claude Code from
 *     collapsing the input to "[N lines pasted]".
 *
 *   - DUAL SUBMIT: ESC+CR as a single write (Alt+Enter — Codex/OpenCode
 *     submit binding) then a plain CR after a delay (Enter — Claude vi-mode
 *     readline). Both writes are needed for cross-agent compatibility; the
 *     ESC+CR must be a single write because splitting it after a bulk body
 *     was historically unreliable for Gemini.
 *
 * A per-terminal FIFO mutex serializes concurrent calls (unseen-node
 * injection, idle-gate notification, send_message) so their ceremonies
 * don't interleave on the same terminal.
 *
 * Background: commit 6fc41313 (May 2026) attempted to drop the ceremony
 * under the assumption that `tmux send-keys -l --` simulates key events.
 * It does not — `-l` is literal-byte mode, identical to writing the bytes
 * to the pty directly, so the TUI-side interpretation problems the legacy
 * code worked around are still present.
 */

import {sendKeysLiteral} from '@vt/vt-daemon/agent-runtime/terminals/tmux/tmux-session-manager.ts'
import type {TerminalOperationResult} from '@vt/vt-daemon/agent-runtime/terminals/manager/terminal-manager.ts'
import {markTerminalInputStarted} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/lifecycle.ts'

const CHAR_DELAY_MS: number = 200
const ESC_DELAY_MS: number = 100
const INSERT_MODE_DELAY_MS: number = 50
const PREAMBLE_DUMMY: string = ' '
const BATCH_CHAR_LIMIT: number = 150
const BATCH_DELAY_MS: number = 40

export type SendTextToTerminalDeps = {
    readonly markInputStarted?: (terminalId: string, inputText: string) => void
    readonly writeLiteral: (terminalId: string, bytes: string) => Promise<void>
    readonly sleep: (delayMs: number) => Promise<void>
}

export type TerminalWriteScheduler = {
    readonly enqueueTerminalWrite: <T>(
        terminalId: string,
        operation: () => Promise<T>,
    ) => Promise<T>
}

export type SendTextToTerminal = (
    terminalId: string,
    text: string,
    deps?: SendTextToTerminalDeps,
) => Promise<TerminalOperationResult>

const sleepWithTimer = (delayMs: number): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, delayMs))

const defaultSendTextToTerminalDeps: SendTextToTerminalDeps = {
    markInputStarted: markTerminalInputStarted,
    writeLiteral: sendKeysLiteral,
    sleep: sleepWithTimer,
}

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

export function createTerminalWriteScheduler(): TerminalWriteScheduler {
    const terminalWriteQueues: Map<string, Promise<void>> = new Map()

    return {
        enqueueTerminalWrite: <T>(
            terminalId: string,
            operation: () => Promise<T>,
        ): Promise<T> => {
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
    }
}

export function createSendTextToTerminal(
    scheduler: TerminalWriteScheduler = createTerminalWriteScheduler(),
): SendTextToTerminal {
    return (
        terminalId: string,
        text: string,
        deps: SendTextToTerminalDeps = defaultSendTextToTerminalDeps,
    ): Promise<TerminalOperationResult> =>
        scheduler.enqueueTerminalWrite(terminalId, () => sendTextToTerminalNow(terminalId, text, deps))
}

async function sendTextToTerminalNow(
    terminalId: string,
    text: string,
    deps: SendTextToTerminalDeps = defaultSendTextToTerminalDeps,
): Promise<TerminalOperationResult> {
    try {
        deps.markInputStarted?.(terminalId, text)
        const write = (bytes: string): Promise<void> => deps.writeLiteral(terminalId, bytes)

        // Universal preamble — vi-mode and emacs-mode safe.
        //   PREAMBLE_DUMMY → harmless byte; mitigates first-byte timing
        //                    misses on some PTY paths.
        //   ESC            → vi: normal mode; emacs: harmless meta-noise.
        //   'i'            → vi: insert mode; emacs: types stray 'i'.
        //   Ctrl-U         → both: kill-line clears the input buffer
        //                    (removes the stray 'i' in emacs, no-op in vi).
        // The preamble must run BEFORE the body — sending ESC after \r
        // would cancel an in-flight generation.
        await write(PREAMBLE_DUMMY)
        await deps.sleep(ESC_DELAY_MS)
        await write('\x1b')
        await deps.sleep(ESC_DELAY_MS)
        await write('i')
        await deps.sleep(INSERT_MODE_DELAY_MS)
        await write('\x15')
        await deps.sleep(CHAR_DELAY_MS)

        // Body in bracketed paste mode, batched. Sanitization strips
        // raw \n/\r/\t and stray cursor escapes; bracketed paste then
        // hides the (now whitespace-collapsed) content from readline so
        // none of it is mistaken for keystrokes. Batching keeps Claude
        // Code below its "[N lines pasted]" collapse threshold.
        const sanitized: string = sanitizeTerminalInput(text)
        await write('\x1b[200~')
        for (let i: number = 0; i < sanitized.length; i += BATCH_CHAR_LIMIT) {
            const batchText: string = sanitized.slice(i, i + BATCH_CHAR_LIMIT)
            await write(batchText)
            if (i + BATCH_CHAR_LIMIT < sanitized.length) {
                await deps.sleep(BATCH_DELAY_MS)
            }
        }
        await write('\x1b[201~')

        // Dual submit for cross-agent compatibility.
        //   ESC+CR as a single write → Alt+Enter for Codex / OpenCode.
        //   Plain CR after a delay   → Enter for Claude vi-mode readline.
        // ESC and CR must travel in the same write — splitting them after
        // a bulk body was historically unreliable for Gemini.
        await deps.sleep(CHAR_DELAY_MS)
        await write('\x1b\r')
        await deps.sleep(ESC_DELAY_MS)
        await write('\r')

        return {success: true}
    } catch (error) {
        return {success: false, error: error instanceof Error ? error.message : String(error)}
    }
}

export const sendTextToTerminal: SendTextToTerminal = createSendTextToTerminal()

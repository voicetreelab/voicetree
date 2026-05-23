/**
 * Byte-stream decoder that mirrors the submit semantics of real coding-agent
 * TUIs (Claude Code, Codex, OpenCode, Gemini) — strict enough that the
 * naive `tmux send-keys -l -- <text>; tmux send-keys Enter` injection path
 * never produces a submit, while the full inject ceremony
 * (`send-text-to-terminal.ts`) does.
 *
 * Rules:
 *   - Submit ONLY on `\x1b\r` (Alt+Enter). Mirrors Codex / OpenCode's
 *     primary submit binding; the inject ceremony emits this as a single
 *     write before its trailing plain CR. Plain `\r` and `\n` are content,
 *     never a submit — so a naive injection that ends with `tmux send-keys
 *     Enter` will accumulate text forever and the surrounding test times
 *     out, surfacing the regression class that 6fc41313 introduced.
 *   - `\x1b[200~ … \x1b[201~` bytes between the markers go into the message
 *     buffer verbatim (this is the body in the inject ceremony). The
 *     markers themselves are stripped.
 *   - `\x15` (Ctrl-U) clears the buffer (the ceremony's kill-line step).
 *   - Other ESC sequences (CSI and 2-char) are stripped, so the ceremony's
 *     ESC → 'i' vi-mode preamble does not leave a stray 'i' in the buffer.
 *   - Plain CR / LF outside paste are treated as content (kept verbatim).
 *     They never trigger a submit; only Alt+Enter does.
 *   - Chunk boundaries that fall inside a recognised escape sequence are
 *     held over to the next chunk.
 */

export type SubmitFn = (message: string) => void

const BRACKET_PASTE_START: string = '\x1b[200~'
const BRACKET_PASTE_END: string = '\x1b[201~'
const ALT_ENTER_CR: string = '\x1b\r'
const ALT_ENTER_LF: string = '\x1b\n'

// Longest prefix that could be the partial start of a recognised escape we
// would otherwise consume. If the chunk ends with one of these, we defer it.
function deferredEscapePrefixLength(rest: string): number {
    if (rest === '\x1b') return 1
    if (rest === '\x1b[') return 2
    if (rest === '\x1b[2') return 3
    if (rest === '\x1b[20') return 4
    if (rest === '\x1b[200') return 5
    if (rest === '\x1b[201') return 5
    return 0
}

function consumeEscapeSequence(bytes: string, start: number): number {
    // Caller has already confirmed bytes[start] === '\x1b' and that the
    // sequence is not one of the specially-handled escapes (paste markers,
    // Alt+Enter). Strip a CSI (`\x1b[…<final>`) or a 2-char ESC (`\x1b<x>`).
    let i: number = start + 1
    if (bytes[i] === '[') {
        i++
        while (i < bytes.length) {
            const code: number = bytes.charCodeAt(i)
            if (code < 0x20 || code >= 0x40) break
            i++
        }
        if (i < bytes.length) i++ // final byte
        return i
    }
    if (i < bytes.length) i++ // 2-char ESC: consume the byte after ESC
    return i
}

export function createCeremonyStdinDecoder(submit: SubmitFn): (chunk: Buffer | string) => void {
    let buffer: string = ''
    let inPaste: boolean = false
    let pending: string = ''

    return (chunk: Buffer | string): void => {
        const incoming: string = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
        const bytes: string = pending + incoming
        let i: number = 0

        while (i < bytes.length) {
            // Defer trailing partial escapes so we re-evaluate them next chunk.
            const partial: number = deferredEscapePrefixLength(bytes.slice(i))
            if (partial > 0 && i + partial === bytes.length) break

            if (inPaste) {
                if (bytes.startsWith(BRACKET_PASTE_END, i)) {
                    inPaste = false
                    i += BRACKET_PASTE_END.length
                    continue
                }
                buffer += bytes[i]
                i++
                continue
            }

            if (bytes.startsWith(BRACKET_PASTE_START, i)) {
                inPaste = true
                i += BRACKET_PASTE_START.length
                continue
            }

            if (bytes.startsWith(ALT_ENTER_CR, i) || bytes.startsWith(ALT_ENTER_LF, i)) {
                const message: string = buffer.trim()
                buffer = ''
                if (message.length > 0) submit(message)
                i += 2
                continue
            }

            if (bytes[i] === '\x15') {
                buffer = ''
                i++
                continue
            }

            if (bytes[i] === '\x1b') {
                i = consumeEscapeSequence(bytes, i)
                continue
            }

            // Plain content — including \r and \n, which are NOT submits.
            buffer += bytes[i]
            i++
        }

        pending = bytes.slice(i)
    }
}

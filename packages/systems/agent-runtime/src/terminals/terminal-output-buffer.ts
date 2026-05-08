/**
 * Character-based ring buffer for terminal output capture.
 *
 * Stores last N characters per terminal for MCP read_terminal_output tool.
 * Decoupled from TerminalManager for easy removal if feature proves not useful.
 */

const MAX_CHARS: number = 10000

// terminalId -> string (character ring buffer)
const buffers: Map<string, string> = new Map<string, string>()

/* eslint-disable no-control-regex */
// These regexes intentionally match terminal control characters (ESC, BEL, C1 codes)
const OSC_PATTERN: RegExp = /\x1B\][^\x07\x1B\n]*(?:\x07|\x1B\\)?/g
const DCS_PATTERN: RegExp = /\x1B[PX^_][^\x1B\n]*(?:\x1B\\)?/g
const CSI_PATTERN: RegExp = /\x1B\[[0-?]*[ -/]*[@-~]/g
const ESC2_PATTERN: RegExp = /\x1B[@-Z\\-_]/g
const C1_PATTERN: RegExp = /[\x80-\x9F]/g
/* eslint-enable no-control-regex */

/**
 * Sanitize terminal output to only include printable ASCII characters.
 * Strips all ANSI/terminal escape sequences including OSC (hyperlinks, titles),
 * CSI (cursor/color), DCS, and other control sequences.
 */
function sanitizeOutput(data: string): string {
    let cleaned: string = data

    // 1. Strip OSC sequences: ESC ] <body> BEL  or  ESC ] <body> ST
    //    These carry hyperlinks (OSC 8), titles (OSC 0/2), shell integration (OSC 133), etc.
    //    The body can be long — must consume it all, not just the ESC ] prefix.
    cleaned = cleaned.replace(OSC_PATTERN, '')

    // 2. Strip DCS/SOS/PM/APC sequences: ESC P/X/^/_ <body> ST
    cleaned = cleaned.replace(DCS_PATTERN, '')

    // 3. Strip CSI sequences: ESC [ <params> <intermediate> <final>
    cleaned = cleaned.replace(CSI_PATTERN, '')

    // 4. Strip remaining 2-char ESC sequences
    cleaned = cleaned.replace(ESC2_PATTERN, '')

    // 5. Strip 8-bit C1 control codes
    cleaned = cleaned.replace(C1_PATTERN, '')

    // 6. Process carriage returns
    //    First normalize CRLF (\r\n) to LF — standard Windows line endings
    cleaned = cleaned.replace(/\r\n/g, '\n')
    //    Then process remaining \r as line-overwrite (TUI apps use \r to rewrite in-place)
    //    Keep only the content after the last \r on each line
    const crLines: string[] = cleaned.split('\n')
    cleaned = crLines.map((line: string) => {
        const parts: string[] = line.split('\r')
        return parts[parts.length - 1]
    }).join('\n')

    // 7. Filter to printable ASCII (32-126) and newline (10)
    let result: string = ''
    for (let i: number = 0; i < cleaned.length; i++) {
        const code: number = cleaned.charCodeAt(i)
        if (code === 10 || (code >= 32 && code <= 126)) {
            result += cleaned[i]
        }
    }

    return result
}

export function captureOutput(terminalId: string, data: string): void {
    const sanitized: string = sanitizeOutput(data)
    if (sanitized.length === 0) return

    let buffer: string = buffers.get(terminalId) ?? ''
    buffer += sanitized

    // Collapse consecutive empty lines (3+ newlines → 2 newlines) to prevent
    // buffer pollution from stripped escape sequences (TUI-heavy output like
    // Claude Code generates many empty lines after sanitization)
    buffer = buffer.replace(/\n{3,}/g, '\n\n')

    // Keep only last MAX_CHARS
    if (buffer.length > MAX_CHARS) {
        buffer = buffer.slice(-MAX_CHARS)
    }

    buffers.set(terminalId, buffer)
}

export function getOutput(terminalId: string, nChars: number = MAX_CHARS): string | undefined {
    const buffer: string | undefined = buffers.get(terminalId)
    if (buffer === undefined) return undefined

    return buffer.slice(-Math.min(nChars, MAX_CHARS))
}

export function clearBuffer(terminalId: string): void {
    buffers.delete(terminalId)
}

export function clearAllBuffers(): void {
    buffers.clear()
}

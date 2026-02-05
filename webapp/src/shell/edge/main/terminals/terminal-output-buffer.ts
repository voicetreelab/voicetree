/**
 * Ring buffer for terminal output capture.
 *
 * Stores last N lines per terminal for MCP read_terminal_output tool.
 * Decoupled from TerminalManager for easy removal if feature proves not useful.
 */

const MAX_LINES = 100

// ANSI escape code pattern
const ANSI_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g

// terminalId -> array of lines (ring buffer)
const buffers = new Map<string, string[]>()

// Partial line buffer for incomplete lines (data may arrive mid-line)
const partialLines = new Map<string, string>()

/**
 * Sanitize terminal output to only include printable ASCII characters.
 * - Strips ANSI escape codes
 * - Removes carriage returns (\r)
 * - Keeps only printable ASCII (32-126) and newlines (10)
 */
function sanitizeOutput(data: string): string {
    // Strip ANSI escape codes first
    let cleaned = data.replace(ANSI_PATTERN, '')

    // Remove carriage returns
    cleaned = cleaned.replace(/\r/g, '')

    // Filter to printable ASCII (32-126) and newline (10)
    let result = ''
    for (let i = 0; i < cleaned.length; i++) {
        const code = cleaned.charCodeAt(i)
        if (code === 10 || (code >= 32 && code <= 126)) {
            result += cleaned[i]
        }
    }

    return result
}

export function captureOutput(terminalId: string, data: string): void {
    // Sanitize input data before processing
    const sanitized = sanitizeOutput(data)

    const partial = partialLines.get(terminalId) ?? ''
    const combined = partial + sanitized

    // Split on newlines, keeping partial line for next capture
    const lines = combined.split('\n')
    const newPartial = lines.pop() ?? ''
    partialLines.set(terminalId, newPartial)

    if (lines.length === 0) return

    const buffer = buffers.get(terminalId) ?? []
    buffer.push(...lines)

    // Keep only last MAX_LINES
    if (buffer.length > MAX_LINES) {
        buffer.splice(0, buffer.length - MAX_LINES)
    }

    buffers.set(terminalId, buffer)
}

export function getOutput(terminalId: string, nLines: number = MAX_LINES): string | undefined {
    const buffer = buffers.get(terminalId)
    if (!buffer) return undefined

    const linesToReturn = buffer.slice(-Math.min(nLines, MAX_LINES))
    // Output is already sanitized at capture time
    return linesToReturn.join('\n')
}

export function clearBuffer(terminalId: string): void {
    buffers.delete(terminalId)
    partialLines.delete(terminalId)
}

export function clearAllBuffers(): void {
    buffers.clear()
    partialLines.clear()
}

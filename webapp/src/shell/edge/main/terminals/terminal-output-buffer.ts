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

export function captureOutput(terminalId: string, data: string): void {
    const partial = partialLines.get(terminalId) ?? ''
    const combined = partial + data

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
    const output = linesToReturn.join('\n')

    // Strip ANSI codes
    return output.replace(ANSI_PATTERN, '')
}

export function clearBuffer(terminalId: string): void {
    buffers.delete(terminalId)
    partialLines.delete(terminalId)
}

export function clearAllBuffers(): void {
    buffers.clear()
    partialLines.clear()
}

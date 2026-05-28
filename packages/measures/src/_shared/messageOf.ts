export function messageOf(value: unknown): string {
    if (value instanceof Error) return value.message || value.stack || String(value)
    if (typeof value === 'object' && value !== null && 'message' in value) {
        return String((value as {message?: unknown}).message ?? value)
    }
    return String(value)
}

export function getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

export function normalizeRef(value: string): string {
    return value
        .trim()
        .replace(/\\/g, '/')
        .replace(/^(?:\.\/)+/, '')
        .replace(/\.md$/i, '')
}

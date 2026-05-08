/**
 * Build a short deterministic suffix from stable input parts.
 * Uses FNV-1a over a joined string so pure graph operations can propose IDs
 * without reaching for clock or random state.
 */
export function stableIdSuffix(parts: readonly string[]): string {
    const input: string = parts.join('\u001f')
    let hash: number = 2166136261

    for (let i: number = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i)
        hash = (hash * 16777619) >>> 0
    }

    return hash.toString(36)
}

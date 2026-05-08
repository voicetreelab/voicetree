let firstDeltaSeen: boolean = false
let loadingClearedSeen: boolean = false
const startedAtMs: number = typeof performance !== 'undefined' ? performance.now() : Date.now()

export function markRendererLoadTiming(
    event: 'renderer:graph-delta-received' | 'renderer:loading-cleared' | 'renderer:cy-stable',
    extra?: Record<string, unknown>,
): void {
    if (event === 'renderer:graph-delta-received') {
        if (firstDeltaSeen) return
        firstDeltaSeen = true
    }
    if (event === 'renderer:loading-cleared') {
        if (loadingClearedSeen) return
        loadingClearedSeen = true
    }

    const nowMs: number = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const elapsedMs: number = Math.round(nowMs - startedAtMs)
    const parts: string[] = [
        `ts=${new Date().toISOString()}`,
        `event=${event}`,
        `elapsedMs=${elapsedMs}`,
    ]
    if (extra) {
        for (const [key, value] of Object.entries(extra)) {
            parts.push(`${key}=${formatExtraValue(value)}`)
        }
    }
    console.log(`[load-timing] ${parts.join(' ')}`)
}

function formatExtraValue(value: unknown): string {
    if (value === null || value === undefined) return String(value)
    if (typeof value === 'string') return value.includes(' ') ? JSON.stringify(value) : value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return JSON.stringify(value)
}

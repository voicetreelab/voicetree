import * as path from 'node:path'
import {
    existsSync,
    readFileSync,
    readdirSync,
    statSync,
} from 'node:fs'

export interface SpanRecord {
    readonly traceId: string
    readonly spanId: string
    readonly name: string
    readonly durationMs: number
    readonly attributes?: Record<string, unknown>
}

export interface SpanSummary {
    readonly totalNew: number
    readonly byName: Record<string, number>
    readonly byOutcome: Record<string, number>
    readonly durationsMs: Record<string, { p50: number; p95: number; p99: number; max: number }>
}

export function ndjsonFileSize(filePath: string): number {
    try { return statSync(filePath).size } catch { return 0 }
}

export function readNdjsonTail(filePath: string, fromByteOffset: number): SpanRecord[] {
    if (!existsSync(filePath)) return []
    const buf = readFileSync(filePath)
    if (buf.length <= fromByteOffset) return []
    const tail = buf.subarray(fromByteOffset).toString('utf8')
    const out: SpanRecord[] = []
    for (const line of tail.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.length === 0) continue
        try {
            out.push(JSON.parse(trimmed) as SpanRecord)
        } catch {
            // skip mid-write torn lines
        }
    }
    return out
}

function quantile(sorted: readonly number[], q: number): number {
    if (sorted.length === 0) return 0
    if (sorted.length === 1) return sorted[0]
    const pos = (sorted.length - 1) * q
    const lo = Math.floor(pos)
    const hi = Math.ceil(pos)
    if (lo === hi) return sorted[lo]
    return sorted[lo] * (1 - (pos - lo)) + sorted[hi] * (pos - lo)
}

export function summarizeSpans(spans: readonly SpanRecord[]): SpanSummary {
    const byName: Record<string, number> = {}
    const byOutcome: Record<string, number> = {}
    const durationsByName: Record<string, number[]> = {}
    for (const span of spans) {
        byName[span.name] = (byName[span.name] ?? 0) + 1
        const outcome = span.attributes?.outcome
        if (typeof outcome === 'string') {
            const key = `${span.name}/${outcome}`
            byOutcome[key] = (byOutcome[key] ?? 0) + 1
        }
        const list = durationsByName[span.name] ?? (durationsByName[span.name] = [])
        list.push(span.durationMs)
    }
    const durationsMs: SpanSummary['durationsMs'] = {}
    for (const [name, raw] of Object.entries(durationsByName)) {
        const sorted = [...raw].sort((a, b) => a - b)
        durationsMs[name] = {
            p50: quantile(sorted, 0.5),
            p95: quantile(sorted, 0.95),
            p99: quantile(sorted, 0.99),
            max: sorted[sorted.length - 1],
        }
    }
    return { totalNew: spans.length, byName, byOutcome, durationsMs }
}

export function countMarkdownFiles(dir: string): number {
    let count = 0
    const walk = (d: string): void => {
        let entries: readonly string[]
        try { entries = readdirSync(d) } catch { return }
        for (const entry of entries) {
            if (entry.startsWith('.')) continue
            const full = path.join(d, entry)
            let stat
            try { stat = statSync(full) } catch { continue }
            if (stat.isDirectory()) walk(full)
            else if (stat.isFile() && entry.endsWith('.md')) count++
        }
    }
    walk(dir)
    return count
}

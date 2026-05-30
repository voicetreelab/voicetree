/**
 * Pure statistics + on-disk output accounting for the e2e-storm-mvp run.
 *
 * Extracted from index.ts (functional decomposition): these are all pure
 * value functions — percentile math over agent timings, plus a read-only walk
 * of the project tree to count the markdown the storm actually produced.
 */
import * as path from 'node:path'
import { readdirSync, readFileSync, statSync } from 'node:fs'

import type { FakeAgentResult } from './runFakeAgent.ts'

export interface DurationStats {
    readonly p50: number
    readonly p99: number
    readonly max: number
}

export function percentile(sorted: readonly number[], p: number): number {
    if (sorted.length === 0) return 0
    const index = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))]
}

export function durationStats(values: readonly number[]): DurationStats {
    const sorted = [...values].sort((a, b) => a - b)
    return {
        p50: percentile(sorted, 50),
        p99: percentile(sorted, 99),
        max: sorted[sorted.length - 1] ?? 0,
    }
}

export function wallTimeStats(results: readonly FakeAgentResult[]): DurationStats {
    return durationStats(results.map(r => r.wallMs))
}

export function spawnTimeStats(results: readonly FakeAgentResult[]): DurationStats {
    return durationStats(results.map(r => r.spawnWallMs))
}

export function walkMarkdownFiles(dir: string): readonly string[] {
    const result: string[] = []
    const walk = (d: string): void => {
        let entries: readonly string[]
        try { entries = readdirSync(d) } catch { return }
        for (const entry of entries) {
            if (entry.startsWith('.')) continue
            const full = path.join(d, entry)
            let stat
            try { stat = statSync(full) } catch { continue }
            if (stat.isDirectory()) walk(full)
            else if (stat.isFile() && entry.endsWith('.md')) result.push(full)
        }
    }
    walk(dir)
    return result
}

export function countStormOutputNodes(projectDir: string): number {
    const marker = 'MVP storm node mvp-agent-'
    return walkMarkdownFiles(projectDir).filter(file => {
        try { return readFileSync(file, 'utf8').includes(marker) } catch { return false }
    }).length
}

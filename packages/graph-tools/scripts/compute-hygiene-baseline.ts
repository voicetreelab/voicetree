#!/usr/bin/env npx tsx
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'
import { scanMarkdownFiles, extractLinks } from '../src/primitives'

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0
    const idx = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))]!
}

function computeStats(values: number[]) {
    const sorted = [...values].sort((a, b) => a - b)
    return {
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        max: sorted[sorted.length - 1] ?? 0,
        count: sorted.length,
        mean: sorted.length > 0 ? sorted.reduce((s, v) => s + v, 0) / sorted.length : 0,
    }
}

const vaultPath = process.argv[2]
if (!vaultPath) {
    console.error('Usage: compute-hygiene-baseline.ts <vault-path>')
    process.exit(1)
}

const mdFiles = scanMarkdownFiles(path.resolve(vaultPath))

// Metric 1: wikilinks per node
const wikilinkCounts: number[] = mdFiles.map(filePath => {
    const content = readFileSync(filePath, 'utf-8')
    return extractLinks(content).length
})

// Metric 2: directory immediate-children count (files + subdirs)
const dirChildren = new Map<string, Set<string>>()

function collectDirChildren(dir: string): void {
    let entries: string[]
    try {
        entries = readdirSync(dir)
    } catch {
        return
    }
    for (const entry of entries) {
        if (entry.startsWith('.') || entry === 'ctx-nodes') continue
        const fullPath = path.join(dir, entry)
        let st
        try {
            st = statSync(fullPath)
        } catch {
            continue
        }
        const parent = dir
        if (!dirChildren.has(parent)) dirChildren.set(parent, new Set())
        dirChildren.get(parent)!.add(fullPath)
        if (st.isDirectory()) collectDirChildren(fullPath)
    }
}

collectDirChildren(path.resolve(vaultPath))

const treeWidths = [...dirChildren.values()].map(s => s.size)

const wlStats = computeStats(wikilinkCounts)
const twStats = computeStats(treeWidths)

console.log('=== Hygiene Baseline ===')
console.log(`Vault: ${vaultPath}`)
console.log(`Nodes: ${mdFiles.length}`)
console.log('')
console.log('max_wikilinks_per_node:')
console.log(`  mean=${wlStats.mean.toFixed(2)}, p50=${wlStats.p50}, p95=${wlStats.p95}, max=${wlStats.max}`)
console.log(`  threshold (p95 × 1.5) = ${Math.ceil(wlStats.p95 * 1.5)}`)
console.log('')
console.log('max_tree_width (dirs scanned: ' + dirChildren.size + '):')
console.log(`  mean=${twStats.mean.toFixed(2)}, p50=${twStats.p50}, p95=${twStats.p95}, max=${twStats.max}`)
console.log(`  threshold (p95 × 1.5) = ${Math.ceil(twStats.p95 * 1.5)}`)

/**
 * Surface the most-coupled / hardest-to-follow parts of the graph.
 *
 * Three scoring lenses (returned together so the agent can compare):
 *
 *   1. byCoupling      — fanIn + fanOut: classic ripple-risk score.
 *                        High = many things depend on this AND it depends
 *                        on many things. Hub-shaped.
 *
 *   2. byFanOut        — fanOut alone: functions that call many others.
 *                        High = locally hard to follow (lots of branches
 *                        to read just to understand this one function).
 *
 *   3. byReachableSize — transitive blast radius: how many distinct
 *                        functions execute beneath this one.
 *                        High = "pull this thread, the whole sweater
 *                        comes with it." Best single proxy for "hard to
 *                        follow" in the user's question.
 *
 * Folder rollup (also returned) sums these scores per folder and ranks
 * folders by mean coupling — surfaces which directories form tightly-knit
 * clusters even when no single function dominates.
 *
 * Default `limit` is 20 per ranking; lift to see the long tail.
 */
import type {CallGraph, FunctionNode} from '../graph/load-graph.ts'

export type HotspotRow = {
    readonly id: string
    readonly file: string
    readonly line: number
    readonly name: string
    readonly fanIn: number
    readonly fanOut: number
    readonly coupling: number
    readonly reachableSize: number
    readonly loc: number
    readonly isExported: boolean
}

export type FolderHotspot = {
    readonly folder: string
    readonly functionCount: number
    readonly totalCoupling: number
    readonly meanCoupling: number
    readonly maxCoupling: number
    readonly maxReachable: number
}

export type HotspotReport = {
    readonly byCoupling: readonly HotspotRow[]
    readonly byFanOut: readonly HotspotRow[]
    readonly byReachableSize: readonly HotspotRow[]
    readonly byFolderCoupling: readonly FolderHotspot[]
    readonly totals: {
        readonly functions: number
        readonly edges: number
    }
}

export function hotspots(graph: CallGraph, limit = 20): HotspotReport {
    const rows = buildRows(graph)
    const folders = rollupByFolder(rows)
    const totalEdges = rows.reduce((sum, r) => sum + r.fanOut, 0)

    return {
        byCoupling: take(sortBy(rows, r => -r.coupling), limit),
        byFanOut: take(sortBy(rows, r => -r.fanOut), limit),
        byReachableSize: take(sortBy(rows, r => -r.reachableSize), limit),
        byFolderCoupling: take(sortBy(folders, f => -f.meanCoupling), limit),
        totals: {functions: rows.length, edges: totalEdges},
    }
}

function buildRows(graph: CallGraph): HotspotRow[] {
    const rows: HotspotRow[] = []
    for (const node of graph.nodes.values()) {
        const fanIn = graph.callers(node.id).size
        const fanOut = graph.callees(node.id).size
        const reachableSize = graph.reachableFrom(node.id).size
        rows.push({
            id: node.id,
            file: node.file,
            line: node.line,
            name: node.name,
            fanIn,
            fanOut,
            coupling: fanIn + fanOut,
            reachableSize,
            loc: node.loc,
            isExported: node.isExported,
        })
    }
    return rows
}

function rollupByFolder(rows: readonly HotspotRow[]): FolderHotspot[] {
    const byFolder = new Map<string, HotspotRow[]>()
    for (const row of rows) {
        const folder = topLevelFolder(row.file)
        const bucket = byFolder.get(folder) ?? []
        bucket.push(row)
        byFolder.set(folder, bucket)
    }
    const folders: FolderHotspot[] = []
    for (const [folder, bucket] of byFolder) {
        const total = bucket.reduce((s, r) => s + r.coupling, 0)
        const max = bucket.reduce((m, r) => Math.max(m, r.coupling), 0)
        const maxR = bucket.reduce((m, r) => Math.max(m, r.reachableSize), 0)
        folders.push({
            folder,
            functionCount: bucket.length,
            totalCoupling: total,
            meanCoupling: total / bucket.length,
            maxCoupling: max,
            maxReachable: maxR,
        })
    }
    return folders
}

/**
 * Bucket each function by its package-level folder so the rollup highlights
 * directory clusters (e.g. `packages/libraries/foo/src`) rather than single
 * files. Files outside the standard package layout use their first two
 * segments as the bucket key.
 */
function topLevelFolder(file: string): string {
    const parts = file.split('/')
    if (parts.length <= 2) return parts.slice(0, -1).join('/') || '.'
    if (parts[0] === 'packages' && parts.length >= 4) return parts.slice(0, 4).join('/')
    if (parts[0] === 'webapp' && parts.length >= 3) return parts.slice(0, 3).join('/')
    return parts.slice(0, 2).join('/')
}

function sortBy<T>(rows: readonly T[], key: (row: T) => number): T[] {
    return [...rows].sort((a, b) => key(a) - key(b))
}

function take<T>(rows: readonly T[], n: number): readonly T[] {
    return rows.slice(0, n)
}

// Re-export FunctionNode so the entry index has a single source of truth.
export type {FunctionNode}

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
    scanMarkdownFiles, getNodeId, extractLinks,
    buildUniqueBasenameMap, resolveLinkTarget, type StructureNode,
} from './primitives'

export interface EdgePair {
    readonly src: string
    readonly tgt: string
}

export interface GraphMetrics {
    readonly nodeCount: number
    readonly edgeCount: number      // undirected unique edges
    readonly arboricity: number     // upper bound via greedy forest decomposition
    readonly planar: boolean        // heuristic: E ≤ 3N-6 (necessary condition only)
    readonly sccCount: number       // directed strongly connected components (Tarjan)
    readonly kCore: number          // degeneracy / maximum k-core number
}

// ── Tarjan SCC (iterative) ─────────────────────────────────────────────────────

export function computeSCC(nodeIds: readonly string[], edges: readonly EdgePair[]): number {
    const adj = new Map<string, string[]>()
    for (const n of nodeIds) adj.set(n, [])
    for (const {src, tgt} of edges) {
        if (src !== tgt) adj.get(src)?.push(tgt)
    }
    const index = new Map<string, number>()
    const lowlink = new Map<string, number>()
    const onStack = new Set<string>()
    const tarjanStack: string[] = []
    let idx = 0
    let sccCount = 0
    for (const start of nodeIds) {
        if (index.has(start)) continue
        const workStack: {v: string; childIdx: number}[] = [{v: start, childIdx: 0}]
        index.set(start, idx); lowlink.set(start, idx); idx++
        tarjanStack.push(start); onStack.add(start)
        while (workStack.length > 0) {
            const frame = workStack[workStack.length - 1]!
            const children = adj.get(frame.v) ?? []
            if (frame.childIdx < children.length) {
                const w = children[frame.childIdx++]!
                if (!index.has(w)) {
                    index.set(w, idx); lowlink.set(w, idx); idx++
                    tarjanStack.push(w); onStack.add(w)
                    workStack.push({v: w, childIdx: 0})
                } else if (onStack.has(w)) {
                    lowlink.set(frame.v, Math.min(lowlink.get(frame.v)!, index.get(w)!))
                }
            } else {
                workStack.pop()
                if (workStack.length > 0) {
                    const parent = workStack[workStack.length - 1]!
                    lowlink.set(parent.v, Math.min(lowlink.get(parent.v)!, lowlink.get(frame.v)!))
                }
                if (lowlink.get(frame.v) === index.get(frame.v)) {
                    sccCount++
                    let w: string
                    do { w = tarjanStack.pop()!; onStack.delete(w) } while (w !== frame.v)
                }
            }
        }
    }
    return sccCount
}

// ── k-core decomposition (bucket-sort, O(V+E)) ───────────────────────────────

export function computeKCoreDegeneracy(nodeIds: readonly string[], edges: readonly EdgePair[]): number {
    const adj = new Map<string, Set<string>>()
    for (const n of nodeIds) adj.set(n, new Set())
    for (const {src, tgt} of edges) {
        if (src === tgt) continue
        adj.get(src)?.add(tgt); adj.get(tgt)?.add(src)
    }
    const degree = new Map<string, number>()
    for (const [v, nbrs] of adj) degree.set(v, nbrs.size)
    if (degree.size === 0) return 0
    const maxD = Math.max(...degree.values())
    const buckets: Set<string>[] = Array.from({length: maxD + 1}, () => new Set())
    for (const [v, d] of degree) buckets[d]!.add(v)
    const removed = new Set<string>()
    let k = 0; let low = 0
    while (true) {
        while (low <= maxD && buckets[low]!.size === 0) low++
        if (low > maxD) break
        const v = buckets[low]!.values().next().value!
        buckets[low]!.delete(v); removed.add(v); k = Math.max(k, low)
        for (const nbr of adj.get(v) ?? new Set()) {
            if (removed.has(nbr)) continue
            const d = degree.get(nbr)!
            buckets[d]!.delete(nbr); degree.set(nbr, d - 1); buckets[d - 1]!.add(nbr)
            if (d - 1 < low) low = d - 1
        }
    }
    return k
}

// ── Planarity heuristic ────────────────────────────────────────────────────────
// E ≤ 3N-6 is necessary but not sufficient for planarity. Conservative: may return
// true for graphs with non-planar subgraphs embedded in a sparse overall graph.

export function estimatePlanarity(N: number, E_undirected: number): boolean {
    if (N < 3) return true
    return E_undirected <= 3 * N - 6
}

// ── Arboricity (greedy forest decomposition upper bound) ──────────────────────

function undirKey(a: string, b: string): string { return a < b ? `${a}|${b}` : `${b}|${a}` }

class UF {
    private p = new Map<string, string>(); private r = new Map<string, number>()
    find(x: string): string {
        if (!this.p.has(x)) { this.p.set(x, x); this.r.set(x, 0) }
        let root = x; while (this.p.get(root)! !== root) root = this.p.get(root)!
        let c = x; while (this.p.get(c)! !== c) { const n = this.p.get(c)!; this.p.set(c, root); c = n }
        return root
    }
    union(a: string, b: string): boolean {
        const ra = this.find(a); const rb = this.find(b); if (ra === rb) return false
        const rka = this.r.get(ra)!; const rkb = this.r.get(rb)!
        if (rka < rkb) this.p.set(ra, rb); else if (rka > rkb) this.p.set(rb, ra)
        else { this.p.set(rb, ra); this.r.set(ra, rka + 1) }
        return true
    }
}

export function computeArboricity(nodeIds: readonly string[], edges: readonly EdgePair[]): number {
    const reps = new Map<string, EdgePair>()
    for (const e of edges) {
        if (e.src === e.tgt) continue
        const k = undirKey(e.src, e.tgt); if (!reps.has(k)) reps.set(k, e)
    }
    let remaining = [...reps.values()]
    let count = 0
    while (remaining.length > 0) {
        const uf = new UF(); const leftover: EdgePair[] = []
        for (const e of remaining) { if (!uf.union(e.src, e.tgt)) leftover.push(e) }
        count++; remaining = leftover
    }
    return count
}

// ── Full metrics ──────────────────────────────────────────────────────────────

export function computeAllMetrics(nodeIds: readonly string[], edges: readonly EdgePair[]): GraphMetrics {
    const N = nodeIds.length
    const seen = new Set<string>()
    const undirEdges: EdgePair[] = []
    for (const e of edges) {
        if (e.src === e.tgt) continue
        const k = undirKey(e.src, e.tgt)
        if (!seen.has(k)) { seen.add(k); undirEdges.push(e) }
    }
    const E_undirected = undirEdges.length
    return {
        nodeCount: N,
        edgeCount: E_undirected,
        arboricity: computeArboricity(nodeIds, edges),
        planar: estimatePlanarity(N, E_undirected),
        sccCount: computeSCC(nodeIds, edges),
        kCore: computeKCoreDegeneracy(nodeIds, edges),
    }
}

// ── Vault scanning ────────────────────────────────────────────────────────────

export function computeMetricsFromVault(vaultPath: string): GraphMetrics {
    const root = path.resolve(vaultPath)
    const mdFiles = scanMarkdownFiles(root)
    const structureNodes = new Map<string, StructureNode>()
    const contents = new Map<string, string>()
    for (const absPath of mdFiles) {
        const id = getNodeId(root, absPath)
        contents.set(id, fs.readFileSync(absPath, 'utf-8'))
        structureNodes.set(id, {id, title: id, outgoingIds: []})
    }
    const uniqueBasenames = buildUniqueBasenameMap(structureNodes)
    const edges: EdgePair[] = []
    for (const [id, content] of contents) {
        for (const link of extractLinks(content)) {
            const target = resolveLinkTarget(link, id, structureNodes, uniqueBasenames)
            if (target && target !== id) edges.push({src: id, tgt: target})
        }
    }
    return computeAllMetrics([...structureNodes.keys()], edges)
}

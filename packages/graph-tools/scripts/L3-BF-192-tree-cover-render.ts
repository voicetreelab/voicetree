#!/usr/bin/env node --import tsx
/**
 * L3-BF-192: Arboricity + tree-cover rendering.
 *
 * Reads a vt-graph state dump and produces:
 *   (a) Arboricity report: N, E, global density lower-bound, greedy upper-bound, degeneracy.
 *   (b) Tree-cover ASCII rendering:
 *       — Spine: folder hierarchy (no cross-edges shown)
 *       — k cover forests where k = a(G_wikilinks), each rendered as a set of rooted directed trees.
 *         Reused nodes are labeled with a stable @relative-path identifier so a parser can dedupe.
 *
 * Co-location claim (Eli / BF-190): each content edge is rendered adjacent to BOTH its source
 * and target labels, inside a single local tree fragment. No "jump to edge list" required.
 *
 * Usage:
 *   ./node_modules/.bin/vt-graph state dump <vault> --no-pretty --out /tmp/state.json
 *   npx tsx packages/graph-tools/scripts/L3-BF-192-tree-cover-render.ts /tmp/state.json [<vault-root>] > /tmp/tree-cover.txt
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ── Types ────────────────────────────────────────────────────────────────────

type JsonNode = {
    readonly outgoingEdges: ReadonlyArray<{targetId: string; label?: string}>
    readonly absoluteFilePathIsID: string
    readonly contentWithoutYamlOrLinks?: string
}
type JsonState = {readonly graph: {readonly nodes: Record<string, JsonNode>}}

type DirectedEdge = {readonly src: string; readonly tgt: string; readonly label?: string}

// ── Util: title + id ──────────────────────────────────────────────────────────

function deriveTitle(content: string | undefined, fallbackBasename: string): string {
    if (!content) return fallbackBasename
    const withoutFm: string = content.replace(/^---\n[\s\S]*?\n---\n?/, '')
    const h1: RegExpMatchArray | null = withoutFm.match(/^#\s+(.+)$/m)
    if (h1?.[1]) return h1[1].trim()
    const firstLine: string | undefined = withoutFm.split('\n').map(l => l.trim()).find(l => l.length > 0)
    return firstLine ?? fallbackBasename
}

function lcpOfIds(ids: readonly string[]): string {
    if (ids.length === 0) return ''
    let lcp: string = ids[0]!
    for (const id of ids) {
        while (!id.startsWith(lcp)) {
            lcp = lcp.slice(0, lcp.lastIndexOf('/'))
            if (lcp === '') return ''
        }
    }
    return lcp
}

function relId(absPath: string, vaultRoot: string): string {
    return absPath.startsWith(vaultRoot + '/') ? absPath.slice(vaultRoot.length + 1) : absPath
}

// ── Arboricity: greedy forest decomposition (upper bound) ─────────────────────

class UnionFind {
    private readonly parent: Map<string, string> = new Map()
    private readonly rank: Map<string, number> = new Map()
    find(x: string): string {
        if (!this.parent.has(x)) {this.parent.set(x, x); this.rank.set(x, 0); return x}
        let root: string = x
        while (this.parent.get(root)! !== root) root = this.parent.get(root)!
        let cur: string = x
        while (this.parent.get(cur)! !== cur) {
            const next: string = this.parent.get(cur)!
            this.parent.set(cur, root)
            cur = next
        }
        return root
    }
    union(a: string, b: string): boolean {
        const ra: string = this.find(a)
        const rb: string = this.find(b)
        if (ra === rb) return false
        const rka: number = this.rank.get(ra)!
        const rkb: number = this.rank.get(rb)!
        if (rka < rkb) this.parent.set(ra, rb)
        else if (rka > rkb) this.parent.set(rb, ra)
        else {this.parent.set(rb, ra); this.rank.set(ra, rka + 1)}
        return true
    }
    reset(): void {this.parent.clear(); this.rank.clear()}
}

type ForestCover = {
    readonly forests: readonly (readonly DirectedEdge[])[]
    readonly arboricityUpperBound: number
    readonly densityLowerBound: number
    readonly degeneracy: number
}

function undirectedKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`
}

function greedyForestDecomposition(edges: readonly DirectedEdge[]): readonly (readonly DirectedEdge[])[] {
    // Group by undirected key so that bidirectional pairs (A→B and B→A) travel together.
    // Arboricity is undirected, but rendering must preserve ALL directed copies to be lossless.
    const byUndir: Map<string, DirectedEdge[]> = new Map()
    for (const e of edges) {
        if (e.src === e.tgt) continue
        const k: string = undirectedKey(e.src, e.tgt)
        if (!byUndir.has(k)) byUndir.set(k, [])
        byUndir.get(k)!.push(e)
    }
    type Entry = {readonly rep: DirectedEdge; readonly all: readonly DirectedEdge[]}
    const remaining: Entry[] = [...byUndir.values()].map(all => ({rep: all[0]!, all}))
    const forests: DirectedEdge[][] = []
    while (remaining.length > 0) {
        const uf: UnionFind = new UnionFind()
        const forest: DirectedEdge[] = []
        const leftover: Entry[] = []
        for (const entry of remaining) {
            if (uf.union(entry.rep.src, entry.rep.tgt)) forest.push(...entry.all)
            else leftover.push(entry)
        }
        forests.push(forest)
        remaining.length = 0
        remaining.push(...leftover)
    }
    return forests
}

function computeDegeneracy(edges: readonly DirectedEdge[]): number {
    const adj: Map<string, Set<string>> = new Map()
    for (const e of edges) {
        if (e.src === e.tgt) continue
        if (!adj.has(e.src)) adj.set(e.src, new Set())
        if (!adj.has(e.tgt)) adj.set(e.tgt, new Set())
        adj.get(e.src)!.add(e.tgt)
        adj.get(e.tgt)!.add(e.src)
    }
    const degree: Map<string, number> = new Map()
    for (const [v, nbrs] of adj) degree.set(v, nbrs.size)
    // Bucketed min-degree removal (O(V+E))
    const maxD: number = Math.max(0, ...degree.values())
    const buckets: Set<string>[] = Array.from({length: maxD + 1}, () => new Set())
    for (const [v, d] of degree) buckets[d]!.add(v)
    const removed: Set<string> = new Set()
    let k: number = 0
    let low: number = 0
    while (true) {
        while (low <= maxD && buckets[low]!.size === 0) low++
        if (low > maxD) break
        const v: string = buckets[low]!.values().next().value!
        buckets[low]!.delete(v)
        removed.add(v)
        k = Math.max(k, low)
        for (const nbr of adj.get(v) ?? new Set()) {
            if (removed.has(nbr)) continue
            const d: number = degree.get(nbr)!
            buckets[d]!.delete(nbr)
            degree.set(nbr, d - 1)
            buckets[d - 1]!.add(nbr)
            if (d - 1 < low) low = d - 1
        }
    }
    return k
}

function kCoreDensityLB(edges: readonly DirectedEdge[]): number {
    // LB via max density over all k-cores. For each k from 1..degeneracy,
    // compute |E(k-core)| / (|V(k-core)| - 1) and take ceiling of the max.
    const adj: Map<string, Set<string>> = new Map()
    for (const e of edges) {
        if (e.src === e.tgt) continue
        if (!adj.has(e.src)) adj.set(e.src, new Set())
        if (!adj.has(e.tgt)) adj.set(e.tgt, new Set())
        adj.get(e.src)!.add(e.tgt)
        adj.get(e.tgt)!.add(e.src)
    }
    let bestLB: number = 1
    const degen: number = computeDegeneracy(edges)
    for (let k = 1; k <= degen; k++) {
        // Build k-core by iteratively removing vertices with degree < k
        const local: Map<string, Set<string>> = new Map()
        for (const [v, nbrs] of adj) local.set(v, new Set(nbrs))
        let changed: boolean = true
        while (changed) {
            changed = false
            for (const [v, nbrs] of [...local]) {
                if (nbrs.size < k) {
                    for (const nbr of nbrs) local.get(nbr)?.delete(v)
                    local.delete(v)
                    changed = true
                }
            }
        }
        if (local.size < 2) continue
        let edgeCount: number = 0
        for (const nbrs of local.values()) edgeCount += nbrs.size
        edgeCount /= 2
        const lb: number = Math.ceil(edgeCount / (local.size - 1))
        if (lb > bestLB) bestLB = lb
    }
    return bestLB
}

function computeArboricity(N: number, edges: readonly DirectedEdge[]): ForestCover {
    const undirected: Map<string, DirectedEdge> = new Map()
    for (const e of edges) {
        if (e.src === e.tgt) continue
        const k: string = undirectedKey(e.src, e.tgt)
        if (!undirected.has(k)) undirected.set(k, e)
    }
    const E_und: number = undirected.size
    const wholeGraphLB: number = Math.max(1, Math.ceil(E_und / Math.max(1, N - 1)))
    const kcLB: number = kCoreDensityLB(edges)
    const densityLB: number = Math.max(wholeGraphLB, kcLB)
    const forests: readonly (readonly DirectedEdge[])[] = greedyForestDecomposition(edges)
    return {
        forests,
        arboricityUpperBound: forests.length,
        densityLowerBound: densityLB,
        degeneracy: computeDegeneracy(edges),
    }
}

// ── Rendering: folder spine ───────────────────────────────────────────────────

type TreeNodeSpine = {
    readonly kind: 'virtualFolder' | 'file' | 'folderNote'
    readonly name: string
    readonly absPath: string
    readonly title: string
    readonly children: Map<string, TreeNodeSpine>
}

function buildFolderSpine(state: JsonState, vaultRoot: string): TreeNodeSpine {
    const root: TreeNodeSpine = {kind: 'virtualFolder', name: path.basename(vaultRoot), absPath: vaultRoot, title: '', children: new Map()}
    for (const [absPath, node] of Object.entries(state.graph.nodes)) {
        const rel: string = relId(absPath, vaultRoot)
        const segments: string[] = rel.split('/')
        let cur: TreeNodeSpine = root
        for (let i = 0; i < segments.length - 1; i++) {
            const name: string = segments[i]!
            if (!cur.children.has(name)) {
                cur.children.set(name, {
                    kind: 'virtualFolder',
                    name,
                    absPath: vaultRoot + '/' + segments.slice(0, i + 1).join('/'),
                    title: '',
                    children: new Map(),
                })
            }
            cur = cur.children.get(name)!
        }
        const leafName: string = segments[segments.length - 1]!
        const title: string = deriveTitle(node.contentWithoutYamlOrLinks, path.basename(leafName, '.md'))
        cur.children.set(leafName, {kind: 'file', name: leafName, absPath, title, children: new Map()})
    }
    return root
}

function renderSpine(root: TreeNodeSpine, vaultRoot: string): string {
    const lines: string[] = []
    lines.push(`▢ ${root.name}/`)
    renderSpineChildren(root, [], vaultRoot, lines)
    return lines.join('\n')
}

function renderSpineChildren(node: TreeNodeSpine, indents: boolean[], vaultRoot: string, out: string[]): void {
    const kids: TreeNodeSpine[] = [...node.children.values()]
        .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'virtualFolder' ? -1 : 1))
    for (let i = 0; i < kids.length; i++) {
        const kid: TreeNodeSpine = kids[i]!
        const isLast: boolean = i === kids.length - 1
        const prefix: string = indents.map(p => p ? '│   ' : '    ').join('') + (isLast ? '└── ' : '├── ')
        if (kid.kind === 'virtualFolder') {
            out.push(`${prefix}▢ ${kid.name}/`)
            renderSpineChildren(kid, [...indents, !isLast], vaultRoot, out)
        } else {
            const rel: string = relId(kid.absPath, vaultRoot)
            out.push(`${prefix}· ${kid.title} @[${rel}]`)
        }
    }
}

// ── Rendering: cover forest ───────────────────────────────────────────────────

type CoverForestRender = {
    readonly title: string
    readonly edges: readonly DirectedEdge[]
    readonly text: string
}

function renderCoverForest(index: number, forest: readonly DirectedEdge[], titleOf: Map<string, string>, vaultRoot: string): string {
    // Group by source for co-located rendering: each unique source is a top-level ● block
    // with its outgoing edges from this forest as children.
    const bySource: Map<string, DirectedEdge[]> = new Map()
    const orphanTargets: Map<string, DirectedEdge[]> = new Map()
    for (const e of forest) {
        if (!bySource.has(e.src)) bySource.set(e.src, [])
        bySource.get(e.src)!.push(e)
    }
    // For readability, sort sources by title.
    const sources: string[] = [...bySource.keys()].sort((a, b) => (titleOf.get(a) ?? a).localeCompare(titleOf.get(b) ?? b))
    const lines: string[] = []
    lines.push(`═══ COVER FOREST ${index} (|E|=${forest.length}) ═══`)
    for (const src of sources) {
        const srcTitle: string = titleOf.get(src) ?? path.basename(src, '.md')
        const srcRel: string = relId(src, vaultRoot)
        lines.push(`● ${srcTitle} @[${srcRel}]`)
        const outs: DirectedEdge[] = bySource.get(src)!
        for (let i = 0; i < outs.length; i++) {
            const e: DirectedEdge = outs[i]!
            const isLast: boolean = i === outs.length - 1
            const prefix: string = isLast ? '└── ' : '├── '
            const tgtTitle: string = titleOf.get(e.tgt) ?? path.basename(e.tgt, '.md')
            const tgtRel: string = relId(e.tgt, vaultRoot)
            const labelPart: string = e.label ? ` [${e.label}]` : ''
            lines.push(`${prefix}⇢ ${tgtTitle} @[${tgtRel}]${labelPart}`)
        }
        lines.push('')
    }
    return lines.join('\n')
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
    const jsonPath: string | undefined = process.argv[2]
    const vaultArg: string | undefined = process.argv[3]
    if (!jsonPath) {
        console.error('Usage: L3-BF-192-tree-cover-render.ts <state.json> [<vault-root>]')
        process.exit(2)
    }
    const state: JsonState = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    const ids: string[] = Object.keys(state.graph.nodes)
    const vaultRoot: string = vaultArg ? path.resolve(vaultArg) : lcpOfIds(ids)
    if (!vaultRoot) {
        console.error('Could not infer vault root; pass explicitly as second arg.')
        process.exit(2)
    }

    // Build title map + edge list
    const titleOf: Map<string, string> = new Map()
    const edges: DirectedEdge[] = []
    for (const [id, node] of Object.entries(state.graph.nodes)) {
        titleOf.set(id, deriveTitle(node.contentWithoutYamlOrLinks, path.basename(id, '.md')))
        for (const e of node.outgoingEdges) {
            if (e.targetId === id) continue
            edges.push({src: id, tgt: e.targetId, label: e.label})
        }
    }

    const N: number = ids.length
    const E: number = edges.filter(e => e.src !== e.tgt).length
    // Unique undirected edges (for arboricity)
    const uniqEdges: Map<string, DirectedEdge> = new Map()
    for (const e of edges) {
        if (e.src === e.tgt) continue
        const k: string = undirectedKey(e.src, e.tgt)
        if (!uniqEdges.has(k)) uniqEdges.set(k, e)
    }
    const E_undirected: number = uniqEdges.size
    const cover: ForestCover = computeArboricity(N, edges)

    // ─── Report ──────────────────────────────────────────────────
    const reportLines: string[] = []
    reportLines.push('═══ L3-BF-192 arboricity report ═══')
    reportLines.push(`vault_root      : ${vaultRoot}`)
    reportLines.push(`nodes N         : ${N}`)
    reportLines.push(`edges E (directed, non-self): ${E}`)
    reportLines.push(`edges undirected (unique): ${E_undirected}`)
    reportLines.push(`density E/(N-1) : ${(E_undirected / Math.max(1, N - 1)).toFixed(3)}`)
    reportLines.push(`Nash-Williams LB: ${cover.densityLowerBound}   (max density over k-cores)`)
    reportLines.push(`greedy forests  : ${cover.arboricityUpperBound}   (upper bound)`)
    reportLines.push(`degeneracy      : ${cover.degeneracy}   (a(G) ≤ degeneracy)`)
    reportLines.push('')
    const classify = (a: number): string =>
        a <= 1 ? 'pure tree' : a <= 2 ? 'sparse cross-links' : a <= 5 ? 'zettelkasten' : 'spiderweb'
    reportLines.push(`classification  : ${classify(cover.arboricityUpperBound)}`)
    reportLines.push('')

    // ─── Rendering ───────────────────────────────────────────────
    const spineText: string = renderSpine(buildFolderSpine(state, vaultRoot), vaultRoot)
    const coverTexts: string[] = cover.forests.map((f, i) => renderCoverForest(i + 1, f, titleOf, vaultRoot))

    const out: string[] = []
    out.push(reportLines.join('\n'))
    out.push('═══ SPINE (folder hierarchy, no content edges) ═══')
    out.push(spineText)
    out.push('')
    for (const t of coverTexts) {out.push(t); out.push('')}

    process.stdout.write(out.join('\n'))
    process.stdout.write('\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main()
}

export {
    greedyForestDecomposition,
    computeArboricity,
    computeDegeneracy,
    undirectedKey,
    deriveTitle,
    relId,
    lcpOfIds,
    buildFolderSpine,
    renderSpine,
    renderCoverForest,
}
export type {DirectedEdge, JsonState, JsonNode, TreeNodeSpine, ForestCover}

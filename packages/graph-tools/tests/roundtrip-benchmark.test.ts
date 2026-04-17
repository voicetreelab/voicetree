/**
 * BF-198: Roundtrip-fidelity CI harness.
 * Fixture vaults at a(G)=1,2,3,5,8; 5 formats; Jaccard fidelity thresholds.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

import {ensureSyntheticFixtures} from '../scripts/L3-BF-193-generate-fixtures'
import {
    buildFolderSpine,
    computeArboricity,
    deriveTitle,
    relId,
    renderCoverForest,
    renderSpine,
    type DirectedEdge,
    type JsonState,
} from '../scripts/L3-BF-192-tree-cover-render'
import {parseTreeCover} from '../scripts/L3-BF-192-tree-cover-parse'
import {parseAscii} from '../scripts/L3-BF-191-ascii-parser'
import {buildRecursiveAscii} from '../scripts/L3-BF-194-recursive-ascii'
import {parseRecursiveAscii} from '../scripts/L3-BF-194-recursive-parser'
import {renderGraphView} from '../src/viewGraph'
import {
    buildUniqueBasenameMap,
    extractLinks,
    getNodeId,
    resolveLinkTarget,
    scanMarkdownFiles,
    type StructureNode,
} from '../src/primitives'

const VAULTS_ROOT = new URL('fixtures/roundtrip-vaults', import.meta.url).pathname
const CSV_OUT = path.join(VAULTS_ROOT, '.last-benchmark.csv')

// ── Types ─────────────────────────────────────────────────────────────────────

type FixtureState = {
    readonly vaultRoot: string
    readonly state: JsonState
    readonly arboricity: number
    readonly groundTruthEdges: Set<string>  // srcViewId|tgtViewId (no .md)
    readonly groundTruthNodes: Set<string>  // viewId (no .md)
    readonly titleToViewId: Map<string, string>
}

type CsvRow = {
    fixture: string
    arboricity: number
    format: string
    edgeFidelity: number
    nodeFidelity: number
    tokenCost: number
    threshold: number
}

type RoundtripResult = {
    parsedEdges: Set<string>
    parsedNodes: Set<string>
    tokenCost: number
}

type TestCase = {fixtureName: string; format: string; threshold: number}

// ── Constants ─────────────────────────────────────────────────────────────────

const THRESHOLDS: Record<string, number> = {
    'tree-cover': 0.98,
    'ASCII-lossy': 0.60,
    'recursive-ASCII': 0.85,
    'mermaid': 0.98,
    'edge-list': 1.0,
}

const FIXTURE_NAMES = [
    'synthetic-a1-tree',
    'synthetic-a2-cycle',
    'synthetic-k5-core',
    'synthetic-k9-core',
    'synthetic-k15-core',
]

const TEST_CASES: TestCase[] = FIXTURE_NAMES.flatMap(fixtureName =>
    Object.entries(THRESHOLDS).map(([format, threshold]) => ({fixtureName, format, threshold}))
)

// ── Shared mutable state ───────────────────────────────────────────────────────

const fixtureStates = new Map<string, FixtureState>()
const csvRows: CsvRow[] = []

// ── State building from disk ──────────────────────────────────────────────────

function buildJsonStateFromDisk(vaultRoot: string): JsonState {
    const root = path.resolve(vaultRoot)
    const mdFiles = scanMarkdownFiles(root)
    const contentByViewId = new Map<string, string>()
    for (const absPath of mdFiles) {
        contentByViewId.set(getNodeId(root, absPath), fs.readFileSync(absPath, 'utf-8'))
    }
    const nodesById = new Map<string, StructureNode>(
        [...contentByViewId.keys()].map(id => [id, {id, title: id, outgoingIds: []}])
    )
    const uniqueBasenames = buildUniqueBasenameMap(nodesById)
    const nodes: Record<string, {
        absoluteFilePathIsID: string
        contentWithoutYamlOrLinks: string
        outgoingEdges: Array<{targetId: string}>
    }> = {}
    for (const [viewId, content] of contentByViewId) {
        const absPath = path.join(root, viewId + '.md')
        const links = extractLinks(content)
        const outgoingEdges: Array<{targetId: string}> = []
        for (const link of links) {
            const targetViewId = resolveLinkTarget(link, viewId, nodesById, uniqueBasenames)
            if (targetViewId && targetViewId !== viewId) {
                outgoingEdges.push({targetId: path.join(root, targetViewId + '.md')})
            }
        }
        nodes[absPath] = {absoluteFilePathIsID: absPath, contentWithoutYamlOrLinks: content, outgoingEdges}
    }
    return {graph: {nodes}}
}

// ── Ground-truth helpers ──────────────────────────────────────────────────────

function edgeSetFromState(state: JsonState, vaultRoot: string): Set<string> {
    const edges = new Set<string>()
    for (const [srcAbs, node] of Object.entries(state.graph.nodes)) {
        const src = relId(srcAbs, vaultRoot).replace(/\.md$/i, '')
        for (const e of node.outgoingEdges) {
            if (e.targetId === srcAbs) continue
            const tgt = relId(e.targetId, vaultRoot).replace(/\.md$/i, '')
            edges.add(`${src}|${tgt}`)
        }
    }
    return edges
}

function nodeSetFromState(state: JsonState, vaultRoot: string): Set<string> {
    return new Set(Object.keys(state.graph.nodes).map(abs => relId(abs, vaultRoot).replace(/\.md$/i, '')))
}

function buildTitleToViewId(state: JsonState, vaultRoot: string): Map<string, string> {
    const map = new Map<string, string>()
    for (const [absPath, node] of Object.entries(state.graph.nodes)) {
        const viewId = relId(absPath, vaultRoot).replace(/\.md$/i, '')
        const title = deriveTitle(node.contentWithoutYamlOrLinks, path.basename(absPath, '.md'))
        map.set(title, viewId)
    }
    return map
}

// ── Fidelity metric ───────────────────────────────────────────────────────────

function jaccard(parsed: Set<string>, truth: Set<string>): number {
    if (truth.size === 0 && parsed.size === 0) return 1.0
    let intersection = 0
    for (const e of truth) {
        if (parsed.has(e)) intersection++
    }
    const union = truth.size + parsed.size - intersection
    return union === 0 ? 1.0 : intersection / union
}

// ── Format round-trippers ─────────────────────────────────────────────────────

function roundtripTreeCover(fixture: FixtureState): RoundtripResult {
    const {state, vaultRoot} = fixture
    const titleOf = new Map<string, string>()
    const edges: DirectedEdge[] = []
    for (const [id, node] of Object.entries(state.graph.nodes)) {
        titleOf.set(id, deriveTitle(node.contentWithoutYamlOrLinks, path.basename(id, '.md')))
        for (const e of node.outgoingEdges) {
            if (e.targetId !== id) edges.push({src: id, tgt: e.targetId})
        }
    }
    const cover = computeArboricity(Object.keys(state.graph.nodes).length, edges)
    const spineText = renderSpine(buildFolderSpine(state, vaultRoot), vaultRoot)
    const coverTexts = cover.forests.map((f, i) => renderCoverForest(i + 1, f, titleOf, vaultRoot))
    const rendered = [
        '═══ SPINE (folder hierarchy, no content edges) ═══',
        spineText, '',
        ...coverTexts.flatMap(t => [t, '']),
    ].join('\n')
    const parsed = parseTreeCover(rendered)
    const parsedEdges = new Set(
        parsed.edges.map(e => `${e.src.replace(/\.md$/i, '')}|${e.tgt.replace(/\.md$/i, '')}`)
    )
    const parsedNodes = new Set([...parsed.spineFileIds].map(id => id.replace(/\.md$/i, '')))
    return {parsedEdges, parsedNodes, tokenCost: rendered.length}
}

function roundtripAsciiLossy(fixture: FixtureState): RoundtripResult {
    const {vaultRoot} = fixture
    const rendered = renderGraphView(vaultRoot, {format: 'ascii'})
    const parsed = parseAscii(rendered.output)
    const parsedEdges = new Set(
        parsed.footerEdges.filter(e => !e.unresolved).map(e => `${e.srcId}|${e.targetId}`)
    )
    const parsedNodes = new Set<string>()
    for (const e of parsed.footerEdges) {
        if (!e.unresolved) {
            parsedNodes.add(e.srcId)
            parsedNodes.add(e.targetId)
        }
    }
    return {parsedEdges, parsedNodes, tokenCost: rendered.output.length}
}

function roundtripRecursiveAscii(fixture: FixtureState): RoundtripResult {
    const {state, vaultRoot} = fixture
    const rendered = buildRecursiveAscii(state, vaultRoot, {
        maxInlineEdges: 5, maxInlineNodes: Number.POSITIVE_INFINITY, maxDepth: 3,
    })
    const parsed = parseRecursiveAscii(rendered.text)
    const parsedEdges = new Set(
        parsed.edges
            .filter(e => !e.unresolved)
            .map(e => `${e.src.replace(/\.md$/i, '')}|${e.target.replace(/\.md$/i, '')}`)
    )
    const parsedNodes = new Set([...parsed.nodeToFragment.keys()].map(id => id.replace(/\.md$/i, '')))
    return {parsedEdges, parsedNodes, tokenCost: rendered.text.length}
}

function roundtripMermaid(fixture: FixtureState): RoundtripResult {
    const {vaultRoot, titleToViewId} = fixture
    const rendered = renderGraphView(vaultRoot, {format: 'mermaid'})
    const idToTitle = new Map<string, string>()
    const parsedEdges = new Set<string>()
    const parsedNodes = new Set<string>()
    for (const line of rendered.output.split('\n')) {
        const t = line.trim()
        if (t.startsWith('subgraph ')) continue
        const nodeM = t.match(/^(n\d+(?:__self)?)\["(.+)"\]$/)
        if (nodeM) {
            idToTitle.set(nodeM[1]!, nodeM[2]!)
            const viewId = titleToViewId.get(nodeM[2]!)
            if (viewId) parsedNodes.add(viewId)
            continue
        }
        const edgeM = t.match(/^(n\d+) -\.-> (n\d+)$/)
        if (edgeM) {
            const srcTitle = idToTitle.get(edgeM[1]!)
            const tgtTitle = idToTitle.get(edgeM[2]!)
            if (srcTitle && tgtTitle) {
                const srcId = titleToViewId.get(srcTitle)
                const tgtId = titleToViewId.get(tgtTitle)
                if (srcId && tgtId) parsedEdges.add(`${srcId}|${tgtId}`)
            }
        }
    }
    return {parsedEdges, parsedNodes, tokenCost: rendered.output.length}
}

function roundtripEdgeList(fixture: FixtureState): RoundtripResult {
    const {state, vaultRoot} = fixture
    type EdgeEntry = {src: string; tgt: string}
    const edgeList: EdgeEntry[] = []
    for (const [srcAbs, node] of Object.entries(state.graph.nodes)) {
        const src = relId(srcAbs, vaultRoot).replace(/\.md$/i, '')
        for (const e of node.outgoingEdges) {
            if (e.targetId === srcAbs) continue
            edgeList.push({src, tgt: relId(e.targetId, vaultRoot).replace(/\.md$/i, '')})
        }
    }
    const rendered = JSON.stringify(edgeList)
    const reparsed = JSON.parse(rendered) as EdgeEntry[]
    const parsedEdges = new Set(reparsed.map(e => `${e.src}|${e.tgt}`))
    const parsedNodes = new Set<string>()
    for (const e of reparsed) {
        parsedNodes.add(e.src)
        parsedNodes.add(e.tgt)
    }
    return {parsedEdges, parsedNodes, tokenCost: rendered.length}
}

function doRoundtrip(fixture: FixtureState, format: string): RoundtripResult {
    if (format === 'tree-cover') return roundtripTreeCover(fixture)
    if (format === 'ASCII-lossy') return roundtripAsciiLossy(fixture)
    if (format === 'recursive-ASCII') return roundtripRecursiveAscii(fixture)
    if (format === 'mermaid') return roundtripMermaid(fixture)
    return roundtripEdgeList(fixture)
}

// ── Test suite ─────────────────────────────────────────────────────────────────

beforeAll(() => {
    fs.mkdirSync(VAULTS_ROOT, {recursive: true})
    const generated = ensureSyntheticFixtures(VAULTS_ROOT)
    for (const fixture of generated) {
        const state = buildJsonStateFromDisk(fixture.root)
        fixtureStates.set(fixture.name, {
            vaultRoot: fixture.root,
            state,
            arboricity: fixture.expectedArboricity,
            groundTruthEdges: edgeSetFromState(state, fixture.root),
            groundTruthNodes: nodeSetFromState(state, fixture.root),
            titleToViewId: buildTitleToViewId(state, fixture.root),
        })
    }
})

afterAll(() => {
    const header = 'fixture,arboricity,format,edge_fidelity,node_fidelity,token_cost,threshold'
    const rows = csvRows.map(r =>
        [r.fixture, r.arboricity, r.format,
            r.edgeFidelity.toFixed(4), r.nodeFidelity.toFixed(4),
            r.tokenCost, r.threshold].join(',')
    )
    fs.writeFileSync(CSV_OUT, [header, ...rows].join('\n') + '\n', 'utf-8')
})

describe('roundtrip-fidelity', () => {
    it.each(TEST_CASES)('$fixtureName × $format (threshold=$threshold)', ({fixtureName, format, threshold}) => {
        const fixture = fixtureStates.get(fixtureName)
        expect(fixture, `fixture "${fixtureName}" not loaded in beforeAll`).toBeDefined()
        if (!fixture) return

        const result = doRoundtrip(fixture, format)
        const edgeFidelity = jaccard(result.parsedEdges, fixture.groundTruthEdges)
        const nodeFidelity = jaccard(result.parsedNodes, fixture.groundTruthNodes)

        expect(result.tokenCost).toBeGreaterThan(0)
        csvRows.push({fixture: fixtureName, arboricity: fixture.arboricity, format, edgeFidelity, nodeFidelity, tokenCost: result.tokenCost, threshold})

        if (edgeFidelity < threshold) {
            console.log(
                `[FAIL] ${fixtureName} × ${format}: edge_fidelity=${edgeFidelity.toFixed(4)} < ${threshold}` +
                ` (delta=${(threshold - edgeFidelity).toFixed(4)})` +
                ` truth=${fixture.groundTruthEdges.size} parsed=${result.parsedEdges.size}`
            )
        }
        expect(edgeFidelity, `${fixtureName} × ${format}: fidelity=${edgeFidelity.toFixed(4)} threshold=${threshold}`).toBeGreaterThanOrEqual(threshold)
    })
})

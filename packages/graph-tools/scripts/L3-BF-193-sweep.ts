#!/usr/bin/env node --import tsx

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {parseAscii} from './L3-BF-191-ascii-parser.ts'
import {parseTreeCover} from './L3-BF-192-tree-cover-parse.ts'
import {computeArboricity, relId, type DirectedEdge, type JsonState} from './L3-BF-192-tree-cover-render.ts'
import {DEFAULT_FIXTURES_ROOT, DEFAULT_SEED, ensureSyntheticFixtures, type GeneratedFixture} from './L3-BF-193-generate-fixtures.ts'

type JsonNodeInfo = {
    readonly absId: string
    readonly viewId: string
    readonly key: string
    readonly title: string
}

type JsonEdgeInfo = {
    readonly srcViewId: string
    readonly srcKey: string
    readonly srcTitle: string
    readonly targetResolved: boolean
    readonly targetViewId: string | null
    readonly targetKey: string
    readonly targetTitle: string
    readonly targetRaw: string
}

type SweepFixture = {
    readonly name: string
    readonly root: string
    readonly description: string
}

type SweepRow = {
    readonly vault: string
    readonly a_G: number
    readonly n_nodes: number
    readonly n_edges: number
    readonly format: 'A' | 'B' | 'C' | 'E'
    readonly tokens: number
    readonly node_fidelity: number
    readonly edge_fidelity: number
    readonly co_location_mean: number
}

type MermaidNode = {readonly key: string; readonly line: number}

const SCRIPT_DIR: string = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = path.resolve(SCRIPT_DIR, '../../..')
const VT_GRAPH_BIN: string = path.join(REPO_ROOT, 'node_modules/.bin/vt-graph')
const CSV_OUT: string = path.join(REPO_ROOT, 'packages/graph-tools/scripts/L3-BF-193-sweep-results.csv')
const TREE_COVER_SCRIPT: string = path.join(REPO_ROOT, 'packages/graph-tools/scripts/L3-BF-192-tree-cover-render.ts')

function toAbsoluteRoot(root: string): string {
    return path.isAbsolute(root) ? root : path.join(REPO_ROOT, root)
}

function runCommand(command: string, args: readonly string[]): string {
    return execFileSync(command, args, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    })
}

function dumpState(vaultRoot: string, outPath: string): JsonState {
    runCommand(VT_GRAPH_BIN, ['state', 'dump', vaultRoot, '--no-pretty', '--out', outPath])
    return JSON.parse(fs.readFileSync(outPath, 'utf8')) as JsonState
}

function stripCrossLinksFooter(text: string): string {
    const marker: string = '\n[Cross-Links]\n'
    const markerIndex: number = text.indexOf(marker)
    if (markerIndex < 0) return text
    return `${text.slice(0, markerIndex).trimEnd()}\n`
}

function renderFormat(format: 'A' | 'B' | 'C' | 'E', vaultRoot: string, statePath: string): string {
    if (format === 'A') return stripCrossLinksFooter(runCommand(VT_GRAPH_BIN, ['view', vaultRoot]))
    if (format === 'B') return runCommand(VT_GRAPH_BIN, ['view', vaultRoot, '--mermaid'])
    if (format === 'C') return runCommand(VT_GRAPH_BIN, ['view', vaultRoot])
    return runCommand('npx', ['tsx', TREE_COVER_SCRIPT, statePath, vaultRoot])
}

function deriveTitle(content: string, fallbackBasename: string): string {
    const withoutFm: string = content.replace(/^---\n[\s\S]*?\n---\n?/u, '')
    const h1: RegExpMatchArray | null = withoutFm.match(/^#\s+(.+)$/mu)
    if (h1?.[1]) return h1[1].trim()
    const firstLine: string | undefined = withoutFm.split('\n').map(line => line.trim()).find(Boolean)
    return firstLine ?? fallbackBasename
}

function titleForJsonNode(absId: string): string {
    try {
        return deriveTitle(fs.readFileSync(absId, 'utf8'), path.basename(absId, '.md'))
    } catch {
        return path.basename(absId, '.md')
    }
}

function toViewId(rootPrefix: string, absId: string): string {
    const relative: string = absId.startsWith(rootPrefix + '/') ? absId.slice(rootPrefix.length + 1) : absId
    return relative.replace(/\\/gu, '/').replace(/\.md$/iu, '')
}

function keyForViewId(viewId: string, title: string): string {
    const folder: string = path.posix.dirname(viewId) === '.' ? '' : path.posix.dirname(viewId)
    return `${folder}::${title}`
}

function buildJsonNodeInfo(
    state: JsonState,
    rootPrefix: string,
): {readonly nodes: readonly JsonNodeInfo[]; readonly nodeKeys: ReadonlySet<string>; readonly nodesByAbsId: ReadonlyMap<string, JsonNodeInfo>; readonly nodesByViewId: ReadonlyMap<string, JsonNodeInfo>} {
    const nodes: JsonNodeInfo[] = []
    const nodeKeys: Set<string> = new Set()
    const nodesByAbsId: Map<string, JsonNodeInfo> = new Map()
    const nodesByViewId: Map<string, JsonNodeInfo> = new Map()
    for (const absId of Object.keys(state.graph.nodes)) {
        const viewId: string = toViewId(rootPrefix, absId)
        const title: string = titleForJsonNode(absId)
        const key: string = keyForViewId(viewId, title)
        const info: JsonNodeInfo = {absId, viewId, key, title}
        nodes.push(info)
        nodeKeys.add(key)
        nodesByAbsId.set(absId, info)
        nodesByViewId.set(viewId, info)
    }
    return {nodes, nodeKeys, nodesByAbsId, nodesByViewId}
}

function buildJsonEdges(state: JsonState, nodesByAbsId: ReadonlyMap<string, JsonNodeInfo>): JsonEdgeInfo[] {
    const edges: JsonEdgeInfo[] = []
    for (const [srcId, node] of Object.entries(state.graph.nodes)) {
        const srcInfo: JsonNodeInfo | undefined = nodesByAbsId.get(srcId)
        if (!srcInfo) continue
        for (const edge of node.outgoingEdges) {
            if (edge.targetId === srcId) continue
            const targetInfo: JsonNodeInfo | undefined = nodesByAbsId.get(edge.targetId)
            edges.push({
                srcViewId: srcInfo.viewId,
                srcKey: srcInfo.key,
                srcTitle: srcInfo.title,
                targetResolved: targetInfo !== undefined,
                targetViewId: targetInfo?.viewId ?? null,
                targetKey: targetInfo?.key ?? `UNRESOLVED::${edge.targetId}`,
                targetTitle: targetInfo?.title ?? edge.targetId,
                targetRaw: edge.targetId,
            })
        }
    }
    return edges
}

function mean(values: readonly number[]): number {
    if (values.length === 0) return 0
    return values.reduce((sum, value) => sum + value, 0) / values.length
}

function median(values: readonly number[]): number {
    if (values.length === 0) return 0
    const sorted: number[] = [...values].sort((left, right) => left - right)
    const middle: number = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
}

function scoreLegacyEdges(jsonEdges: readonly JsonEdgeInfo[], inlineEdges: readonly {srcTitle: string; targetTitle: string}[]): number {
    const parsedCounts: Map<string, number> = new Map()
    for (const edge of inlineEdges) {
        const key: string = `${edge.srcTitle}|||${edge.targetTitle}`
        parsedCounts.set(key, (parsedCounts.get(key) ?? 0) + 1)
    }
    let matched: number = 0
    for (const edge of jsonEdges) {
        const key: string = `${edge.srcTitle}|||${edge.targetTitle}`
        const count: number = parsedCounts.get(key) ?? 0
        if (count === 0) continue
        matched += 1
        parsedCounts.set(key, count - 1)
    }
    return jsonEdges.length > 0 ? (matched / jsonEdges.length) * 100 : 100
}

function scoreFooterEdges(jsonEdges: readonly JsonEdgeInfo[], footerEdges: readonly {srcId: string; targetId: string; unresolved: boolean}[]): number {
    const parsedCounts: Map<string, number> = new Map()
    for (const edge of footerEdges) {
        const key: string = `${edge.srcId}|||${edge.unresolved ? '?' + edge.targetId : edge.targetId}`
        parsedCounts.set(key, (parsedCounts.get(key) ?? 0) + 1)
    }
    let matched: number = 0
    for (const edge of jsonEdges) {
        const footerTarget: string = edge.targetResolved ? edge.targetViewId! : `?${edge.targetRaw}`
        const key: string = `${edge.srcViewId}|||${footerTarget}`
        const count: number = parsedCounts.get(key) ?? 0
        if (count === 0) continue
        matched += 1
        parsedCounts.set(key, count - 1)
    }
    return jsonEdges.length > 0 ? (matched / jsonEdges.length) * 100 : 100
}

function scoreAsciiFormat(text: string, jsonInfo: ReturnType<typeof buildJsonNodeInfo>, jsonEdges: readonly JsonEdgeInfo[], format: 'A' | 'C'): {readonly nodeFidelity: number; readonly edgeFidelity: number; readonly coLocationMean: number} {
    const parsed = parseAscii(text)
    const asciiNodeKeys: Set<string> = new Set()
    for (const node of parsed.nodes) {
        if (node.kind === 'virtualFolder') continue
        asciiNodeKeys.add(`${node.folderPath}::${node.title}`)
    }
    let nodesInBoth: number = 0
    for (const key of jsonInfo.nodeKeys) if (asciiNodeKeys.has(key)) nodesInBoth += 1
    const nodeFidelity: number = jsonInfo.nodeKeys.size > 0 ? (nodesInBoth / jsonInfo.nodeKeys.size) * 100 : 100

    if (format === 'A') {
        return {
            nodeFidelity,
            edgeFidelity: scoreLegacyEdges(jsonEdges, parsed.inlineEdges),
            coLocationMean: 0,
        }
    }

    const lineForViewId = (viewId: string): number | undefined => {
        const info: JsonNodeInfo | undefined = jsonInfo.nodesByViewId.get(viewId)
        if (!info) return undefined
        for (const node of parsed.nodes) {
            if (node.kind === 'virtualFolder') continue
            if (`${node.folderPath}::${node.title}` === info.key) return node.line
        }
        return undefined
    }

    const footerDistances: number[] = []
    if (parsed.footerStartLine !== null) {
        for (const edge of parsed.footerEdges) {
            const sourceLine: number | undefined = lineForViewId(edge.srcId)
            if (sourceLine !== undefined) footerDistances.push(parsed.footerStartLine - sourceLine)
        }
    }

    return {
        nodeFidelity,
        edgeFidelity: scoreFooterEdges(jsonEdges, parsed.footerEdges),
        coLocationMean: median(footerDistances),
    }
}

function scoreTreeCoverFormat(text: string, state: JsonState, vaultRoot: string): {readonly nodeFidelity: number; readonly edgeFidelity: number} {
    const parsed = parseTreeCover(text)
    const jsonNodeIds: Set<string> = new Set(Object.keys(state.graph.nodes).map(id => relId(id, vaultRoot)))
    const jsonEdges: Set<string> = new Set()
    for (const [srcAbs, node] of Object.entries(state.graph.nodes)) {
        const src: string = relId(srcAbs, vaultRoot)
        for (const edge of node.outgoingEdges) {
            if (edge.targetId === srcAbs) continue
            jsonEdges.add(`${src}|${relId(edge.targetId, vaultRoot)}`)
        }
    }

    const reconstructedNodes: Set<string> = new Set(parsed.spineFileIds)
    const reconstructedEdges: Set<string> = new Set()
    for (const edge of parsed.edges) {
        reconstructedNodes.add(edge.src)
        reconstructedNodes.add(edge.tgt)
        reconstructedEdges.add(`${edge.src}|${edge.tgt}`)
    }

    let nodesCovered: number = 0
    for (const id of jsonNodeIds) if (reconstructedNodes.has(id)) nodesCovered += 1
    let edgesCovered: number = 0
    for (const edge of jsonEdges) if (reconstructedEdges.has(edge)) edgesCovered += 1

    return {
        nodeFidelity: jsonNodeIds.size > 0 ? (nodesCovered / jsonNodeIds.size) * 100 : 100,
        edgeFidelity: jsonEdges.size > 0 ? (edgesCovered / jsonEdges.size) * 100 : 100,
    }
}

function parseMermaid(text: string): {readonly nodeKeys: ReadonlySet<string>; readonly nodesById: ReadonlyMap<string, MermaidNode>; readonly edgeDistances: readonly number[]; readonly edgeFidelity: number} {
    const folderStack: string[] = []
    const nodeKeys: Set<string> = new Set()
    const nodesById: Map<string, MermaidNode> = new Map()
    const rawEdges: Array<{srcId: string; tgtId: string; line: number}> = []
    const lines: string[] = text.split('\n')
    const subgraphRe: RegExp = /^\s*subgraph\s+\S+\["📁 (.+?)\/(?:\s+—.*)?"\]\s*$/u
    const nodeRe: RegExp = /^\s*(n\d+)\["(.+)"\]\s*$/u
    const edgeRe: RegExp = /^\s*(n\d+)\s+[-.=]+>\s+(n\d+)\s*$/u

    for (let line = 0; line < lines.length; line++) {
        const raw: string = lines[line]!
        const subgraphMatch: RegExpMatchArray | null = raw.match(subgraphRe)
        if (subgraphMatch?.[1]) {
            folderStack.push(subgraphMatch[1].trim())
            continue
        }
        if (/^\s*end\s*$/u.test(raw)) {
            folderStack.pop()
            continue
        }
        const nodeMatch: RegExpMatchArray | null = raw.match(nodeRe)
        if (nodeMatch?.[1] && nodeMatch?.[2]) {
            const key: string = `${folderStack.join('/')}::${nodeMatch[2]}`
            nodeKeys.add(key)
            nodesById.set(nodeMatch[1], {key, line})
            continue
        }
        const edgeMatch: RegExpMatchArray | null = raw.match(edgeRe)
        if (edgeMatch?.[1] && edgeMatch?.[2]) rawEdges.push({srcId: edgeMatch[1], tgtId: edgeMatch[2], line})
    }

    return {
        nodeKeys,
        nodesById,
        edgeDistances: rawEdges
            .map(edge => {
                const source: MermaidNode | undefined = nodesById.get(edge.srcId)
                return source ? Math.abs(edge.line - source.line) : null
            })
            .filter((value): value is number => value !== null),
        edgeFidelity: 0,
    }
}

function scoreMermaidFormat(text: string, jsonInfo: ReturnType<typeof buildJsonNodeInfo>, jsonEdges: readonly JsonEdgeInfo[]): {readonly nodeFidelity: number; readonly edgeFidelity: number; readonly coLocationMean: number} {
    const parsed = parseMermaid(text)
    let nodesInBoth: number = 0
    for (const key of jsonInfo.nodeKeys) if (parsed.nodeKeys.has(key)) nodesInBoth += 1

    const lines: string[] = text.split('\n')
    const edgeRe: RegExp = /^\s*(n\d+)\s+[-.=]+>\s+(n\d+)\s*$/u
    const parsedCounts: Map<string, number> = new Map()
    for (let index = 0; index < lines.length; index++) {
        const match: RegExpMatchArray | null = lines[index]!.match(edgeRe)
        if (!match?.[1] || !match?.[2]) continue
        const source: MermaidNode | undefined = parsed.nodesById.get(match[1])
        const target: MermaidNode | undefined = parsed.nodesById.get(match[2])
        if (!source || !target) continue
        const key: string = `${source.key}|||${target.key}`
        parsedCounts.set(key, (parsedCounts.get(key) ?? 0) + 1)
    }

    let matched: number = 0
    for (const edge of jsonEdges) {
        const key: string = `${edge.srcKey}|||${edge.targetKey}`
        const count: number = parsedCounts.get(key) ?? 0
        if (count === 0) continue
        matched += 1
        parsedCounts.set(key, count - 1)
    }

    return {
        nodeFidelity: jsonInfo.nodeKeys.size > 0 ? (nodesInBoth / jsonInfo.nodeKeys.size) * 100 : 100,
        edgeFidelity: jsonEdges.length > 0 ? (matched / jsonEdges.length) * 100 : 100,
        coLocationMean: mean(parsed.edgeDistances),
    }
}

function approximateTokens(text: string): number {
    return Math.round(Array.from(text).length / 4)
}

function csvLine(row: SweepRow): string {
    return [
        row.vault,
        String(row.a_G),
        String(row.n_nodes),
        String(row.n_edges),
        row.format,
        String(row.tokens),
        row.node_fidelity.toFixed(1),
        row.edge_fidelity.toFixed(1),
        row.co_location_mean.toFixed(1),
    ].join(',')
}

function measureFixture(fixture: SweepFixture, tempDir: string): readonly SweepRow[] {
    const absRoot: string = toAbsoluteRoot(fixture.root)
    const safeName: string = fixture.name.replace(/[^a-zA-Z0-9_.-]+/gu, '_')
    const statePath: string = path.join(tempDir, `${safeName}-state.json`)
    const state: JsonState = dumpState(absRoot, statePath)
    const jsonInfo = buildJsonNodeInfo(state, absRoot)
    const jsonEdges: JsonEdgeInfo[] = buildJsonEdges(state, jsonInfo.nodesByAbsId)
    const directedEdges: DirectedEdge[] = []
    for (const [srcId, node] of Object.entries(state.graph.nodes)) {
        for (const edge of node.outgoingEdges) {
            if (edge.targetId === srcId) continue
            directedEdges.push({src: srcId, tgt: edge.targetId, label: edge.label})
        }
    }
    const a_G: number = computeArboricity(jsonInfo.nodes.length, directedEdges).arboricityUpperBound
    const baseRow = {vault: fixture.name, a_G, n_nodes: jsonInfo.nodes.length, n_edges: jsonEdges.length}

    return (['A', 'C', 'E', 'B'] as const).map(format => {
        const text: string = renderFormat(format, absRoot, statePath)
        if (format === 'E') {
            const scored = scoreTreeCoverFormat(text, state, absRoot)
            return {
                ...baseRow,
                format,
                tokens: approximateTokens(text),
                node_fidelity: scored.nodeFidelity,
                edge_fidelity: scored.edgeFidelity,
                co_location_mean: 0,
            }
        }
        if (format === 'B') {
            const scored = scoreMermaidFormat(text, jsonInfo, jsonEdges)
            return {
                ...baseRow,
                format,
                tokens: approximateTokens(text),
                node_fidelity: scored.nodeFidelity,
                edge_fidelity: scored.edgeFidelity,
                co_location_mean: scored.coLocationMean,
            }
        }
        const scored = scoreAsciiFormat(text, jsonInfo, jsonEdges, format)
        return {
            ...baseRow,
            format,
            tokens: approximateTokens(text),
            node_fidelity: scored.nodeFidelity,
            edge_fidelity: scored.edgeFidelity,
            co_location_mean: scored.coLocationMean,
        }
    })
}

function main(): void {
    let fixturesRoot: string = DEFAULT_FIXTURES_ROOT
    let seed: number = DEFAULT_SEED
    let csvOut: string = CSV_OUT

    for (let index = 2; index < process.argv.length; index++) {
        const arg: string = process.argv[index]!
        if (arg === '--fixtures-root') {
            fixturesRoot = path.resolve(process.argv[++index] ?? fixturesRoot)
            continue
        }
        if (arg === '--seed') {
            seed = Number(process.argv[++index] ?? seed)
            continue
        }
        if (arg === '--csv-out') {
            csvOut = path.resolve(process.argv[++index] ?? csvOut)
        }
    }

    const syntheticFixtures: readonly GeneratedFixture[] = ensureSyntheticFixtures(fixturesRoot, seed)
    const fixtures: readonly SweepFixture[] = [
        {name: 'brain/knowledge/world-model', root: 'brain/knowledge/world-model', description: 'Real vault anchor from BF-192.'},
        ...syntheticFixtures.map(fixture => ({name: fixture.name, root: fixture.root, description: fixture.description})),
    ]

    const tempDir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'bf193-sweep-'))
    const rows: SweepRow[] = fixtures.flatMap(fixture => measureFixture(fixture, tempDir))
    rows.sort((left, right) => left.a_G - right.a_G || left.vault.localeCompare(right.vault) || left.format.localeCompare(right.format))

    const csv: string = [
        'vault,a_G,n_nodes,n_edges,format,tokens,node_fidelity,edge_fidelity,co_location_mean',
        ...rows.map(csvLine),
    ].join('\n') + '\n'

    fs.writeFileSync(csvOut, csv, 'utf8')
    console.log(`Wrote ${rows.length} rows to ${csvOut}`)
    for (const fixture of fixtures) {
        const fixtureRows: SweepRow[] = rows.filter(row => row.vault === fixture.name)
        const edgeSummary: string = fixtureRows.map(row => `${row.format}:${row.edge_fidelity.toFixed(1)}%`).join(' ')
        console.log(`- ${fixture.name} a=${fixtureRows[0]?.a_G ?? 'n/a'} edges=${fixtureRows[0]?.n_edges ?? 'n/a'} ${edgeSummary}`)
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main()
}

import * as fs from 'node:fs'
import * as path from 'node:path'
import {parseAscii, type ParsedFooterEdge, type ParsedInlineEdge, type ParseResult} from './parser'

type JsonState = {
    readonly graph: {
        readonly nodes: Record<string, {
            readonly outgoingEdges: ReadonlyArray<{targetId: string; label?: string}>
            readonly absoluteFilePathIsID: string
        }>
    }
}

function rootOfDump(state: JsonState, projectRootArg: string | undefined): string {
    if (projectRootArg) return path.resolve(projectRootArg)
    const ids: string[] = Object.keys(state.graph.nodes)
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

function deriveTitleFromContent(content: string, fallbackBasename: string): string {
    const withoutFm: string = content.replace(/^---\n[\s\S]*?\n---\n?/, '')
    const h1: RegExpMatchArray | null = withoutFm.match(/^#\s+(.+)$/m)
    if (h1?.[1]) return h1[1].trim()
    const firstLine: string | undefined = withoutFm.split('\n').map(l => l.trim()).find(l => l.length > 0)
    return firstLine ?? fallbackBasename
}

function titleForJsonNode(absPath: string): string {
    try {
        const content: string = fs.readFileSync(absPath, 'utf8')
        return deriveTitleFromContent(content, path.basename(absPath, '.md'))
    } catch {
        return path.basename(absPath, '.md')
    }
}

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

type EdgeStats = {
    readonly parsedEdgeCount: number
    readonly matched: number
    readonly lostUnresolved: number
    readonly lostOther: number
    readonly ghost: number
    readonly fidelity: number
    readonly missingExamples: readonly string[]
}

type CoLocationStats = {
    readonly footerStartLine: number | null
    readonly resolvedEdgesWithTreeLines: number
    readonly sourceLinesWithFooter: number
    readonly meanTreeDistance: number | null
    readonly medianSourceToFooterDistance: number | null
}

function toViewId(rootPrefix: string, absId: string): string {
    const relative: string = absId.startsWith(rootPrefix + '/') ? absId.slice(rootPrefix.length + 1) : absId
    return relative.replace(/\\/g, '/').replace(/\.md$/i, '')
}

function keyForViewId(viewId: string, title: string): string {
    const folder: string = path.posix.dirname(viewId) === '.' ? '' : path.posix.dirname(viewId)
    return `${folder}::${title}`
}

function buildJsonNodeInfo(state: JsonState, rootPrefix: string): {
    readonly nodes: readonly JsonNodeInfo[]
    readonly nodeKeys: ReadonlySet<string>
    readonly nodesByAbsId: ReadonlyMap<string, JsonNodeInfo>
    readonly nodesByViewId: ReadonlyMap<string, JsonNodeInfo>
    readonly duplicateTitleNodes: number
    readonly hiddenPathNodes: number
} {
    const nodes: JsonNodeInfo[] = []
    const nodeKeys = new Set<string>()
    const nodesByAbsId = new Map<string, JsonNodeInfo>()
    const nodesByViewId = new Map<string, JsonNodeInfo>()
    const titleCounts = new Map<string, number>()
    let hiddenPathNodes = 0

    for (const absId of Object.keys(state.graph.nodes)) {
        const viewId: string = toViewId(rootPrefix, absId)
        const title: string = titleForJsonNode(absId)
        const key: string = keyForViewId(viewId, title)
        const info: JsonNodeInfo = {absId, viewId, key, title}
        nodes.push(info)
        nodeKeys.add(key)
        nodesByAbsId.set(absId, info)
        nodesByViewId.set(viewId, info)
        titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1)
        if (viewId.split('/').some(segment => segment.startsWith('.'))) {
            hiddenPathNodes += 1
        }
    }

    let duplicateTitleNodes = 0
    for (const count of titleCounts.values()) {
        if (count > 1) duplicateTitleNodes += count
    }

    return {nodes, nodeKeys, nodesByAbsId, nodesByViewId, duplicateTitleNodes, hiddenPathNodes}
}

function buildJsonEdges(state: JsonState, nodesByAbsId: ReadonlyMap<string, JsonNodeInfo>): JsonEdgeInfo[] {
    const edges: JsonEdgeInfo[] = []
    for (const [srcId, node] of Object.entries(state.graph.nodes)) {
        const srcInfo: JsonNodeInfo | undefined = nodesByAbsId.get(srcId)
        if (!srcInfo) continue
        for (const edge of node.outgoingEdges) {
            if (srcId === edge.targetId) continue
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

function scoreLegacyEdges(jsonEdges: readonly JsonEdgeInfo[], inlineEdges: readonly ParsedInlineEdge[]): EdgeStats {
    const parsedCounts = new Map<string, number>()
    for (const edge of inlineEdges) {
        const key: string = `${edge.srcTitle}|||${edge.targetTitle}`
        parsedCounts.set(key, (parsedCounts.get(key) ?? 0) + 1)
    }

    let matched = 0
    let lostUnresolved = 0
    let lostOther = 0
    const missingExamples: string[] = []

    for (const edge of jsonEdges) {
        const key: string = `${edge.srcTitle}|||${edge.targetTitle}`
        const count: number = parsedCounts.get(key) ?? 0
        if (count > 0) {
            matched += 1
            parsedCounts.set(key, count - 1)
            continue
        }
        if (!edge.targetResolved) {
            lostUnresolved += 1
            if (missingExamples.length < 5) missingExamples.push(`UNRESOLVED: ${edge.srcTitle} -> ${edge.targetTitle}`)
        } else {
            lostOther += 1
            if (missingExamples.length < 10) missingExamples.push(`LOST: ${edge.srcTitle} -> ${edge.targetTitle}`)
        }
    }

    const ghost: number = [...parsedCounts.values()].reduce((sum, count) => sum + count, 0)
    return {
        parsedEdgeCount: inlineEdges.length,
        matched,
        lostUnresolved,
        lostOther,
        ghost,
        fidelity: jsonEdges.length > 0 ? matched / jsonEdges.length : 1,
        missingExamples,
    }
}

function scoreFooterEdges(jsonEdges: readonly JsonEdgeInfo[], footerEdges: readonly ParsedFooterEdge[]): EdgeStats {
    const parsedCounts = new Map<string, number>()
    for (const edge of footerEdges) {
        const key: string = `${edge.srcId}|||${edge.unresolved ? '?' + edge.targetId : edge.targetId}`
        parsedCounts.set(key, (parsedCounts.get(key) ?? 0) + 1)
    }

    let matched = 0
    let lostUnresolved = 0
    let lostOther = 0
    const missingExamples: string[] = []

    for (const edge of jsonEdges) {
        const footerTarget: string = edge.targetResolved ? edge.targetViewId! : `?${edge.targetRaw}`
        const key: string = `${edge.srcViewId}|||${footerTarget}`
        const count: number = parsedCounts.get(key) ?? 0
        if (count > 0) {
            matched += 1
            parsedCounts.set(key, count - 1)
            continue
        }
        if (!edge.targetResolved) {
            lostUnresolved += 1
            if (missingExamples.length < 5) missingExamples.push(`UNRESOLVED: ${edge.srcViewId} -> ?${edge.targetRaw}`)
        } else {
            lostOther += 1
            if (missingExamples.length < 10) missingExamples.push(`LOST: ${edge.srcViewId} -> ${edge.targetViewId}`)
        }
    }

    const ghost: number = [...parsedCounts.values()].reduce((sum, count) => sum + count, 0)
    return {
        parsedEdgeCount: footerEdges.length,
        matched,
        lostUnresolved,
        lostOther,
        ghost,
        fidelity: jsonEdges.length > 0 ? matched / jsonEdges.length : 1,
        missingExamples,
    }
}

function mean(values: readonly number[]): number | null {
    if (values.length === 0) return null
    return values.reduce((sum, value) => sum + value, 0) / values.length
}

function median(values: readonly number[]): number | null {
    if (values.length === 0) return null
    const sorted: number[] = [...values].sort((left, right) => left - right)
    const mid: number = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

function computeCoLocationStats(
    parsed: ParseResult,
    nodesByViewId: ReadonlyMap<string, JsonNodeInfo>,
): CoLocationStats {
    const treeLinesByKey = new Map<string, number[]>()
    for (const node of parsed.nodes) {
        if (node.kind === 'virtualFolder') continue
        const key: string = `${node.folderPath}::${node.title}`
        const lines: number[] = treeLinesByKey.get(key) ?? []
        lines.push(node.line)
        treeLinesByKey.set(key, lines)
    }

    const lineForViewId = (viewId: string): number | undefined => {
        const info: JsonNodeInfo | undefined = nodesByViewId.get(viewId)
        if (!info) return undefined
        const lines: number[] | undefined = treeLinesByKey.get(info.key)
        return lines?.length === 1 ? lines[0] : undefined
    }

    const treeDistances: number[] = []
    const sourceToFooterDistances: number[] = []

    for (const edge of parsed.footerEdges) {
        const srcLine: number | undefined = lineForViewId(edge.srcId)
        if (srcLine !== undefined && parsed.footerStartLine !== null) {
            sourceToFooterDistances.push(parsed.footerStartLine - srcLine)
        }
        if (edge.unresolved || srcLine === undefined) continue
        const targetLine: number | undefined = lineForViewId(edge.targetId)
        if (targetLine !== undefined) {
            treeDistances.push(Math.abs(srcLine - targetLine))
        }
    }

    return {
        footerStartLine: parsed.footerStartLine,
        resolvedEdgesWithTreeLines: treeDistances.length,
        sourceLinesWithFooter: sourceToFooterDistances.length,
        meanTreeDistance: mean(treeDistances),
        medianSourceToFooterDistance: median(sourceToFooterDistances),
    }
}

export function runAsciiParserCli(argv: readonly string[]): void {
    const asciiPath: string | undefined = argv[2]
    const jsonPath: string | undefined = argv[3]
    const projectRoot: string | undefined = argv[4]
    if (!asciiPath || !jsonPath) {
        console.error('Usage: L3-BF-191-ascii-parser.ts <ascii.txt> <state.json> [<project-root>]')
        process.exit(2)
    }

    const ascii: string = fs.readFileSync(asciiPath, 'utf8')
    const state: JsonState = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    const parsed: ParseResult = parseAscii(ascii)

    const rootPrefix: string = rootOfDump(state, projectRoot)
    const jsonInfo = buildJsonNodeInfo(state, rootPrefix)
    const jsonEdges: JsonEdgeInfo[] = buildJsonEdges(state, jsonInfo.nodesByAbsId)

    const asciiNodeKeys: Set<string> = new Set()
    for (const node of parsed.nodes) {
        if (node.kind === 'virtualFolder') continue
        asciiNodeKeys.add(`${node.folderPath}::${node.title}`)
    }

    let nodesInBoth = 0
    const nodesMissingFromAscii: string[] = []
    for (const key of jsonInfo.nodeKeys) {
        if (asciiNodeKeys.has(key)) nodesInBoth += 1
        else nodesMissingFromAscii.push(key)
    }
    const ghostAsciiNodes: string[] = []
    for (const key of asciiNodeKeys) {
        if (!jsonInfo.nodeKeys.has(key)) ghostAsciiNodes.push(key)
    }

    const legacyStats: EdgeStats = scoreLegacyEdges(jsonEdges, parsed.inlineEdges)
    const footerStats: EdgeStats = scoreFooterEdges(jsonEdges, parsed.footerEdges)
    const coLocationStats: CoLocationStats = computeCoLocationStats(parsed, jsonInfo.nodesByViewId)
    const nodeFidelity: number = jsonInfo.nodeKeys.size > 0 ? nodesInBoth / jsonInfo.nodeKeys.size : 1
    const hiddenSourceEdges: number = jsonEdges.filter(edge => edge.srcViewId.split('/').some(segment => segment.startsWith('.'))).length
    const renderedSourceFooterFidelity: number = footerStats.parsedEdgeCount > 0
        ? footerStats.matched / footerStats.parsedEdgeCount
        : 1

    console.log('=== L3-BF-191 ASCII roundtrip fidelity ===')
    console.log(`Root prefix: ${rootPrefix}`)
    console.log()
    console.log(`| metric                               | count |`)
    console.log(`|--------------------------------------|-------|`)
    console.log(`| JSON nodes                           | ${jsonInfo.nodeKeys.size} |`)
    console.log(`| ASCII reconstructed nodes            | ${asciiNodeKeys.size} |`)
    console.log(`| Nodes in both                        | ${nodesInBoth} |`)
    console.log(`| Nodes missing from ASCII             | ${nodesMissingFromAscii.length} |`)
    console.log(`| Ghost ASCII nodes (not in JSON)      | ${ghostAsciiNodes.length} |`)
    console.log(`| Hidden-path JSON nodes               | ${jsonInfo.hiddenPathNodes} |`)
    console.log(`| **Node fidelity**                    | **${(nodeFidelity * 100).toFixed(1)}%** |`)
    console.log()
    console.log(`| edge metric                          | legacy inline | footer |`)
    console.log(`|--------------------------------------|---------------|--------|`)
    console.log(`| JSON edges (outgoing, non-self)      | ${jsonEdges.length} | ${jsonEdges.length} |`)
    console.log(`| Parsed edges                         | ${legacyStats.parsedEdgeCount} | ${footerStats.parsedEdgeCount} |`)
    console.log(`| Matched edges                        | ${legacyStats.matched} | ${footerStats.matched} |`)
    console.log(`| Lost: unresolved wikilink            | ${legacyStats.lostUnresolved} | ${footerStats.lostUnresolved} |`)
    console.log(`| Lost: other                          | ${legacyStats.lostOther} | ${footerStats.lostOther} |`)
    console.log(`| Ghost parsed edges                   | ${legacyStats.ghost} | ${footerStats.ghost} |`)
    console.log(`| **Edge fidelity**                    | **${(legacyStats.fidelity * 100).toFixed(1)}%** | **${(footerStats.fidelity * 100).toFixed(1)}%** |`)
    console.log(`| Footer fidelity (rendered sources)   | n/a | **${(renderedSourceFooterFidelity * 100).toFixed(1)}%** |`)
    console.log()
    console.log(`| co-location metric                   | count |`)
    console.log(`|--------------------------------------|-------|`)
    console.log(`| Footer start line                    | ${coLocationStats.footerStartLine ?? 'n/a'} |`)
    console.log(`| Resolved footer edges with tree lines| ${coLocationStats.resolvedEdgesWithTreeLines} |`)
    console.log(`| Source lines with footer distance    | ${coLocationStats.sourceLinesWithFooter} |`)
    console.log(`| Mean tree line distance              | ${coLocationStats.meanTreeDistance?.toFixed(1) ?? 'n/a'} |`)
    console.log(`| Median source→footer distance        | ${coLocationStats.medianSourceToFooterDistance?.toFixed(1) ?? 'n/a'} |`)
    console.log()
    console.log(`| extra metric                         | count |`)
    console.log(`|--------------------------------------|-------|`)
    console.log(`| Duplicate-title JSON nodes           | ${jsonInfo.duplicateTitleNodes} |`)
    console.log(`| Hidden-source JSON edges             | ${hiddenSourceEdges} |`)
    console.log(`| Dropped ASCII lines (parser failed)  | ${parsed.droppedLines.length} |`)
    console.log()

    if (legacyStats.missingExamples.length > 0) {
        console.log('Legacy missing-edge examples (first 10):')
        for (const example of legacyStats.missingExamples) console.log(`  - ${example}`)
    }
    if (footerStats.missingExamples.length > 0) {
        console.log('Footer missing-edge examples (first 10):')
        for (const example of footerStats.missingExamples) console.log(`  - ${example}`)
    }
    if (parsed.droppedLines.length > 0 && parsed.droppedLines.length <= 5) {
        console.log('Dropped lines:')
        for (const droppedLine of parsed.droppedLines) console.log(`  - ${droppedLine}`)
    }
    if (nodesMissingFromAscii.length > 0 && nodesMissingFromAscii.length <= 10) {
        console.log('Missing nodes:')
        for (const missingNode of nodesMissingFromAscii) console.log(`  - ${missingNode}`)
    } else if (nodesMissingFromAscii.length > 10) {
        console.log(`Missing nodes (first 5 of ${nodesMissingFromAscii.length}):`)
        for (const missingNode of nodesMissingFromAscii.slice(0, 5)) console.log(`  - ${missingNode}`)
    }
}

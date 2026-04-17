#!/usr/bin/env node --import tsx

import * as fs from 'node:fs'
import * as path from 'node:path'
import {lcpOfIds, relId, type JsonState} from './L3-BF-192-tree-cover-render'

type ParsedEdge = {
    readonly src: string
    readonly target: string
    readonly unresolved: boolean
    readonly sourceFragment: string
    readonly targetFragment: string | null
}

type ParsedRecursiveAscii = {
    readonly fragmentOrder: readonly string[]
    readonly nodeToFragment: ReadonlyMap<string, string>
    readonly edges: readonly ParsedEdge[]
    readonly droppedLines: readonly string[]
}

type ScoreResult = {
    readonly jsonNodeCount: number
    readonly reconstructedNodeCount: number
    readonly nodesCovered: number
    readonly ghostNodeCount: number
    readonly nodeFidelity: number
    readonly jsonEdgeCount: number
    readonly reconstructedEdgeCount: number
    readonly edgesCovered: number
    readonly missingEdgeCount: number
    readonly ghostEdgeCount: number
    readonly edgeFidelity: number
}

type NavigationStats = {
    readonly sampleSize: number
    readonly meanCost: number | null
    readonly sampledEdges: readonly string[]
}

const HEADER_RE: RegExp = /^\[Fragment (?<fragmentId>fragment-\d+): .+\]$/
const FILE_RE: RegExp = /·\s.+\s@\[([^\]]+)\]/
const EDGE_RE: RegExp = /⇢\s.+\s@\[([^\]]+)\](?:\s\[.*\])?$/
const FOOTER_TARGET_RE: RegExp = /^(?<fragment>main|fragment-\d+)::(?<target>.+)$/

function parseRecursiveAscii(text: string): ParsedRecursiveAscii {
    const fragmentOrder: string[] = []
    const nodeToFragment: Map<string, string> = new Map()
    const edges: ParsedEdge[] = []
    const dropped: string[] = []
    let currentFragment: string | null = null
    let inCrossLinks = false
    let currentSource: string | null = null

    const lines: string[] = text.split('\n')
    for (let index = 0; index < lines.length; index++) {
        const line: string = lines[index]!
        const trimmed: string = line.trim()
        if (trimmed === '') continue
        if (trimmed === '[Main view]') {
            currentFragment = 'main'
            fragmentOrder.push(currentFragment)
            inCrossLinks = false
            currentSource = null
            continue
        }
        const headerMatch: RegExpMatchArray | null = trimmed.match(HEADER_RE)
        if (headerMatch?.groups?.fragmentId) {
            currentFragment = headerMatch.groups.fragmentId
            fragmentOrder.push(currentFragment)
            inCrossLinks = false
            currentSource = null
            continue
        }
        if (trimmed === '[Cross-Links]') {
            inCrossLinks = true
            currentSource = null
            continue
        }
        if (!currentFragment) continue
        if (trimmed.startsWith('summary:') || trimmed.startsWith('vault_root:') || trimmed.startsWith('thresholds:') || trimmed.startsWith('fragment_count:') || trimmed.startsWith('═══ ')) {
            continue
        }
        if (inCrossLinks) {
            const separator: number = line.indexOf(' -> ')
            if (separator < 0) {
                dropped.push(`footer:${index}:${line}`)
                continue
            }
            const src: string = line.slice(0, separator).trim()
            const targetText: string = line.slice(separator + 4).trim()
            if (!src || !targetText) {
                dropped.push(`footer:${index}:${line}`)
                continue
            }
            if (targetText.startsWith('?')) {
                edges.push({
                    src,
                    target: targetText.slice(1),
                    unresolved: true,
                    sourceFragment: currentFragment,
                    targetFragment: null,
                })
                continue
            }
            const footerMatch: RegExpMatchArray | null = targetText.match(FOOTER_TARGET_RE)
            if (!footerMatch?.groups) {
                dropped.push(`footer-target:${index}:${line}`)
                continue
            }
            edges.push({
                src,
                target: footerMatch.groups.target!,
                unresolved: false,
                sourceFragment: currentFragment,
                targetFragment: footerMatch.groups.fragment!,
            })
            continue
        }

        const fileMatch: RegExpMatchArray | null = line.match(FILE_RE)
        if (fileMatch?.[1]) {
            currentSource = fileMatch[1]
            nodeToFragment.set(currentSource, currentFragment)
            continue
        }
        const edgeMatch: RegExpMatchArray | null = line.match(EDGE_RE)
        if (edgeMatch?.[1]) {
            if (!currentSource) {
                dropped.push(`inline-no-source:${index}:${line}`)
                continue
            }
            edges.push({
                src: currentSource,
                target: edgeMatch[1],
                unresolved: false,
                sourceFragment: currentFragment,
                targetFragment: currentFragment,
            })
            continue
        }
        if (trimmed.includes('▢ ') || trimmed.includes('▦ ')) {
            currentSource = null
            continue
        }
        dropped.push(`unknown:${index}:${line}`)
        currentSource = null
    }

    return {fragmentOrder, nodeToFragment, edges, droppedLines: dropped}
}

function buildGroundTruth(state: JsonState, vaultRoot: string): {
    readonly nodeIds: ReadonlySet<string>
    readonly edgeKeys: ReadonlySet<string>
    readonly resolvedEdgePairs: readonly [string, string][]
} {
    const nodeIds: Set<string> = new Set()
    const edgeKeys: Set<string> = new Set()
    const resolvedEdgePairs: Array<[string, string]> = []
    const jsonIds: Set<string> = new Set(Object.keys(state.graph.nodes))

    for (const absId of Object.keys(state.graph.nodes)) {
        nodeIds.add(relId(absId, vaultRoot))
    }
    for (const [srcAbs, node] of Object.entries(state.graph.nodes)) {
        const src: string = relId(srcAbs, vaultRoot)
        for (const edge of node.outgoingEdges) {
            if (edge.targetId === srcAbs) continue
            const target: string = jsonIds.has(edge.targetId) ? relId(edge.targetId, vaultRoot) : edge.targetId
            edgeKeys.add(`${src}|${target}`)
            if (jsonIds.has(edge.targetId)) resolvedEdgePairs.push([src, relId(edge.targetId, vaultRoot)])
        }
    }
    return {nodeIds, edgeKeys, resolvedEdgePairs}
}

function scoreRecursiveAscii(parsed: ParsedRecursiveAscii, state: JsonState, vaultRoot: string): ScoreResult {
    const truth = buildGroundTruth(state, vaultRoot)
    const reconstructedNodes: Set<string> = new Set(parsed.nodeToFragment.keys())
    const reconstructedEdges: Set<string> = new Set(parsed.edges.map(edge => `${edge.src}|${edge.target}`))

    let nodesCovered = 0
    for (const id of truth.nodeIds) if (reconstructedNodes.has(id)) nodesCovered += 1
    let edgesCovered = 0
    for (const edge of truth.edgeKeys) if (reconstructedEdges.has(edge)) edgesCovered += 1

    return {
        jsonNodeCount: truth.nodeIds.size,
        reconstructedNodeCount: reconstructedNodes.size,
        nodesCovered,
        ghostNodeCount: [...reconstructedNodes].filter(id => !truth.nodeIds.has(id)).length,
        nodeFidelity: truth.nodeIds.size === 0 ? 1 : nodesCovered / truth.nodeIds.size,
        jsonEdgeCount: truth.edgeKeys.size,
        reconstructedEdgeCount: reconstructedEdges.size,
        edgesCovered,
        missingEdgeCount: truth.edgeKeys.size - edgesCovered,
        ghostEdgeCount: [...reconstructedEdges].filter(edge => !truth.edgeKeys.has(edge)).length,
        edgeFidelity: truth.edgeKeys.size === 0 ? 1 : edgesCovered / truth.edgeKeys.size,
    }
}

function stableHash(input: string, seed: number): number {
    let hash = seed >>> 0
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i)
        hash = Math.imul(hash, 16777619) >>> 0
    }
    return hash
}

function mean(values: readonly number[]): number | null {
    if (values.length === 0) return null
    return values.reduce((sum, value) => sum + value, 0) / values.length
}

function navigationCostForEdge(parsed: ParsedRecursiveAscii, src: string, target: string): number | null {
    const srcFragment: string | undefined = parsed.nodeToFragment.get(src)
    const targetFragment: string | undefined = parsed.nodeToFragment.get(target)
    if (!srcFragment || !targetFragment) return null
    if (srcFragment === 'main' && targetFragment === 'main') return 1
    if (srcFragment === targetFragment) return srcFragment === 'main' ? 1 : 2
    const extra: number = Number(srcFragment !== 'main') + Number(targetFragment !== 'main' && targetFragment !== srcFragment)
    return 1 + extra
}

function computeNavigationStats(
    parsed: ParsedRecursiveAscii,
    state: JsonState,
    vaultRoot: string,
    sampleSize: number,
    seed: number,
): NavigationStats {
    const truth = buildGroundTruth(state, vaultRoot)
    const sampledEdges: readonly string[] = [...truth.resolvedEdgePairs]
        .map(([src, target]) => `${src}|${target}`)
        .sort((left, right) => stableHash(left, seed) - stableHash(right, seed))
        .slice(0, sampleSize)
    const costs: number[] = []
    for (const edge of sampledEdges) {
        const [src, target] = edge.split('|')
        const cost: number | null = navigationCostForEdge(parsed, src!, target!)
        if (cost !== null) costs.push(cost)
    }
    return {sampleSize: sampledEdges.length, meanCost: mean(costs), sampledEdges}
}

function main(): void {
    const asciiPath: string | undefined = process.argv[2]
    const jsonPath: string | undefined = process.argv[3]
    const vaultArg: string | undefined = process.argv[4]
    if (!asciiPath || !jsonPath) {
        console.error('Usage: L3-BF-194-recursive-parser.ts <recursive.txt> <state.json> [<vault-root>]')
        process.exit(2)
    }
    const ascii: string = fs.readFileSync(asciiPath, 'utf8')
    const state: JsonState = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    const ids: readonly string[] = Object.keys(state.graph.nodes)
    const vaultRoot: string = vaultArg ? path.resolve(vaultArg) : lcpOfIds(ids)
    const parsed: ParsedRecursiveAscii = parseRecursiveAscii(ascii)
    const score: ScoreResult = scoreRecursiveAscii(parsed, state, vaultRoot)
    const navigation: NavigationStats = computeNavigationStats(parsed, state, vaultRoot, 20, 194)

    console.log('=== L3-BF-194 recursive ASCII fidelity ===')
    console.log(`vault_root: ${vaultRoot}`)
    console.log()
    console.log(`| metric | value |`)
    console.log(`|---|---:|`)
    console.log(`| fragment count | ${parsed.fragmentOrder.length} |`)
    console.log(`| JSON nodes | ${score.jsonNodeCount} |`)
    console.log(`| reconstructed nodes | ${score.reconstructedNodeCount} |`)
    console.log(`| nodes covered | ${score.nodesCovered} |`)
    console.log(`| ghost nodes | ${score.ghostNodeCount} |`)
    console.log(`| node fidelity | ${(score.nodeFidelity * 100).toFixed(1)}% |`)
    console.log(`| JSON edges | ${score.jsonEdgeCount} |`)
    console.log(`| reconstructed edges | ${score.reconstructedEdgeCount} |`)
    console.log(`| edges covered | ${score.edgesCovered} |`)
    console.log(`| missing edges | ${score.missingEdgeCount} |`)
    console.log(`| ghost edges | ${score.ghostEdgeCount} |`)
    console.log(`| edge fidelity | ${(score.edgeFidelity * 100).toFixed(1)}% |`)
    console.log(`| mean navigation cost (20 resolved edges) | ${navigation.meanCost?.toFixed(2) ?? 'n/a'} |`)
    console.log(`| dropped parser lines | ${parsed.droppedLines.length} |`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main()
}

export {
    buildGroundTruth,
    computeNavigationStats,
    navigationCostForEdge,
    parseRecursiveAscii,
    scoreRecursiveAscii,
}
export type {
    NavigationStats,
    ParsedEdge,
    ParsedRecursiveAscii,
    ScoreResult,
}

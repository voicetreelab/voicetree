#!/usr/bin/env node --import tsx
import {execFileSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {DirectedGraph} from 'graphology'
import louvain from 'graphology-communities-louvain'
import {
    deriveTitle,
    lcpOfIds,
    relId,
    type DirectedEdge,
    type JsonState,
} from './L3-BF-192-tree-cover-render'
import {formatLimit, loadStateFromRoot, parseLimit} from './L3-BF-194-recursive-ascii'

type FixtureJson = {
    readonly name?: string
    readonly nodes: ReadonlyArray<string | {id: string; title?: string}>
    readonly edges: ReadonlyArray<readonly [string, string] | {source: string; target: string}>
}
type RenderOptions = {readonly maxInlineEdges: number; readonly maxInlineNodes: number; readonly maxDepth: number}
type GraphNode = {
    readonly id: string
    readonly footerId: string
    readonly title: string
    readonly shortId: string
    readonly displayTitle: string
    readonly outgoingEdges: ReadonlyArray<{targetId: string; label?: string}>
}
type Dataset = {
    readonly name: string
    readonly kind: 'fixture' | 'vault'
    readonly nodes: ReadonlyMap<string, GraphNode>
    readonly edges: readonly DirectedEdge[]
}
type Community = {readonly nodeIds: readonly string[]; readonly nodeCount: number; readonly internalEdgeCount: number}
type FragmentPlan = {
    readonly id: string
    readonly label: string
    readonly depth: number
    readonly nodeIds: readonly string[]
    readonly ownedNodeIds: readonly string[]
    readonly childFragments: readonly FragmentPlan[]
    readonly localEdgeCount: number
}
type FragmentRender = {
    readonly id: string
    readonly label: string
    readonly depth: number
    readonly lines: readonly string[]
    readonly nodeKeyLines: readonly string[]
    readonly footerLines: readonly string[]
    readonly degraded: boolean
    readonly totalNodes: number
    readonly ownedNodes: number
    readonly visibleItems: number
    readonly inlineEdges: number
    readonly footerEdges: number
}
type Recursive2D = {readonly text: string; readonly fragments: readonly FragmentRender[]; readonly degradedCount: number; readonly maxDepth: number}

const DEFAULTS: RenderOptions = {maxInlineEdges: 30, maxInlineNodes: Number.POSITIVE_INFINITY, maxDepth: 3}
const GRAPH_EASY_CMD = 'source ~/.zshrc >/dev/null 2>&1; graph-easy --from=dot --as=ascii --timeout=20'

function sortIds(dataset: Dataset, ids: readonly string[]): readonly string[] {
    return [...ids].sort((left, right) =>
        (dataset.nodes.get(left)?.footerId ?? left).localeCompare(dataset.nodes.get(right)?.footerId ?? right))
}

function compactId(index: number, prefer: string): string {
    return /^[0-9]{1,3}$/u.test(prefer) ? prefer : `n${String(index + 1).padStart(3, '0')}`
}

function truncate(text: string, width: number): string {
    return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 3))}...`
}

function nodeLabel(node: GraphNode): string {
    return node.displayTitle === node.shortId ? node.shortId : `${node.shortId}\n${node.displayTitle}`
}

function loadDatasetFromState(state: JsonState, vaultRoot: string): Dataset {
    const ids: readonly string[] = Object.keys(state.graph.nodes).sort()
    const footerIds: readonly string[] = ids.map(id => relId(id, vaultRoot))
    const nodes = new Map<string, GraphNode>()
    for (let index = 0; index < ids.length; index++) {
        const absId: string = ids[index]!
        const jsonNode = state.graph.nodes[absId]!
        const title: string = deriveTitle(jsonNode.contentWithoutYamlOrLinks, path.basename(absId, '.md'))
        nodes.set(absId, {
            id: absId,
            footerId: footerIds[index]!,
            title,
            shortId: compactId(index, path.basename(footerIds[index]!, '.md')),
            displayTitle: truncate(title, 20),
            outgoingEdges: jsonNode.outgoingEdges,
        })
    }
    const edges: DirectedEdge[] = []
    for (const [src, node] of Object.entries(state.graph.nodes)) {
        for (const edge of node.outgoingEdges) {
            if (edge.targetId === src) continue
            edges.push({src, tgt: edge.targetId, label: edge.label})
        }
    }
    return {name: path.basename(vaultRoot), kind: 'vault', nodes, edges}
}

function loadDatasetFromFixture(fixturePath: string, labelOverride: string | null): Dataset {
    const fixture: FixtureJson = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
    const rawNodes: readonly (string | {id: string; title?: string})[] = fixture.nodes
    const sortedIds: readonly string[] = rawNodes.map(node => typeof node === 'string' ? node : node.id).sort()
    const titles = new Map<string, string>()
    for (const node of rawNodes) titles.set(typeof node === 'string' ? node : node.id, typeof node === 'string' ? node : (node.title ?? node.id))
    const outgoing = new Map<string, {targetId: string}[]>()
    for (const id of sortedIds) outgoing.set(id, [])
    for (const edge of fixture.edges) {
        const source: string = Array.isArray(edge) ? edge[0]! : edge.source
        const target: string = Array.isArray(edge) ? edge[1]! : edge.target
        outgoing.get(source)?.push({targetId: target})
    }
    const nodes = new Map<string, GraphNode>()
    for (let index = 0; index < sortedIds.length; index++) {
        const id: string = sortedIds[index]!
        const title: string = titles.get(id) ?? id
        nodes.set(id, {
            id,
            footerId: id,
            title,
            shortId: compactId(index, id),
            displayTitle: truncate(title, 20),
            outgoingEdges: outgoing.get(id) ?? [],
        })
    }
    return {
        name: labelOverride ?? fixture.name ?? path.basename(fixturePath, '.json'),
        kind: 'fixture',
        nodes,
        edges: fixture.edges.map(edge => ({
            src: Array.isArray(edge) ? edge[0]! : edge.source,
            tgt: Array.isArray(edge) ? edge[1]! : edge.target,
        })),
    }
}

function localEdges(dataset: Dataset, nodeIds: readonly string[]): readonly DirectedEdge[] {
    const nodeSet = new Set(nodeIds)
    return dataset.edges.filter(edge => edge.src !== edge.tgt && nodeSet.has(edge.src) && nodeSet.has(edge.tgt))
}

function detectCommunities(dataset: Dataset, nodeIds: readonly string[]): readonly Community[] {
    const graph = new DirectedGraph()
    const nodeSet = new Set(nodeIds)
    for (const id of nodeIds) graph.addNode(id)
    const weights = new Map<string, number>()
    for (const edge of dataset.edges) {
        if (edge.src === edge.tgt || !nodeSet.has(edge.src) || !nodeSet.has(edge.tgt)) continue
        const key: string = `${edge.src}\u0000${edge.tgt}`
        weights.set(key, (weights.get(key) ?? 0) + 1)
    }
    for (const [key, weight] of weights) {
        const [src, tgt] = key.split('\u0000')
        graph.addDirectedEdgeWithKey(key, src!, tgt!, {weight})
    }
    const mapping: Record<string, number> = louvain(graph, {getEdgeWeight: 'weight'})
    const groups = new Map<number, string[]>()
    for (const id of nodeIds) {
        const community: number = mapping[id] ?? -1
        if (!groups.has(community)) groups.set(community, [])
        groups.get(community)!.push(id)
    }
    const communities: Community[] = [...groups.values()].map(groupIds => {
        const groupSet = new Set(groupIds)
        const internalEdgeCount: number = dataset.edges.filter(edge =>
            edge.src !== edge.tgt && groupSet.has(edge.src) && groupSet.has(edge.tgt)).length
        return {nodeIds: sortIds(dataset, groupIds), nodeCount: groupIds.length, internalEdgeCount}
    })
    return communities.sort((left, right) =>
        right.internalEdgeCount - left.internalEdgeCount ||
        right.nodeCount - left.nodeCount ||
        left.nodeIds[0]!.localeCompare(right.nodeIds[0]!))
}

function buildPlan(dataset: Dataset, nodeIds: readonly string[], depth: number, label: string, id: string, options: RenderOptions, nextId: {value: number}): FragmentPlan {
    const localEdgeCount: number = localEdges(dataset, nodeIds).length
    let childFragments: readonly FragmentPlan[] = []
    if (depth < options.maxDepth && localEdgeCount > options.maxInlineEdges) {
        const candidates: readonly Community[] = detectCommunities(dataset, nodeIds).filter(community =>
            community.nodeCount > 1 &&
            community.nodeCount < nodeIds.length &&
            (community.internalEdgeCount > options.maxInlineEdges / 3 || community.nodeCount > options.maxInlineNodes / 3),
        )
        if (candidates.length > 0) {
            childFragments = candidates.map(community => {
                const suffix: number = nextId.value++
                return buildPlan(dataset, community.nodeIds, depth + 1, `cluster-${suffix}`, `fragment-${suffix}`, options, nextId)
            })
        }
    }
    const extracted = new Set(childFragments.flatMap(fragment => fragment.nodeIds))
    const ownedNodeIds: readonly string[] = sortIds(dataset, nodeIds.filter(idValue => !extracted.has(idValue)))
    return {id, label, depth, nodeIds: sortIds(dataset, nodeIds), ownedNodeIds, childFragments, localEdgeCount}
}

function collectFragments(plan: FragmentPlan, ownerByNode: Map<string, string>, order: FragmentPlan[]): void {
    order.push(plan)
    for (const nodeId of plan.ownedNodeIds) ownerByNode.set(nodeId, plan.id)
    for (const child of plan.childFragments) collectFragments(child, ownerByNode, order)
}

function childForNode(plan: FragmentPlan, nodeId: string): FragmentPlan | null {
    for (const child of plan.childFragments) if (child.nodeIds.includes(nodeId)) return child
    return null
}

function aggregateInlineEdges(dataset: Dataset, plan: FragmentPlan): readonly {from: string; to: string; count: number}[] {
    const nodeSet = new Set(plan.nodeIds)
    const counts = new Map<string, {from: string; to: string; count: number}>()
    for (const edge of dataset.edges) {
        if (edge.src === edge.tgt || !nodeSet.has(edge.src) || !nodeSet.has(edge.tgt)) continue
        const from: string = childForNode(plan, edge.src)?.id ?? edge.src
        const to: string = childForNode(plan, edge.tgt)?.id ?? edge.tgt
        if (from === to) continue
        const key: string = `${from}\u0000${to}`
        const prior = counts.get(key)
        counts.set(key, {from, to, count: (prior?.count ?? 0) + 1})
    }
    return [...counts.values()].sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to))
}

function dotEscape(value: string): string {
    return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"').replace(/\n/gu, '\\n')
}

function renderLayout(dataset: Dataset, plan: FragmentPlan, inlineEdges: readonly {from: string; to: string; count: number}[]): {readonly lines: readonly string[]; readonly degraded: boolean} {
    const items = [
        ...plan.childFragments.map(fragment => ({
            key: fragment.id,
            label: `${fragment.label}\n[${fragment.nodeIds.length}n ${fragment.localEdgeCount}e]\n${fragment.id}`,
        })),
        ...plan.ownedNodeIds.map(nodeId => ({key: nodeId, label: nodeLabel(dataset.nodes.get(nodeId)!)})),
    ]
    const dotLines: string[] = ['strict digraph G {', '  rankdir=LR;', '  node [shape=box];']
    for (const item of items.sort((left, right) => left.label.localeCompare(right.label))) {
        dotLines.push(`  "${dotEscape(item.key)}" [label="${dotEscape(item.label)}"];`)
    }
    for (const edge of inlineEdges) {
        const label: string = edge.count > 1 ? ` [label="${edge.count}e"]` : ''
        dotLines.push(`  "${dotEscape(edge.from)}" -> "${dotEscape(edge.to)}"${label};`)
    }
    dotLines.push('}')
    try {
        const rendered: string = execFileSync('/bin/zsh', ['-lc', GRAPH_EASY_CMD], {
            cwd: process.cwd(),
            encoding: 'utf8',
            input: `${dotLines.join('\n')}\n`,
            maxBuffer: 64 * 1024 * 1024,
        }).trimEnd()
        return {lines: rendered.split('\n'), degraded: false}
    } catch {
        const fallback: string[] = ['[layout degraded: graph-easy failed]', ...items.map(item => `node ${item.key}: ${item.label.replace(/\n/gu, ' | ')}`)]
        for (const edge of inlineEdges) fallback.push(`edge ${edge.from} -> ${edge.to} (${edge.count}e)`)
        return {lines: fallback, degraded: true}
    }
}

function buildNodeKeyLines(dataset: Dataset, plan: FragmentPlan): readonly string[] {
    if (dataset.kind === 'fixture') return []
    return plan.ownedNodeIds.map(nodeId => {
        const node: GraphNode = dataset.nodes.get(nodeId)!
        return `${node.shortId} = ${node.title} @[${node.footerId}]`
    })
}

function buildFooterLines(dataset: Dataset, plan: FragmentPlan, ownerByNode: ReadonlyMap<string, string>): readonly string[] {
    const lines: string[] = []
    for (const nodeId of plan.ownedNodeIds) {
        const node: GraphNode = dataset.nodes.get(nodeId)!
        for (const edge of node.outgoingEdges) {
            if (edge.targetId === nodeId) continue
            const targetOwner: string | undefined = ownerByNode.get(edge.targetId)
            const targetNode: GraphNode | undefined = dataset.nodes.get(edge.targetId)
            const targetText: string = targetOwner === plan.id
                ? (targetNode?.footerId ?? edge.targetId)
                : (targetOwner ? `${targetOwner}::${targetNode?.footerId ?? edge.targetId}` : `?${edge.targetId}`)
            lines.push(`${node.footerId} -> ${targetText}`)
        }
    }
    return lines.sort((left, right) => left.localeCompare(right))
}

function renderFragment(dataset: Dataset, plan: FragmentPlan, ownerByNode: ReadonlyMap<string, string>): FragmentRender {
    const inlineEdges = aggregateInlineEdges(dataset, plan)
    const layout = renderLayout(dataset, plan, inlineEdges)
    const footerLines = buildFooterLines(dataset, plan, ownerByNode)
    return {
        id: plan.id,
        label: plan.label,
        depth: plan.depth,
        lines: layout.lines,
        nodeKeyLines: buildNodeKeyLines(dataset, plan),
        footerLines,
        degraded: layout.degraded,
        totalNodes: plan.nodeIds.length,
        ownedNodes: plan.ownedNodeIds.length,
        visibleItems: plan.ownedNodeIds.length + plan.childFragments.length,
        inlineEdges: inlineEdges.length,
        footerEdges: footerLines.length,
    }
}

function buildRecursive2dAscii(dataset: Dataset, options: RenderOptions): Recursive2D {
    const rootPlan: FragmentPlan = buildPlan(dataset, sortIds(dataset, [...dataset.nodes.keys()]), 0, dataset.name, 'main', options, {value: 1})
    const ownerByNode = new Map<string, string>()
    const orderedPlans: FragmentPlan[] = []
    collectFragments(rootPlan, ownerByNode, orderedPlans)
    const fragments: readonly FragmentRender[] = orderedPlans.map(plan => renderFragment(dataset, plan, ownerByNode))
    const degradedCount: number = fragments.filter(fragment => fragment.degraded).length
    const maxDepth: number = Math.max(...fragments.map(fragment => fragment.depth))
    const lines: string[] = [
        '═══ L3-BF-195 recursive 2D ASCII ═══',
        `source: ${dataset.name}`,
        `thresholds: max_inline_edges=${formatLimit(options.maxInlineEdges)}, max_inline_nodes=${formatLimit(options.maxInlineNodes)}, max_depth=${options.maxDepth}`,
        'layout_engine: graph-easy',
        `fragment_count: ${fragments.length}`,
        `max_recursion_depth: ${maxDepth}`,
        `degraded_fragments: ${degradedCount}`,
        '',
    ]
    for (const fragment of fragments) {
        lines.push(fragment.id === 'main' ? '[Main 2D view]' : `[Fragment ${fragment.id}: ${fragment.label}]`)
        lines.push(`summary: total_nodes=${fragment.totalNodes}, owned_nodes=${fragment.ownedNodes}, visible_items=${fragment.visibleItems}, inline_edges=${fragment.inlineEdges}, footer_edges=${fragment.footerEdges}, depth=${fragment.depth}, engine=${fragment.degraded ? 'fallback' : 'graph-easy'}`)
        lines.push(...fragment.lines)
        if (fragment.nodeKeyLines.length > 0) {
            lines.push('')
            lines.push('[Node Keys]')
            lines.push(...fragment.nodeKeyLines)
        }
        if (fragment.footerLines.length > 0) {
            lines.push('')
            lines.push('[Cross-Links]')
            lines.push(...fragment.footerLines)
        }
        lines.push('')
    }
    return {text: `${lines.join('\n').trimEnd()}\n`, fragments, degradedCount, maxDepth}
}

function parseArgs(argv: readonly string[]): {readonly fixturePath: string | null; readonly label: string | null; readonly vaultRoot: string | null; readonly statePath: string | null; readonly options: RenderOptions} {
    let fixturePath: string | null = null
    let statePath: string | null = null
    let maxInlineEdges: number = DEFAULTS.maxInlineEdges
    let maxInlineNodes: number = DEFAULTS.maxInlineNodes
    let maxDepth: number = DEFAULTS.maxDepth
    const positionals: string[] = []
    for (let index = 0; index < argv.length; index++) {
        const arg: string = argv[index]!
        if (arg === '--fixture') {fixturePath = path.resolve(argv[++index]!); continue}
        if (arg === '--state') {statePath = path.resolve(argv[++index]!); continue}
        if (arg === '--max-inline-edges') {maxInlineEdges = parseLimit(argv[++index], DEFAULTS.maxInlineEdges); continue}
        if (arg === '--max-inline-nodes') {maxInlineNodes = parseLimit(argv[++index], DEFAULTS.maxInlineNodes); continue}
        if (arg === '--max-depth') {
            maxDepth = Number(argv[++index])
            if (!Number.isFinite(maxDepth) || maxDepth < 0) throw new Error(`Invalid max depth: ${argv[index]}`)
            continue
        }
        positionals.push(arg)
    }
    if (fixturePath && statePath) throw new Error('Choose either --fixture or --state, not both.')
    if (fixturePath) {
        if (positionals.length > 1) throw new Error('Usage: L3-BF-195-collapse-2d-ascii.ts [label] --fixture <fixture.json> [--max-inline-edges N|inf] [--max-inline-nodes N|inf] [--max-depth N]')
        return {fixturePath, label: positionals[0] ?? null, vaultRoot: null, statePath: null, options: {maxInlineEdges, maxInlineNodes, maxDepth}}
    }
    if (positionals.length > 1 || (positionals.length === 0 && !statePath)) {
        throw new Error('Usage: L3-BF-195-collapse-2d-ascii.ts <vault-root> [--state <state.json>] [--max-inline-edges N|inf] [--max-inline-nodes N|inf] [--max-depth N]')
    }
    return {fixturePath: null, label: null, vaultRoot: positionals[0] ? path.resolve(positionals[0]) : null, statePath, options: {maxInlineEdges, maxInlineNodes, maxDepth}}
}

function main(): void {
    const {fixturePath, label, vaultRoot, statePath, options} = parseArgs(process.argv.slice(2))
    const dataset: Dataset = fixturePath
        ? loadDatasetFromFixture(fixturePath, label)
        : loadDatasetFromState(
            statePath ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : loadStateFromRoot(vaultRoot!),
            vaultRoot ?? lcpOfIds(Object.keys((JSON.parse(fs.readFileSync(statePath!, 'utf8')) as JsonState).graph.nodes)),
        )
    process.stdout.write(buildRecursive2dAscii(dataset, options).text)
}

if (import.meta.url === `file://${process.argv[1]}`) main()

export {DEFAULTS, buildRecursive2dAscii, loadDatasetFromFixture, loadDatasetFromState}
export type {Dataset, FixtureJson, FragmentPlan, FragmentRender, GraphNode, Recursive2D, RenderOptions}

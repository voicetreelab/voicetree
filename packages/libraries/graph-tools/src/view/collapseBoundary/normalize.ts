import path from 'node:path'
import {computeArboricity, type DirectedEdge} from '@vt/graph-tools/scripts/L3-BF-192-tree-cover-render'

import type {CollapseBoundaryGraph, CollapseBoundaryNode, FindCollapseBoundaryOptions} from './types'

export interface NormalizedGraph {
    readonly rootName: string
    readonly nodes: readonly CollapseBoundaryNode[]
    readonly nodeById: ReadonlyMap<string, CollapseBoundaryNode>
    readonly edges: readonly DirectedEdge[]
    readonly forests: readonly (readonly DirectedEdge[])[]
    readonly protectedIds: ReadonlySet<string>
    readonly pageRank: ReadonlyMap<string, number>
}

export function normalizeGraph(
    graph: CollapseBoundaryGraph,
    options: FindCollapseBoundaryOptions,
): NormalizedGraph {
    const nodeById: Map<string, CollapseBoundaryNode> = new Map(graph.nodes.map(node => [node.id, node]))
    const edges: DirectedEdge[] = []
    for (const node of graph.nodes) {
        for (const targetId of node.outgoingIds) {
            if (targetId === node.id || !nodeById.has(targetId)) continue
            edges.push({src: node.id, tgt: targetId})
        }
    }
    return {
        rootName: graph.rootName,
        nodes: graph.nodes,
        nodeById,
        edges,
        forests: computeArboricity(graph.nodes.length, edges).forests,
        protectedIds: buildProtectedIds(graph.nodes, nodeById, edges, options),
        pageRank: computePageRank(graph.nodes, edges),
    }
}

export function normalizeSelectableId(value: string): string {
    return value.replace(/\\/g, '/').replace(/\.md$/i, '')
}

function buildProtectedIds(
    nodes: readonly CollapseBoundaryNode[],
    nodeById: ReadonlyMap<string, CollapseBoundaryNode>,
    edges: readonly DirectedEdge[],
    options: FindCollapseBoundaryOptions,
): ReadonlySet<string> {
    const rawSeeds: readonly string[] = [
        ...(options.selectedIds ?? []),
        ...(options.focusNodeId ? [options.focusNodeId] : []),
    ]
    if (rawSeeds.length === 0) {
        return new Set()
    }

    const relPathMap: Map<string, string> = new Map()
    const basenames = new Map<string, string[]>()
    for (const node of nodes) {
        relPathMap.set(normalizeSelectableId(node.relPath), node.id)
        const basename: string = path.posix.basename(normalizeSelectableId(node.relPath))
        const ids: string[] = basenames.get(basename) ?? []
        ids.push(node.id)
        basenames.set(basename, ids)
    }

    const resolvedSeeds = new Set<string>()
    for (const rawSeed of rawSeeds) {
        const trimmed: string = rawSeed.trim()
        if (trimmed.length === 0) continue
        if (nodeById.has(trimmed)) {
            resolvedSeeds.add(trimmed)
            continue
        }

        const normalized: string = normalizeSelectableId(trimmed)
        const relMatch: string | undefined = relPathMap.get(normalized)
        if (relMatch) {
            resolvedSeeds.add(relMatch)
            continue
        }

        const basename: string = path.posix.basename(normalized)
        const ids: readonly string[] = basenames.get(basename) ?? []
        if (ids.length === 1) {
            resolvedSeeds.add(ids[0]!)
        }
    }

    if (resolvedSeeds.size === 0) {
        return resolvedSeeds
    }

    const neighbors = new Map<string, Set<string>>()
    for (const node of nodes) {
        neighbors.set(node.id, new Set())
    }
    for (const edge of edges) {
        neighbors.get(edge.src)?.add(edge.tgt)
        neighbors.get(edge.tgt)?.add(edge.src)
    }

    const protectedIds = new Set<string>()
    for (const seed of resolvedSeeds) {
        protectedIds.add(seed)
        for (const neighbor of neighbors.get(seed) ?? []) {
            protectedIds.add(neighbor)
        }
    }
    return protectedIds
}

function computePageRank(
    nodes: readonly CollapseBoundaryNode[],
    edges: readonly DirectedEdge[],
): ReadonlyMap<string, number> {
    if (nodes.length === 0) {
        return new Map()
    }

    const ids: readonly string[] = nodes.map(node => node.id)
    const outgoing = new Map<string, string[]>()
    const incoming = new Map<string, string[]>()
    for (const nodeId of ids) {
        outgoing.set(nodeId, [])
        incoming.set(nodeId, [])
    }

    for (const edge of edges) {
        if (edge.src === edge.tgt) continue
        outgoing.get(edge.src)?.push(edge.tgt)
        incoming.get(edge.tgt)?.push(edge.src)
    }

    const nodeCount: number = nodes.length
    let ranks: Map<string, number> = new Map(ids.map(nodeId => [nodeId, 1 / nodeCount]))
    const damping = 0.85

    for (let iteration = 0; iteration < 25; iteration += 1) {
        let danglingShare = 0
        for (const nodeId of ids) {
            const degree: number = outgoing.get(nodeId)?.length ?? 0
            if (degree === 0) {
                danglingShare += (ranks.get(nodeId) ?? 0) / nodeCount
            }
        }

        const nextRanks = new Map<string, number>()
        for (const nodeId of ids) {
            let score: number = (1 - damping) / nodeCount
            score += damping * danglingShare
            for (const sourceId of incoming.get(nodeId) ?? []) {
                const outDegree: number = outgoing.get(sourceId)?.length ?? 0
                if (outDegree === 0) continue
                score += damping * (ranks.get(sourceId) ?? 0) / outDegree
            }
            nextRanks.set(nodeId, score)
        }
        ranks = nextRanks
    }

    return ranks
}

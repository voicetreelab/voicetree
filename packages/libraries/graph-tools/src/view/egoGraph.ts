/**
 * BF-200 — ego-graph algorithms for agent-UX observability.
 *
 * Pure functions operating on Graph (from State.graph). Three exported algorithms:
 *   focus()       — N-hop ego subgraph (node IDs)
 *   neighbors()   — N-hop neighborhood (node IDs, excluding center)
 *   shortestPath() — BFS shortest undirected path
 *
 * Three corresponding text renderers for CLI output.
 */
import nodePath from 'path'
import type {State} from '@vt/graph-state/contract'

type Graph = State['graph']

function adjUndirected(graph: Graph, nodeId: string): string[] {
    if (!graph.nodes[nodeId]) return []
    const outgoing = graph.nodes[nodeId].outgoingEdges.map((e) => e.targetId)
    const incoming = [...(graph.incomingEdgesIndex.get(nodeId) ?? [])]
    const adj = new Set([...outgoing, ...incoming])
    adj.delete(nodeId)
    return [...adj].filter((id) => graph.nodes[id] !== undefined)
}

/** Returns all node IDs within `hops` of `nodeId`, including the center. */
export function focus(graph: Graph, nodeId: string, hops: number = 1): string[] {
    if (!graph.nodes[nodeId]) return []
    const visited = new Set<string>([nodeId])
    let frontier = [nodeId]
    for (let h = 0; h < hops; h++) {
        const next: string[] = []
        for (const id of frontier) {
            for (const adj of adjUndirected(graph, id)) {
                if (!visited.has(adj)) {
                    visited.add(adj)
                    next.push(adj)
                }
            }
        }
        frontier = next
        if (next.length === 0) break
    }
    return [...visited]
}

/** Returns all node IDs within `hops` of `nodeId`, excluding the center. */
export function neighbors(graph: Graph, nodeId: string, hops: number = 1): string[] {
    const all = focus(graph, nodeId, hops)
    return all.filter((id) => id !== nodeId)
}

/** BFS shortest undirected path from `a` to `b`. Returns null if no path. */
export function shortestPath(graph: Graph, a: string, b: string): string[] | null {
    if (!graph.nodes[a] || !graph.nodes[b]) return null
    if (a === b) return [a]
    const prev = new Map<string, string>()
    const visited = new Set<string>([a])
    const queue: string[] = [a]
    while (queue.length > 0) {
        const curr = queue.shift()!
        for (const adj of adjUndirected(graph, curr)) {
            if (!visited.has(adj)) {
                visited.add(adj)
                prev.set(adj, curr)
                if (adj === b) {
                    const result: string[] = []
                    let c: string | undefined = b
                    while (c !== undefined) {
                        result.unshift(c)
                        c = prev.get(c)
                    }
                    return result
                }
                queue.push(adj)
            }
        }
    }
    return null
}

// ── text renderers ─────────────────────────────────────────────────────────────
//
// Renderers return a discriminated EgoRender so the CLI shell can choose an exit
// code: a typo'd / unknown node ('not-found') is a CALLER ERROR and must exit
// non-zero, whereas a genuine 'no-path' between two real nodes is a valid query
// result and exits 0. Both used to print a message and exit 0, making a typo
// indistinguishable from a real no-path. See REC 5.

export type EgoRender =
    | {readonly kind: 'ok'; readonly text: string}
    | {readonly kind: 'not-found'; readonly text: string}
    | {readonly kind: 'no-path'; readonly text: string}

function bn(id: string): string {
    return nodePath.basename(id)
}

export function renderFocus(graph: Graph, nodeId: string, hops: number = 1): EgoRender {
    if (!graph.nodes[nodeId]) return {kind: 'not-found', text: `node not found: ${nodeId}`}
    const ids = focus(graph, nodeId, hops)
    const inSet = new Set(ids)
    const lines: string[] = []
    lines.push(`Focus: ${bn(nodeId)} (${hops}-hop ego graph, ${ids.length} nodes)`)
    lines.push('')
    const incoming = [...(graph.incomingEdgesIndex.get(nodeId) ?? [])].filter((id) => inSet.has(id))
    const outgoing = graph.nodes[nodeId].outgoingEdges.filter((e) => inSet.has(e.targetId))
    if (incoming.length > 0) {
        lines.push('Incoming:')
        for (const id of incoming) lines.push(`  ${bn(id)} → ${bn(nodeId)}`)
    }
    if (outgoing.length > 0) {
        lines.push('Outgoing:')
        for (const e of outgoing) lines.push(`  ${bn(nodeId)} → ${bn(e.targetId)}`)
    }
    const direct = new Set([nodeId, ...incoming, ...outgoing.map((e) => e.targetId)])
    const others = ids.filter((id) => !direct.has(id))
    if (others.length > 0) {
        lines.push('Also reachable:')
        for (const id of others) lines.push(`  ${bn(id)}`)
    }
    return {kind: 'ok', text: lines.join('\n')}
}

export function renderNeighbors(graph: Graph, nodeId: string, hops: number = 1): EgoRender {
    if (!graph.nodes[nodeId]) return {kind: 'not-found', text: `node not found: ${nodeId}`}
    const result = neighbors(graph, nodeId, hops)
    const lines = [`Neighbors of ${bn(nodeId)} (${hops}-hop): ${result.length} found`]
    for (const id of result) lines.push(`  ${bn(id)}`)
    return {kind: 'ok', text: lines.join('\n')}
}

export function renderPath(graph: Graph, a: string, b: string): EgoRender {
    // Distinguish an unknown endpoint (typo => caller error) from a genuine
    // disconnected pair (both endpoints exist but no path => valid result).
    // `shortestPath` returns null for BOTH cases, so check membership first.
    const missing = [a, b].filter((id) => !graph.nodes[id])
    if (missing.length > 0) {
        return {kind: 'not-found', text: `node not found: ${missing.join(', ')}`}
    }
    const p = shortestPath(graph, a, b)
    if (p === null) return {kind: 'no-path', text: `no path from ${bn(a)} to ${bn(b)}`}
    return {kind: 'ok', text: p.map(bn).join(' → ')}
}

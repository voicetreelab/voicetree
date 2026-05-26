/**
 * Undirected shortest-path distance between two modules in the import graph.
 *
 * "Undirected" because the severity question is "how far apart are these
 * modules in the codebase's coupling topology?" — direction is irrelevant
 * for that. `a imports b` and `b imports a` both mean "distance 1".
 *
 * Capped at MAX_IMPORT_DISTANCE so pathological deep BFS does not dominate
 * a per-call run and so unreachable pairs still contribute a sane,
 * comparable number (the spec calls this "the *most* concerning" case —
 * two modules with no path either direction get the cap, not skipped).
 *
 * Index construction is O(V + E). One BFS is O(V + E) with the cap acting
 * as an extra early-out. The orchestrator that consumes this should hold
 * the index across many queries (build once, query many times).
 */
import type {ImportGraph, SourceFile} from './import-graph.ts'

export const MAX_IMPORT_DISTANCE: number = 8

export type UndirectedImportIndex = {
    readonly relativePathToFile: ReadonlyMap<string, SourceFile>
    readonly adjacency: ReadonlyMap<string, readonly string[]>
}

export function buildUndirectedImportIndex(graph: ImportGraph): UndirectedImportIndex {
    const relativePathToFile = new Map<string, SourceFile>()
    for (const file of graph.files) relativePathToFile.set(file.relativePath, file)

    const adjacency = new Map<string, Set<string>>()
    function addEdge(a: string, b: string): void {
        const existing = adjacency.get(a)
        if (existing) existing.add(b)
        else adjacency.set(a, new Set([b]))
    }

    for (const edge of graph.edges) {
        const fromKey = edge.from.relativePath
        const toKey = edge.to.relativePath
        if (fromKey === toKey) continue
        addEdge(fromKey, toKey)
        addEdge(toKey, fromKey)
    }

    // Freeze the adjacency as readonly arrays so the returned index is
    // safe to share across many queries without defensive copies.
    const frozen = new Map<string, readonly string[]>()
    for (const [node, neighbours] of adjacency) {
        frozen.set(node, [...neighbours])
    }
    return {relativePathToFile, adjacency: frozen}
}

/**
 * Undirected BFS distance from `fromRelPath` to `toRelPath`.
 *
 * Returns:
 *   0                    — same file
 *   k in [1, MAX-1]      — shortest hop count
 *   MAX_IMPORT_DISTANCE  — unreachable, missing endpoint, or beyond the cap
 *
 * Missing endpoint is treated identically to unreachable — both mean the
 * graph cannot tell us how close the modules are, and the severity formula
 * should weight that case maximally per the spec.
 */
export function shortestImportDistance(
    index: UndirectedImportIndex,
    fromRelPath: string,
    toRelPath: string,
): number {
    if (fromRelPath === toRelPath) return 0
    if (!index.relativePathToFile.has(fromRelPath)) return MAX_IMPORT_DISTANCE
    if (!index.relativePathToFile.has(toRelPath)) return MAX_IMPORT_DISTANCE

    const visited = new Set<string>([fromRelPath])
    let frontier: string[] = [fromRelPath]
    for (let depth = 1; depth < MAX_IMPORT_DISTANCE; depth += 1) {
        const next: string[] = []
        for (const node of frontier) {
            const neighbours = index.adjacency.get(node)
            if (!neighbours) continue
            for (const neighbour of neighbours) {
                if (neighbour === toRelPath) return depth
                if (visited.has(neighbour)) continue
                visited.add(neighbour)
                next.push(neighbour)
            }
        }
        if (next.length === 0) return MAX_IMPORT_DISTANCE
        frontier = next
    }
    return MAX_IMPORT_DISTANCE
}

/** Diagnostic: count of vertices and undirected edges in the index. */
export function importIndexStats(index: UndirectedImportIndex): {vertices: number; edges: number} {
    let edgeCount = 0
    for (const neighbours of index.adjacency.values()) edgeCount += neighbours.length
    return {
        vertices: index.relativePathToFile.size,
        edges: edgeCount / 2,
    }
}

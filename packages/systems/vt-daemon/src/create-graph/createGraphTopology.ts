/**
 * Pure topology helpers for createGraphTool: cycle detection and topological
 * sort over parent references declared in each node's content body via
 * `- parent [[name|label]]` lines.
 *
 * Only in-batch parents (those whose normalized filename matches another
 * node's `filename` in the same call) participate in topology. Parent lines
 * pointing outside the batch are ignored here — they resolve at parse time
 * via the canonical wikilink matcher.
 *
 * Author input `parent.md` and a child's `- parent [[parent]]` must hash to
 * the same key, so both the batch's filename set and each parent line go
 * through `normalizeBatchFilenameKey` (strip `./`, normalize slashes, drop
 * `.md`). Matches the normalization `extractParentRefs` applies to its
 * wikilink targets.
 */

import {extractParentRefs, normalizeBatchFilenameKey} from '@vt/graph-model/markdown'
import type {CreateGraphNodeInput} from './createGraphTypes'

/** Normalized in-batch parent keys declared in this node's content body. */
export function parentFilenamesFromContent(node: CreateGraphNodeInput): readonly string[] {
    return extractParentRefs(node.content ?? '').map(ref => ref.filename)
}

/**
 * Detect cycles in parent references using DFS.
 * Supports multiple parents per node (DAG validation).
 */
export function hasCycle(nodes: readonly CreateGraphNodeInput[]): boolean {
    const filenameKeys: Set<string> = new Set(nodes.map(n => normalizeBatchFilenameKey(n.filename)))
    const adjacency: Map<string, string[]> = new Map()
    for (const node of nodes) {
        const childKey: string = normalizeBatchFilenameKey(node.filename)
        for (const parentKey of parentFilenamesFromContent(node)) {
            if (!filenameKeys.has(parentKey)) continue
            const children: string[] = adjacency.get(parentKey) ?? []
            children.push(childKey)
            adjacency.set(parentKey, children)
        }
    }

    const visited: Set<string> = new Set()
    const inStack: Set<string> = new Set()

    function dfs(nodeKey: string): boolean {
        if (inStack.has(nodeKey)) return true
        if (visited.has(nodeKey)) return false

        visited.add(nodeKey)
        inStack.add(nodeKey)

        for (const child of adjacency.get(nodeKey) ?? []) {
            if (dfs(child)) return true
        }

        inStack.delete(nodeKey)
        return false
    }

    for (const node of nodes) {
        const key: string = normalizeBatchFilenameKey(node.filename)
        if (!visited.has(key) && dfs(key)) return true
    }

    return false
}

/**
 * Topological sort: all in-batch parents come before their children.
 */
export function topologicalSort(nodes: readonly CreateGraphNodeInput[]): CreateGraphNodeInput[] {
    const nodeMap: Map<string, CreateGraphNodeInput> = new Map(
        nodes.map(n => [normalizeBatchFilenameKey(n.filename), n])
    )
    const visited: Set<string> = new Set()
    const result: CreateGraphNodeInput[] = []

    function visit(nodeKey: string): void {
        if (visited.has(nodeKey)) return
        visited.add(nodeKey)

        const node: CreateGraphNodeInput | undefined = nodeMap.get(nodeKey)
        if (!node) return

        for (const parentKey of parentFilenamesFromContent(node)) {
            if (nodeMap.has(parentKey)) visit(parentKey)
        }

        result.push(node)
    }

    for (const node of nodes) visit(normalizeBatchFilenameKey(node.filename))
    return result
}

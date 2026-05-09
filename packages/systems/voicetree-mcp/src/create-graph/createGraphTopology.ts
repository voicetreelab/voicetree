/**
 * Pure topology helpers for createGraphTool: cycle detection and topological
 * sort over the parent references on CreateGraphNodeInput.
 *
 * Extracted to keep createGraphTool.ts under the 500-line ceiling. No side
 * effects — these functions only read the array of node inputs.
 */

import type {CreateGraphNodeInput, ParentRef} from './createGraphTypes'

/** Extract the filename from a ParentRef. */
export function parentRefFilename(ref: ParentRef): string {
    return ref.filename
}

/** Extract the edge label from a ParentRef. Returns undefined for empty strings. */
export function parentRefEdgeLabel(ref: ParentRef): string | undefined {
    return ref.edgeLabel || undefined
}

/**
 * Detect cycles in parent references using DFS.
 * Supports multiple parents per node (DAG validation).
 * Returns true if a cycle exists.
 */
export function hasCycle(nodes: readonly CreateGraphNodeInput[]): boolean {
    const adjacency: Map<string, string[]> = new Map()
    for (const node of nodes) {
        if (node.parents) {
            for (const parentRef of node.parents) {
                const parentId: string = parentRefFilename(parentRef)
                const children: string[] = adjacency.get(parentId) ?? []
                children.push(node.filename)
                adjacency.set(parentId, children)
            }
        }
    }

    const visited: Set<string> = new Set()
    const inStack: Set<string> = new Set()

    function dfs(nodeId: string): boolean {
        if (inStack.has(nodeId)) return true
        if (visited.has(nodeId)) return false

        visited.add(nodeId)
        inStack.add(nodeId)

        for (const child of adjacency.get(nodeId) ?? []) {
            if (dfs(child)) return true
        }

        inStack.delete(nodeId)
        return false
    }

    for (const node of nodes) {
        if (!visited.has(node.filename)) {
            if (dfs(node.filename)) return true
        }
    }

    return false
}

/**
 * Topological sort of nodes by parent dependencies.
 * All parents come before their children in the output.
 * Supports multiple parents per node.
 */
export function topologicalSort(nodes: readonly CreateGraphNodeInput[]): CreateGraphNodeInput[] {
    const nodeMap: Map<string, CreateGraphNodeInput> = new Map()
    for (const node of nodes) {
        nodeMap.set(node.filename, node)
    }

    const visited: Set<string> = new Set()
    const result: CreateGraphNodeInput[] = []

    function visit(nodeId: string): void {
        if (visited.has(nodeId)) return
        visited.add(nodeId)

        const node: CreateGraphNodeInput | undefined = nodeMap.get(nodeId)
        if (!node) return

        if (node.parents) {
            for (const parentRef of node.parents) {
                const parentId: string = parentRefFilename(parentRef)
                if (nodeMap.has(parentId)) {
                    visit(parentId)
                }
            }
        }

        result.push(node)
    }

    for (const node of nodes) {
        visit(node.filename)
    }

    return result
}

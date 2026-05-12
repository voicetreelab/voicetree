import path from 'path'
import normalizePath from 'normalize-path'
import type {ComplexityScore} from '@vt/graph-tools/node'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'

export type ValidationRuleId = 'grandparent_attachment' | 'node_line_limit'

export interface OverrideEntry {
    readonly ruleId: ValidationRuleId
    readonly rationale: string
}

export type ParentRef = { readonly filename: string; readonly edgeLabel: string }

export function parentRefFilename(ref: ParentRef): string {
    return ref.filename
}

export function parentRefEdgeLabel(ref: ParentRef): string | undefined {
    return ref.edgeLabel || undefined
}

export interface CreateGraphNodeInput {
    readonly filename: string
    readonly title: string
    readonly summary: string
    readonly content?: string
    readonly color?: string
    readonly diagram?: string
    readonly notes?: readonly string[]
    readonly codeDiffs?: readonly string[]
    readonly filesChanged?: readonly string[]
    readonly complexityScore?: ComplexityScore
    readonly complexityExplanation?: string
    readonly linkedArtifacts?: readonly string[]
    readonly parents?: readonly ParentRef[]
}

export interface CreateGraphParams {
    readonly callerTerminalId: string
    readonly parentNodeId?: string
    readonly outputPath?: string
    readonly nodes: readonly CreateGraphNodeInput[]
    readonly override_with_rationale?: readonly OverrideEntry[]
}

export interface CreatedNodeInfo {
    readonly nodeId: NodeIdAndFilePath
    readonly baseName: string
}

export type NodeResult = {
    readonly id: string
    readonly path: string
    readonly status: 'ok' | 'warning'
    readonly warning?: string
}

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

function isPathWithinDirectory(targetPath: string, directoryPath: string): boolean {
    return targetPath === directoryPath || targetPath.startsWith(`${directoryPath}/`)
}

export function resolveOutputDirectory(
    writePath: string,
    outputPath: string | undefined,
    allowedVaultPaths: readonly string[]
): { readonly ok: true; readonly path: string } | { readonly ok: false; readonly error: string } {
    if (!outputPath || outputPath.trim() === '') {
        return {ok: true, path: normalizePath(writePath)}
    }

    const requestedPath: string = outputPath.trim()
    const resolvedPath: string = normalizePath(
        path.isAbsolute(requestedPath)
            ? requestedPath
            : path.resolve(writePath, requestedPath)
    )

    if (allowedVaultPaths.some((allowedPath: string) => isPathWithinDirectory(resolvedPath, allowedPath))) {
        return {ok: true, path: resolvedPath}
    }

    return {
        ok: false,
        error: `outputPath "${outputPath}" resolves to "${resolvedPath}" which is outside the loaded vault paths. Choose a path inside one of: ${allowedVaultPaths.join(', ')}`,
    }
}

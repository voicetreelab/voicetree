import { buildJsonResponse } from '../../_shared/toolResponse.ts'
import type { McpToolResponse } from '../../_shared/toolResponse.ts'
import {
    buildUniqueBasenameMap,
    deriveTitle,
    extractLinks,
    getNodeId,
    resolveLinkTarget,
    scanMarkdownFiles,
    type StructureNode,
} from '@vt/graph-tools/node'
import { readFileSync } from 'node:fs'
import path from 'node:path'

export interface GraphStructureParams {
    readonly folderPath: string
    readonly withSummaries?: boolean
}

interface GraphStructureNode extends StructureNode {
    readonly absolutePath: string
    readonly content: string
}

export async function graphStructureTool(params: GraphStructureParams): Promise<McpToolResponse> {
    const result = buildGraphStructure(params.folderPath, params.withSummaries)
    return buildJsonResponse(result)
}

function buildGraphStructure(folderPath: string, withSummaries: boolean | undefined): {
    readonly success: true
    readonly nodeCount: number
    readonly orphanCount: number
    readonly ascii: string
} {
    const root: string = path.resolve(folderPath)
    const nodes: readonly GraphStructureNode[] = buildNodes(root)
    const nodeById: ReadonlyMap<string, GraphStructureNode> = new Map(nodes.map(node => [node.id, node]))
    const incomingCounts: Map<string, number> = new Map(nodes.map(node => [node.id, 0]))
    for (const node of nodes) {
        for (const targetId of node.outgoingIds) {
            incomingCounts.set(targetId, (incomingCounts.get(targetId) ?? 0) + 1)
        }
    }

    const roots: readonly GraphStructureNode[] = nodes
        .filter(node => (incomingCounts.get(node.id) ?? 0) === 0)
        .sort(compareNodes)
    const treeLines: string[] = []
    roots.forEach((node, index) => {
        renderNode(node, index === roots.length - 1, '', true, nodeById, new Set(), treeLines)
    })
    const summaryNodes: readonly GraphStructureNode[] = collectRenderOrder(roots, nodeById)

    const includeSummaries: boolean = withSummaries ?? (nodes.length > 0 && nodes.length < 20)
    const ascii: string = includeSummaries
        ? renderWithSummaries(treeLines.join('\n'), summaryNodes)
        : treeLines.join('\n')

    return {
        success: true,
        nodeCount: nodes.length,
        orphanCount: nodes.filter(node => node.outgoingIds.length === 0 && (incomingCounts.get(node.id) ?? 0) === 0).length,
        ascii,
    }
}

function buildNodes(root: string): readonly GraphStructureNode[] {
    const contentById: Map<string, {readonly absolutePath: string; readonly content: string}> = new Map()
    const structureNodes: Map<string, StructureNode> = new Map()
    for (const absolutePath of scanMarkdownFiles(root)) {
        const id: string = getNodeId(root, absolutePath)
        const content: string = readFileSync(absolutePath, 'utf-8')
        contentById.set(id, {absolutePath, content})
        structureNodes.set(id, {id, title: deriveTitle(content, absolutePath), outgoingIds: []})
    }

    const uniqueBasenames: ReadonlyMap<string, string> = buildUniqueBasenameMap(structureNodes)
    return [...structureNodes.values()].map(node => {
        const record = contentById.get(node.id)
        if (!record) throw new Error(`Missing markdown content for graph node: ${node.id}`)

        const outgoingIds: string[] = []
        for (const link of extractLinks(record.content)) {
            const targetId: string | undefined = resolveLinkTarget(link, node.id, structureNodes, uniqueBasenames)
            if (targetId && targetId !== node.id) {
                outgoingIds.push(targetId)
            }
        }

        return {...node, absolutePath: record.absolutePath, content: record.content, outgoingIds}
    })
}

function renderNode(
    node: GraphStructureNode,
    isLast: boolean,
    prefix: string,
    isRoot: boolean,
    nodeById: ReadonlyMap<string, GraphStructureNode>,
    ancestors: ReadonlySet<string>,
    lines: string[],
): void {
    lines.push(`${isRoot ? '' : `${prefix}${isLast ? '└── ' : '├── '}`}${node.title}`)
    if (ancestors.has(node.id)) return

    const nextAncestors: Set<string> = new Set(ancestors)
    nextAncestors.add(node.id)
    const children: readonly GraphStructureNode[] = node.outgoingIds
        .map(id => nodeById.get(id))
        .filter((child): child is GraphStructureNode => child !== undefined)
        .sort(compareNodes)
    const childPrefix: string = isRoot ? '' : `${prefix}${isLast ? '    ' : '│   '}`
    children.forEach((child, index) => {
        renderNode(child, index === children.length - 1, childPrefix, false, nodeById, nextAncestors, lines)
    })
}

function renderWithSummaries(tree: string, nodes: readonly GraphStructureNode[]): string {
    const lines: string[] = ['Tree structure:', tree, '', '## Node Contents']
    for (const node of nodes) {
        lines.push(`- **${node.title}** (${node.absolutePath})`)
        lines.push(...summarizeContent(node.content))
    }
    return lines.join('\n')
}

function collectRenderOrder(
    roots: readonly GraphStructureNode[],
    nodeById: ReadonlyMap<string, GraphStructureNode>,
): readonly GraphStructureNode[] {
    const ordered: GraphStructureNode[] = []
    const seen: Set<string> = new Set()
    const visit = (node: GraphStructureNode): void => {
        if (seen.has(node.id)) return
        seen.add(node.id)
        ordered.push(node)
        const children: readonly GraphStructureNode[] = node.outgoingIds
            .map(id => nodeById.get(id))
            .filter((child): child is GraphStructureNode => child !== undefined)
            .sort(compareNodes)
        children.forEach(visit)
    }
    roots.forEach(visit)
    return ordered
}

function summarizeContent(content: string): string[] {
    const details: readonly string[] = content
        .replace(/^---\n[\s\S]*?\n---\n?/, '')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'))
    const visible: readonly string[] = details.slice(0, 3)
    const hiddenCount: number = Math.max(0, details.length - visible.length)
    const lines: string[] = visible.map(line => `  ${line}`)
    if (hiddenCount > 0) {
        lines.push(`  ...${hiddenCount} additional lines`)
    }
    return lines
}

function compareNodes(left: GraphStructureNode, right: GraphStructureNode): number {
    return left.title.localeCompare(right.title)
}

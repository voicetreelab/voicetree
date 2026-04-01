import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'
import { buildGraphFromFiles } from '@/pure/graph/buildGraphFromFiles'
import { graphToAscii } from '@/pure/graph/markdown-writing/graphToAscii'
import { reverseGraphEdges } from '@/pure/graph/graph-operations/graph-transformations'
import type { Graph, GraphNode } from '@/pure/graph'
import { buildJsonResponse } from './types'
import type { McpToolResponse } from './types'

export interface GraphStructureParams {
    readonly folderPath: string
}

export async function graphStructureTool(params: GraphStructureParams): Promise<McpToolResponse> {
    const { folderPath } = params

    const mdFiles: readonly string[] = scanMarkdownFiles(folderPath)

    if (mdFiles.length === 0) {
        return buildJsonResponse({ success: true, nodeCount: 0, ascii: '', orphanCount: 0 })
    }

    const files: readonly { absolutePath: string; content: string }[] = mdFiles.map(filePath => ({
        absolutePath: filePath,
        content: readFileSync(filePath, 'utf-8')
    }))

    const graph: Graph = buildGraphFromFiles(files)

    const ascii: string = graphToAscii(graph)

    const nodeCount: number = Object.keys(graph.nodes).length
    const reversedGraph: Graph = reverseGraphEdges(graph)
    const orphanCount: number = Object.values(graph.nodes).filter((node: GraphNode) => {
        const hasOutgoing: boolean = node.outgoingEdges.length > 0
        const reversedNode: GraphNode | undefined = reversedGraph.nodes[node.absoluteFilePathIsID]
        const hasIncoming: boolean = reversedNode ? reversedNode.outgoingEdges.length > 0 : false
        return !hasOutgoing && !hasIncoming
    }).length

    return buildJsonResponse({
        success: true,
        nodeCount,
        ascii,
        orphanCount,
        folderName: path.basename(folderPath)
    })
}

function scanMarkdownFiles(dirPath: string): readonly string[] {
    const results: string[] = []

    function walk(dir: string): void {
        const entries: string[] = readdirSync(dir)
        for (const entry of entries) {
            if (entry === 'ctx-nodes') continue
            if (entry.startsWith('.')) continue

            const fullPath: string = path.join(dir, entry)
            const stat: ReturnType<typeof statSync> = statSync(fullPath)
            if (stat.isDirectory()) {
                walk(fullPath)
            } else if (entry.endsWith('.md')) {
                results.push(fullPath)
            }
        }
    }

    walk(dirPath)
    return results
}

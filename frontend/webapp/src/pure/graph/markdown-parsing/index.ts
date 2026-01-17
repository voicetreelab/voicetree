import { parseMarkdownToGraphNode } from './parse-markdown-to-node'
import { extractEdges } from './extract-edges'
import { nodeIdToFilePathWithExtension, filenameToNodeId } from './filename-utils'
import { markdownToTitle } from './markdown-to-title'
import type { GraphNode, NodeIdAndFilePath, Edge, Graph, FilePath } from '@/pure/graph'

// === MARKDOWN PARSING ===

export type ParseMarkdownToGraphNode = (content: string, filename: string, graph: Graph) => GraphNode

export type ExtractLinkedNodeIds = (content: string, nodes: Record<NodeIdAndFilePath, GraphNode>) => readonly Edge[]

// === FILENAME UTILITIES ===

export type NodeIdToFilePathWithExtension = (nodeId: NodeIdAndFilePath) => string

export type FilenameToNodeId = (filename: string) => NodeIdAndFilePath

// === TITLE DERIVATION ===

export type MarkdownToTitle = (content: string, filePath: FilePath) => string

export type GetNodeTitle = (node: GraphNode) => string

/**
 * Derive title from a GraphNode.
 * Uses Markdown content as the single source of truth for titles.
 * Priority: first heading > first line > filename
 */
export function getNodeTitle(node: GraphNode): string {
    return markdownToTitle(node.contentWithoutYamlOrLinks, node.absoluteFilePathIsID)
}

// === EXPORTS ===

export { parseMarkdownToGraphNode } from './parse-markdown-to-node'
void (parseMarkdownToGraphNode satisfies ParseMarkdownToGraphNode)

export { extractEdges as extractLinkedNodeIds } from './extract-edges'
void (extractEdges satisfies ExtractLinkedNodeIds)

export { nodeIdToFilePathWithExtension } from './filename-utils'
void (nodeIdToFilePathWithExtension satisfies NodeIdToFilePathWithExtension)

export { filenameToNodeId } from './filename-utils'
void (filenameToNodeId satisfies FilenameToNodeId)

export { markdownToTitle } from './markdown-to-title'
void (markdownToTitle satisfies MarkdownToTitle)

void (getNodeTitle satisfies GetNodeTitle)

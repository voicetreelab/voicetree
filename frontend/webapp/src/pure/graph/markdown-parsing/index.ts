import { parseMarkdownToGraphNode } from './parse-markdown-to-node.ts'
import { extractEdges } from './extract-edges.ts'
import { nodeIdToFilePathWithExtension, filenameToNodeId } from './filename-utils.ts'
import type { GraphNode, NodeIdAndFilePath, Edge, Graph } from '@/pure/graph'

// === MARKDOWN PARSING ===

export type ParseMarkdownToGraphNode = (content: string, filename: string, graph: Graph) => GraphNode

export type ExtractLinkedNodeIds = (content: string, nodes: Record<NodeIdAndFilePath, GraphNode>) => readonly Edge[]

// === FILENAME UTILITIES ===

export type NodeIdToFilePathWithExtension = (nodeId: NodeIdAndFilePath) => string

export type FilenameToNodeId = (filename: string) => NodeIdAndFilePath

// === EXPORTS ===

export { parseMarkdownToGraphNode } from './parse-markdown-to-node.ts'
void (parseMarkdownToGraphNode satisfies ParseMarkdownToGraphNode)

export { extractEdges as extractLinkedNodeIds } from './extract-edges.ts'
void (extractEdges satisfies ExtractLinkedNodeIds)

export { nodeIdToFilePathWithExtension } from './filename-utils.ts'
void (nodeIdToFilePathWithExtension satisfies NodeIdToFilePathWithExtension)

export { filenameToNodeId } from './filename-utils.ts'
void (filenameToNodeId satisfies FilenameToNodeId)

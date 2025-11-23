import { parseMarkdownToGraphNode as parseMarkdownToGraphNodeImpl } from './parse-markdown-to-node.ts'
import { extractEdges as extractLinkedNodeIdsImpl } from './extract-edges.ts'
import { nodeIdToFilePathWithExtension as nodeIdToFilePathWithExtensionImpl, filenameToNodeId as filenameToNodeIdImpl } from './filename-utils.ts'
import type { GraphNode, NodeIdAndFilePath, Edge } from '@/pure/graph'

// === MARKDOWN PARSING ===

export type ParseMarkdownToGraphNode = (content: string, filename: string) => GraphNode
export const parseMarkdownToGraphNode: ParseMarkdownToGraphNode = parseMarkdownToGraphNodeImpl

export type ExtractLinkedNodeIds = (content: string, nodes: Record<NodeIdAndFilePath, GraphNode>) => readonly Edge[]
export const extractLinkedNodeIds: ExtractLinkedNodeIds = extractLinkedNodeIdsImpl

// === FILENAME UTILITIES ===

export type NodeIdToFilePathWithExtension = (nodeId: NodeIdAndFilePath) => string
export const nodeIdToFilePathWithExtension: NodeIdToFilePathWithExtension = nodeIdToFilePathWithExtensionImpl

export type FilenameToNodeId = (filename: string) => NodeIdAndFilePath
export const filenameToNodeId: FilenameToNodeId = filenameToNodeIdImpl

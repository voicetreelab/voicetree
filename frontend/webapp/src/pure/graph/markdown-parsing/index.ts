import { parseMarkdownToGraphNode as parseMarkdownToGraphNodeImpl } from './parse-markdown-to-node.ts'
import { extractLinkedNodeIds as extractLinkedNodeIdsImpl } from './extract-linked-node-ids.ts'
import { nodeIdToFilePathWithExtension as nodeIdToFilePathWithExtensionImpl, filenameToNodeId as filenameToNodeIdImpl } from './filename-utils.ts'
import type { GraphNode, NodeId } from '@/pure/graph'

// === MARKDOWN PARSING ===

export type ParseMarkdownToGraphNode = (content: string, filename: string) => GraphNode
export const parseMarkdownToGraphNode: ParseMarkdownToGraphNode = parseMarkdownToGraphNodeImpl

export type ExtractLinkedNodeIds = (content: string, nodes: Record<NodeId, GraphNode>) => readonly NodeId[]
export const extractLinkedNodeIds: ExtractLinkedNodeIds = extractLinkedNodeIdsImpl

// === FILENAME UTILITIES ===

export type NodeIdToFilePathWithExtension = (nodeId: NodeId) => string
export const nodeIdToFilePathWithExtension: NodeIdToFilePathWithExtension = nodeIdToFilePathWithExtensionImpl

export type FilenameToNodeId = (filename: string) => NodeId
export const filenameToNodeId: FilenameToNodeId = filenameToNodeIdImpl

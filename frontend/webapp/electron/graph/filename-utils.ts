import type { NodeId } from '@/graph-core/functional/types'

/**
 * Converts a filename to a node ID by removing the .md extension.
 *
 * Pure function: same input -> same output, no side effects
 *
 * @param filename - The filename (with or without path)
 * @returns Node ID (filename without .md extension)
 *
 * @example
 * ```typescript
 * filenameToNodeId("my-node.md")
 * // => "my-node"
 *
 * filenameToNodeId("subfolder/another-node.md")
 * // => "subfolder/another-node"
 * ```
 */
export function filenameToNodeId(filename: string): NodeId {
  return filename.replace(/\.md$/, '')
}

/**
 * Converts a node ID to a filename by adding .md extension.
 *
 * Pure function: same input -> same output, no side effects
 *
 * @param nodeId - The node ID
 * @returns Filename with .md extension
 *
 * @example
 * ```typescript
 * nodeIdToFilename("my-node")
 * // => "my-node.md"
 *
 * nodeIdToFilename("subfolder/another-node")
 * // => "subfolder/another-node.md"
 * ```
 */
export function nodeIdToFilename(nodeId: NodeId): string {
  return `${nodeId}.md`
}

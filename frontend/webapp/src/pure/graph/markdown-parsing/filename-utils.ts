import type { NodeId } from '@/pure/graph'

/**
 * Converts a filename to a node ID by removing the .md extension.
 *
 * Pure function: same input -> same output, no side effects
 *
 * Preserves the full relative absolutePath (if present) to support nested folder structures.
 * This allows nodes with the same filename in different folders to have unique IDs.
 *
 * @param filename - The filename (with or without absolutePath)
 * @returns GraphNode ID (filename without .md extension, absolutePath preserved)
 *
 * @example
 * ```typescript
 * filenameToNodeId("my-node.md")
 * // => "my-node"
 *
 * filenameToNodeId("subfolder/another-node.md")
 * // => "subfolder/another-node"
 *
 * filenameToNodeId("concepts/architecture.md")
 * // => "concepts/architecture"
 * ```
 */
export function filenameToNodeId(filename: string): NodeId {
  // Strip .md extension
  return filename.replace(/\.md$/, '')
  // todo, at some point we need to think about whether node relativeFilePathIsID should be filepath, node counter
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
 * nodeIdToFilePathWithExtension("my-node")
 * // => "my-node.md"
 *
 * nodeIdToFilePathWithExtension("subfolder/another-node")
 * // => "subfolder/another-node.md"
 * ```
 */
export function nodeIdToFilePathWithExtension(nodeId: NodeId): string {
  return `${nodeId}.md`
}

import type { NodeIdAndFilePath } from '@/pure/graph'
import normalizePath from 'normalize-path'

/**
 * Converts a filename to a node ID by removing the .md extension.
 *
 * Pure function: same input -> same output, no side effects
 *
 * Preserves the full relative absolutePath (if present) to support nested folder structures.
 * This allows nodes with the same filename in different folders to have unique IDs.
 * Normalizes path separators to forward slashes for cross-platform consistency.
 *
 * @param filename - The filename (with or without absolutePath)
 * @returns GraphNode ID (filename without .md extension, absolutePath preserved, forward slashes)
 *
 * @example
 * ```typescript
 * filenameToNodeId("my-node.md")
 * // => "my-node.md"
 *
 * filenameToNodeId("subfolder/another-node.md")
 * // => "subfolder/another-node.md"
 *
 * filenameToNodeId("ctx-nodes\\context_123.md")  // Windows backslash
 * // => "ctx-nodes/context_123.md"  // Normalized to forward slash
 * ```
 */
export function filenameToNodeId(filename: string): NodeIdAndFilePath {
  // Normalize path separators to forward slashes for consistent node IDs across platforms
  return normalizePath(filename);
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
export function nodeIdToFilePathWithExtension(nodeId: NodeIdAndFilePath): string {
    return nodeId.includes(".md") ? `${nodeId}` : nodeId + ".md"; // assumes md only
}

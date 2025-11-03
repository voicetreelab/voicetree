import type { NodeId } from '@/functional_graph/pure/types'

/**
 * Converts a filename to a node ID by extracting the basename without extension.
 *
 * Pure function: same input -> same output, no side effects
 *
 * IMPORTANT: This uses basename-only to match FileEventManager's normalizeFileId behavior.
 * Both systems MUST use the same ID format to avoid edge creation errors.
 *
 * @param filename - The filename (with or without path)
 * @returns Node ID (basename without .md extension and without path)
 *
 * @example
 * ```typescript
 * filenameToNodeId("my-node.md")
 * // => "my-node"
 *
 * filenameToNodeId("subfolder/another-node.md")
 * // => "another-node"  // Path stripped!
 *
 * filenameToNodeId("concepts/architecture.md")
 * // => "architecture"  // Path stripped!
 * ```
 */
export function filenameToNodeId(filename: string): NodeId {
  // Strip .md extension
  let id = filename.replace(/\.md$/, '')

  // Strip path - keep only basename
  const lastSlash = id.lastIndexOf('/')
  if (lastSlash >= 0) {
    id = id.substring(lastSlash + 1)
  }

  return id
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

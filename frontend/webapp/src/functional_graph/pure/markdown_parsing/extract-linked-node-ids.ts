import type { NodeId, GraphNode } from '@/functional_graph/pure/types'
import { nodeIdToFilePathWithExtension } from './filename-utils.ts'

/**
 * Extracts linked node IDs from markdown content.
 *
 * Pure function: same input -> same output, no side effects
 *
 * Extracts all wikilinks ([[link]]) from content and resolves them to node IDs
 * by matching against the provided nodes record. Links are resolved by:
 * 1. Matching the link text to a node's title
 * 2. Matching the link text to a node's filename
 *
 * @param content - Markdown content with wikilinks
 * @param nodes - Record of all available nodes to resolve links against
 * @returns Array of resolved node IDs (duplicates removed, order preserved)
 *
 * @example
 * ```typescript
 * const content = "See [[GraphNode A]] and [[GraphNode B]] and [[GraphNode A]] again"
 * const nodes = {
 *   "1": { relativeFilePathIsID: "1", title: "GraphNode A", ... },
 *   "2": { relativeFilePathIsID: "2", title: "GraphNode B", ... }
 * }
 *
 * extractLinkedNodeIds(content, nodes)
 * // => ["1", "2"]  // Note: duplicates removed, order preserved
 * ```
 */
export function extractLinkedNodeIds(
  content: string,
  nodes: Record<NodeId, GraphNode>
): readonly NodeId[] {
  const wikilinkRegex = /\[\[([^\]]+)\]\]/g
  const matches = [...content.matchAll(wikilinkRegex)]

  const linkedIds = matches
    .map((match) => {
      const rawLinkText = match[1].trim()

      // Strip relative path prefixes (./ or ../) to handle relative wikilinks
      const linkText = rawLinkText.replace(/^\.\.?\//g, '')

      // Find node by title, node ID, or filename matching linkText
      const targetNode = Object.values(nodes).find(
        (n) =>  n.relativeFilePathIsID === linkText || nodeIdToFilePathWithExtension(n.relativeFilePathIsID) === linkText
      )

      return targetNode?.relativeFilePathIsID
    })
    .filter((id): id is NodeId => id !== undefined)

  // Remove duplicates while preserving order
  return [...new Set(linkedIds)]
}

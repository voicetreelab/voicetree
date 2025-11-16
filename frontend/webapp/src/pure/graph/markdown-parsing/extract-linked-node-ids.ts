import type { NodeId, GraphNode } from '@/pure/graph'
import { nodeIdToFilePathWithExtension } from './filename-utils.ts'

/**
 * Extracts path segments from a path, from longest to shortest.
 * This allows preferring longer, more specific matches over shorter ones.
 *
 * @example
 * extractPathSegments("/Users/user/vault/folder/file.md")
 * => ["Users/user/vault/folder/file", "user/vault/folder/file", "vault/folder/file", "folder/file", "file"]
 */
function extractPathSegments(path: string): readonly string[] {
  // Remove extension first
  const withoutExt = path.replace(/\.md$/, '')

  const parts = withoutExt.split('/').filter(p => p.length > 0)

  if (parts.length === 0) return []

  // Build segments from longest to shortest (most specific to least specific)
  // Using Array.from with indices to generate segments functionally
  return Array.from(
    { length: parts.length },
    (_, i) => parts.slice(i).join('/')
  )
}

/**
 * Attempts to match a single path segment against available nodes.
 *
 * @param segment - Path segment to match
 * @param nodes - All available nodes
 * @returns Matching node ID or undefined
 */
function matchSegment(
  segment: string,
  nodes: Record<NodeId, GraphNode>
): NodeId | undefined {
  // Try exact match with node ID
  if (nodes[segment]) {
    return segment
  }

  // Try match with .md extension
  const segmentWithExt = `${segment}.md`
  const matchingNode = Object.values(nodes).find(
    (n) => nodeIdToFilePathWithExtension(n.relativeFilePathIsID) === segmentWithExt
  )

  return matchingNode?.relativeFilePathIsID
}

/**
 * Finds the best matching node ID for a given link text.
 * Prefers longer path matches over shorter ones for better specificity.
 *
 * @param linkText - The link text to match (can be absolute path, relative path, or filename)
 * @param nodes - All available nodes
 * @returns The best matching node ID, or undefined if no match
 */
function findBestMatchingNode(
  linkText: string,
  nodes: Record<NodeId, GraphNode>
): NodeId | undefined {
  // Extract all possible path segments from the link text
  const linkSegments = extractPathSegments(linkText)

  if (linkSegments.length === 0) return undefined

  // Try to match each segment, preferring longer matches (first in array)
  // Use reduce to find first matching segment
  return linkSegments.reduce<NodeId | undefined>(
    (foundMatch, segment) => foundMatch ?? matchSegment(segment, nodes),
    undefined
  )
}

/**
 * Extracts linked node IDs from markdown content.
 *
 * Pure function: same input -> same output, no side effects
 *
 * Extracts all wikilinks ([[link]]) from content and resolves them to node IDs
 * by matching against the provided nodes record. Links are resolved by:
 * 1. Stripping relative path prefixes (./ or ../)
 * 2. Extracting path segments from absolute or relative paths
 * 3. Matching segments against node IDs, preferring longer matches
 *
 * @param content - Markdown content with wikilinks
 * @param nodes - Record of all available nodes to resolve links against
 * @returns Array of resolved node IDs (duplicates removed, order preserved)
 *
 * @example
 * ```typescript
 * const content = "See [[node-a]] and [[node-b.md]] and [[node-a]] again"
 * const nodes = {
 *   "node-a": { relativeFilePathIsID: "node-a", ... },
 *   "node-b": { relativeFilePathIsID: "node-b", ... }
 * }
 *
 * extractLinkedNodeIds(content, nodes)
 * // => ["node-a", "node-b"]  // Note: duplicates removed, order preserved
 * ```
 *
 * @example
 * ```typescript
 * const content = "See [[/Users/user/vault/folder/file.md]]"
 * const nodes = {
 *   "file": { relativeFilePathIsID: "file", ... },
 *   "folder/file": { relativeFilePathIsID: "folder/file", ... }
 * }
 *
 * extractLinkedNodeIds(content, nodes)
 * // => ["folder/file"]  // Prefers longer match with more path context
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

      // Find best matching node, preferring longer path matches
      return findBestMatchingNode(linkText, nodes)
    })
    .filter((id): id is NodeId => id !== undefined)

  // Remove duplicates while preserving order
  return [...new Set(linkedIds)]
}

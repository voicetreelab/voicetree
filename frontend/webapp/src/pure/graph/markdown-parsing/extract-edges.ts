import type { NodeIdAndFilePath, GraphNode, Edge } from '@/pure/graph'

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
  nodes: Record<NodeIdAndFilePath, GraphNode>
): NodeIdAndFilePath | undefined {
  // Try exact match with node ID
  if (nodes[segment]) {
    return segment
  }

  // Find ALL nodes where segment matches any of their path segments
  const matches = Object.keys(nodes).filter((nodeId) => {
    const nodeSegments = extractPathSegments(nodeId)
    return nodeSegments.includes(segment)
  })

  if (matches.length === 0) {
    return undefined
  }

  // Return most specific match (longest path)
  return matches.sort((a, b) => b.length - a.length)[0]
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
  nodes: Record<NodeIdAndFilePath, GraphNode>
): NodeIdAndFilePath | undefined {
  // Extract all possible path segments from the link text
  const linkSegments = extractPathSegments(linkText)

  if (linkSegments.length === 0) return undefined

  // Try to match each segment, preferring longer matches (first in array)
  // Use reduce to find first matching segment
  return linkSegments.reduce<NodeIdAndFilePath | undefined>(
    (foundMatch, segment) => foundMatch ?? matchSegment(segment, nodes),
    undefined
  )
}

/**
 * Extracts linked node IDs with relationship labels from markdown content.
 *
 * Pure function: same input -> same output, no side effects
 *
 * Extracts all wikilinks ([[link]]) from content and resolves them to edges.
 * For each wikilink, the label is the text from the start of the line to the [[.
 *
 * @param content - Markdown content with wikilinks
 * @param nodes - Record of all available nodes to resolve links against
 * @returns Array of edges with targetId and label (duplicates removed, order preserved)
 *
 * @example
 * ```typescript
 * const content = "- references [[node-a]]\n- extends [[node-b]]"
 * const nodes = {
 *   "node-a": { relativeFilePathIsID: "node-a", ... },
 *   "node-b": { relativeFilePathIsID: "node-b", ... }
 * }
 *
 * extractLinkedNodeIds(content, nodes)
 * // => [{ targetId: "node-a", label: "references" }, { targetId: "node-b", label: "extends" }]
 * ```
 */
export function extractEdges(
  content: string,
  nodes: Record<NodeIdAndFilePath, GraphNode>
): readonly Edge[] {
  const wikilinkRegex = /\[\[([^\]]+)\]\]/g
  const matches = [...content.matchAll(wikilinkRegex)]

  const edges = matches
    .map((match) => {
      const rawLinkText = match[1].trim()
      const matchIndex = match.index!

      // Find start of line containing this wikilink
      const lineStart = content.lastIndexOf('\n', matchIndex) + 1

      // Extract text from line start to [[
      const labelText = content.substring(lineStart, matchIndex).trim()

      // Remove list markers (-, *, +) from start
      const label = labelText.replace(/^[-*+]\s+/, '')

      // Strip relative path prefixes (./ or ../) for matching
      const linkText = rawLinkText.replace(/^\.\.?\//g, '')

      // Find best matching node, preferring longer path matches
      // If no match found, use raw link text to preserve for future node creation
      const targetId = nodes ? findBestMatchingNode(linkText, nodes) ?? rawLinkText : rawLinkText

      return { targetId, label }
    })

  // Remove duplicates while preserving order (by targetId)
  const seenTargets = new Set<NodeIdAndFilePath>()
  return edges.filter(edge => {
    if (seenTargets.has(edge.targetId)) {
      return false
    }
    seenTargets.add(edge.targetId)
    return true
  })
}

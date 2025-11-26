import type { NodeIdAndFilePath, GraphNode, Edge } from '@/pure/graph'

/**
 * Extracts path segments from a path, from longest to shortest.
 * This allows preferring longer, more specific matches over shorter ones.
 *
 * @example
 * extractPathSegments("/Users/user/vault/folder/file.md")
 * => ["Users/user/vault/folder/file.md", "user/vault/folder/file.md", "vault/folder/file.md", "folder/file.md", "file.md"]
 *      // and then append without extension  => ["Users/user/vault/folder/file", "user/vault/folder/file", "vault/folder/file", "folder/file", "file"]
 */
export function extractPathSegments(path: string): readonly string[] {
  const parts: readonly string[] = path.split('/').filter(p => p.length > 0)

  if (parts.length === 0) return []

  // Build segments from longest to shortest (most specific to least specific)
  const segmentsWithExt: readonly string[] = Array.from(
    { length: parts.length },
    (_, i) => parts.slice(i).join('/')
  )

  // Remove extension from the last part to create "without extension" variants
  const removeExtension: (s: string) => string = (s: string): string => s.replace(/\.[^.]+$/, '')

  const segmentsWithoutExt: readonly string[] = segmentsWithExt
    .map(removeExtension)
    .filter(s => !segmentsWithExt.includes(s)) // Only add if different from with-ext version

  return [...segmentsWithExt, ...segmentsWithoutExt]
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
  // Find ALL nodes where segment matches any of their path segments
  // (includes exact matches where nodeId === segment)
  const matches: readonly string[] = Object.keys(nodes).filter((nodeId) => {
    const nodeSegments: readonly string[] = extractPathSegments(nodeId)
    return nodeSegments.includes(segment)
  })

  if (matches.length === 0) {
    return undefined
  }

  // Return most specific match (longest path) for better specificity
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
export function findBestMatchingNode(
  linkText: string,
  nodes: Record<NodeIdAndFilePath, GraphNode>
): NodeIdAndFilePath | undefined {
  // Extract all possible path segments from the link text
  const linkSegments: readonly string[] = extractPathSegments(linkText)

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
  const wikilinkRegex: RegExp = /\[\[([^\]]+)\]\]/g
  const matches: readonly RegExpExecArray[] = [...content.matchAll(wikilinkRegex)]

  const edges: readonly { readonly targetId: string; readonly label: string; }[] = matches
    .map((match) => {
      const rawLinkText: string = match[1].trim()
      const matchIndex: number = match.index!

      // Find start of line containing this wikilink
      const lineStart: number = content.lastIndexOf('\n', matchIndex) + 1

      // Extract text from line start to [[
      const labelText: string = content.substring(lineStart, matchIndex).trim()

      // Remove list markers (-, *, +) from start
      const label: string = labelText.replace(/^[-*+]\s+/, '')

      // Strip relative path prefixes (./ or ../) for matching TODO SUS, DONT DO THIS
      // const linkText = rawLinkText.replace(/^\.\.?\//g, '')

      // Find best matching node, preferring longer path matches
      // If no match found, use raw link text to preserve for future node creation
      const targetId: string = nodes ? findBestMatchingNode(rawLinkText, nodes) ?? rawLinkText : rawLinkText

      return { targetId, label }
    })

  // Remove duplicates while preserving order (by targetId)
  const seenTargets: ReadonlySet<string> = new Set<NodeIdAndFilePath>()
  return edges.filter(edge => {
    if (seenTargets.has(edge.targetId)) {
      return false
    }
    seenTargets.add(edge.targetId)
    return true
  })
}

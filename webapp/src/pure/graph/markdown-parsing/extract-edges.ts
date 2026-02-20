import type { NodeIdAndFilePath, GraphNode, Edge } from '@/pure/graph'
import { getBaseName } from '@/pure/graph/graph-operations/linkResolutionIndexes'
import type { NodeByBaseNameIndex } from '@/pure/graph/graph-operations/linkResolutionIndexes'

/**
 * Extracts path components, normalizing for comparison.
 * - Filters out empty strings, '.', and '..' (relative path markers)
 * - Strips .md extension from final component (baseName)
 *
 * LIMITATION: Only strips .md extension. This means:
 * - "foo.md" matches "foo" ✓
 * - "foo" matches "foo.md" ✓
 * - "foo.txt" does NOT match "foo.md" ✓ (correct - different extensions)
 * - "foo" does NOT match "foo.txt" (may be unexpected if we add other file types)
 *
 * If we add non-.md file types, we should update this to:
 * - If link has an extension: require exact extension match
 * - If link has no extension: match any extension (strip from both)
 *
 * @example
 * getPathComponents("ctx-nodes/VT/foo.md")  => ["ctx-nodes", "VT", "foo"]
 * getPathComponents("./foo.md")             => ["foo"]
 * getPathComponents("../bar/foo.md")        => ["bar", "foo"]
 * getPathComponents("foo")                  => ["foo"]
 */
export function getPathComponents(path: string): readonly string[] {
  const components: readonly string[] = path
    .split(/[/\\]/)
    .filter(p => p !== '' && p !== '.' && p !== '..')

  if (components.length === 0) return []

  // Strip .md extension from last component only (immutably)
  const lastIdx: number = components.length - 1
  return [
    ...components.slice(0, lastIdx),
    components[lastIdx].replace(/\.md$/, '')
  ]
}

/**
 * Scores how well a link text matches a node ID.
 *
 * Compares path components from the end (suffix matching).
 * Higher score = more path components match = tighter/better match.
 *
 * - 0 = no match (baseNames differ)
 * - 1 = baseName matches only
 * - 2+ = baseName + parent directories match
 *
 * @example
 * linkMatchScore("./foo.md", "a/b/foo.md")       // => 1 (baseName only)
 * linkMatchScore("b/foo.md", "a/b/foo.md")       // => 2 (b/foo matches)
 * linkMatchScore("a/b/foo.md", "a/b/foo.md")     // => 3 (full match)
 * linkMatchScore("./bar.md", "a/b/foo.md")       // => 0 (no match)
 * linkMatchScore("foo", "a/b/foo.md")            // => 1 (no extension still matches)
 */
export function linkMatchScore(linkText: string, nodeId: string): number {
  const linkComponents: readonly string[] = getPathComponents(linkText)
  const nodeComponents: readonly string[] = getPathComponents(nodeId)

  if (linkComponents.length === 0 || nodeComponents.length === 0) return 0

  // Count matching components from the end (suffix matching)
  // Use reduceRight-style logic: compare from end, stop at first mismatch
  const minLen: number = Math.min(linkComponents.length, nodeComponents.length)
  const indices: readonly number[] = Array.from({ length: minLen }, (_, i: number) => i)

  // Find first mismatch index, then count is that index (or minLen if all match)
  const firstMismatchIdx: number = indices.findIndex((i: number) => {
    const linkComp: string = linkComponents[linkComponents.length - 1 - i].toLowerCase()
    const nodeComp: string = nodeComponents[nodeComponents.length - 1 - i].toLowerCase()
    return linkComp !== nodeComp
  })

  return firstMismatchIdx === -1 ? minLen : firstMismatchIdx
}

/**
 * Finds the best matching node ID for a given link text.
 * Uses linkMatchScore to find the node with the highest match score.
 * When scores are equal, prefers shorter node paths (more specific match).
 *
 * @param linkText - The link text to match (can be absolute path, relative path, or filename)
 * @param nodes - All available nodes
 * @param nodeByBaseName - Optional index for O(1) candidate lookup. When provided, only scores
 *                         candidates from the index instead of all nodes. O(1) vs O(N).
 * @returns The best matching node ID, or undefined if no match
 */
export function findBestMatchingNode(
  linkText: string,
  nodes: Record<NodeIdAndFilePath, GraphNode>,
  nodeByBaseName?: NodeByBaseNameIndex
): NodeIdAndFilePath | undefined {
  const linkComponents: readonly string[] = getPathComponents(linkText)
  if (linkComponents.length === 0) return undefined

  // Get candidate node IDs to check
  // With index: O(1) lookup of nodes with matching basename
  // Without index: O(N) check all nodes
  const basename: string = getBaseName(linkText)
  const candidateNodeIds: readonly string[] = nodeByBaseName
    ? (nodeByBaseName.get(basename) ?? [])
    : Object.keys(nodes)

  type BestMatch = { readonly nodeId: NodeIdAndFilePath | undefined; readonly score: number }

  const result: BestMatch = candidateNodeIds.reduce<BestMatch>(
    (best: BestMatch, nodeId: string) => {
      const score: number = linkMatchScore(linkText, nodeId)
      // Higher score wins; on tie, prefer shorter path (more specific)
      const isBetter: boolean = score > best.score ||
        (score === best.score && score > 0 && best.nodeId !== undefined && nodeId.length < best.nodeId.length)
      return isBetter ? { nodeId, score } : best
    },
    { nodeId: undefined, score: 0 }
  )

  // Require ALL of the shorter path's components to match.
  // This allows absolute paths (longer than node IDs) to match via suffix,
  // while still preventing [a/b/foo.md] from matching [x/foo.md].
  //
  // Examples:
  // - [/Users/user/vault/folder/file.md] (5 components) matching [folder/file.md] (2):
  //   score=2, minRequired=min(5,2)=2 → 2 >= 2 ✓ accepted
  // - [a/b/foo.md] (3 components) vs [x/foo.md] (2):
  //   score=1 (only 'foo'), minRequired=min(3,2)=2 → 1 < 2 ✗ rejected
  if (result.nodeId === undefined) {
    return undefined
  }
  const bestNodeComponents: readonly string[] = getPathComponents(result.nodeId)
  const minRequiredScore: number = Math.min(linkComponents.length, bestNodeComponents.length)
  if (result.score < minRequiredScore) {
    // Fallback: stale absolute paths from moved mount points (AppImage, symlinks).
    // Accept best basename-matching candidate when the link is an absolute path
    // not found in the graph. Best-score still prefers highest suffix overlap.
    const isStaleAbsolutePath: boolean = linkText.startsWith('/') && nodes[linkText] === undefined
    if (isStaleAbsolutePath && result.score >= 1) {
      return result.nodeId
    }
    return undefined
  }

  return result.nodeId
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
 * @param nodeByBaseName - Optional index for O(1) link resolution. When provided,
 *                         uses O(1) candidate lookup instead of O(N) scan.
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
  nodes: Record<NodeIdAndFilePath, GraphNode>,
  nodeByBaseName?: NodeByBaseNameIndex
): readonly Edge[] {
  const wikilinkRegex: RegExp = /\[\[([^\]\n\r]+)\]\]/g
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


      // Find best matching node, preferring longer path matches
      // If no match found, use raw link text to preserve for future node creation
      const targetId: string = nodes ? findBestMatchingNode(rawLinkText, nodes, nodeByBaseName) ?? rawLinkText : rawLinkText

      return { targetId, label }
    })
    // Filter out invalid edges from empty/malformed wikilinks like [[]], [.], [ ]
    .filter(edge => edge.targetId.trim() !== '' && edge.targetId !== '.')

  // Remove duplicates while preserving order (by targetId)
  type Accumulator = { readonly seen: ReadonlySet<string>; readonly result: readonly Edge[] }
  const deduplicated: Accumulator = edges.reduce<Accumulator>(
    (acc: Accumulator, edge: { readonly targetId: string; readonly label: string }) => {
      if (acc.seen.has(edge.targetId)) {
        return acc
      }
      return {
        seen: new Set([...acc.seen, edge.targetId]),
        result: [...acc.result, edge]
      }
    },
    { seen: new Set<string>(), result: [] }
  )
  return deduplicated.result
}

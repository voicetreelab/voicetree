import * as O from 'fp-ts/lib/Option.js'
import type { GraphNode } from '@/functional_graph/pure/types'
import { extractFrontmatter } from '@/functional_graph/pure/markdown-parsing/extract-frontmatter'
import { filenameToNodeId } from '@/functional_graph/pure/markdown-parsing/filename-utils'

/**
 * Parses markdown content into a GraphNode.
 *
 * Pure function: same input -> same output, no side effects
 *
 * @param content - Full markdown content including frontmatter
 * @param filename - Filename of the markdown file (used as fallback for node_id)
 * @returns GraphNode with all fields populated
 *
 * Field resolution priority:
 * - relativeFilePathIsID: frontmatter.node_id > filenameToNodeId(filename)
 * - title: frontmatter.title > extractTitle(content) > 'Untitled'
 * - content: full markdown content
 * - summary: frontmatter.summary > ''
 * - color: Option.some(frontmatter.color) | Option.none
 * - position: Option.some(frontmatter.position) | Option.none
 *
 * @example
 * ```typescript
 * const content = `---
 * node_id: "123"
 * title: "My GraphNode"
 * summary: "A test node"
 * color: "#FF0000"
 * position:
 *   x: 100
 *   y: 200
 * ---
 * # Content here`
 *
 * const node = parseMarkdownToGraphNode(content, "test.md")
 * // node = {
 * //   relativeFilePathIsID: "123",
 * //   title: "My GraphNode",
 * //   content: content,
 * //   summary: "A test node",
 * //   color: O.some("#FF0000"),
 * //   position: O.some({ x: 100, y: 200 })
 * // }
 * ```
 */
export function parseMarkdownToGraphNode(content: string, filename: string): GraphNode {
  const frontmatter = extractFrontmatter(content)

  return {
    relativeFilePathIsID: filenameToNodeId(filename),
    outgoingEdges: [],
    content,
    nodeUIMetadata: {
      color: frontmatter.color ? O.some(frontmatter.color) : O.none,
      position: frontmatter.position ? O.some(frontmatter.position) : O.none
    }
  }
}

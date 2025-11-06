import * as O from 'fp-ts/lib/Option.js'
import type { Node } from '@/functional_graph/pure/types'
import { extractFrontmatter } from '@/functional_graph/pure/markdown_parsing/extract-frontmatter'
import { filenameToNodeId } from '@/functional_graph/pure/markdown_parsing/filename-utils'

/**
 * Parses markdown content into a Node.
 *
 * Pure function: same input -> same output, no side effects
 *
 * @param content - Full markdown content including frontmatter
 * @param filename - Filename of the markdown file (used as fallback for node_id)
 * @returns Node with all fields populated
 *
 * Field resolution priority:
 * - relativeFilePathIsID: frontmatter.node_id > filenameToNodeId(filename)
 * - title: frontmatter.title > extractTitle(content) > 'Untitled'
 * - content: full markdown content
 * - summary: frontmatter.summary > ''
 * - color: Option.some(frontmatter.color) | Option.none
 *
 * @example
 * ```typescript
 * const content = `---
 * node_id: "123"
 * title: "My Node"
 * summary: "A test node"
 * color: "#FF0000"
 * ---
 * # Content here`
 *
 * const node = parseMarkdownToGraphNode(content, "test.md")
 * // node = {
 * //   relativeFilePathIsID: "123",
 * //   title: "My Node",
 * //   content: content,
 * //   summary: "A test node",
 * //   color: O.some("#FF0000")
 * // }
 * ```
 */
export function parseMarkdownToGraphNode(content: string, filename: string): Node {
  const frontmatter = extractFrontmatter(content)

  return {
    relativeFilePathIsID: filenameToNodeId(filename),
    outgoingEdges: [],
    content,
    nodeUIMetadata: {
      color: frontmatter.color ? O.some(frontmatter.color) : O.none,
      position: { x: 0, y: 0 }
    }
  }
}

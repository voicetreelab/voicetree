import * as O from 'fp-ts/Option'
import type { GraphNode } from '@/functional_graph/pure/types.ts'
import { extractFrontmatter } from '@/functional_graph/pure/markdown_parsing/extract-frontmatter.ts'
import { extractTitle } from '@/functional_graph/pure/markdown_parsing/extract-title.ts'
import { filenameToNodeId } from '@/functional_graph/pure/markdown_parsing/filename-utils.ts'

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
 * - id: frontmatter.node_id > filenameToNodeId(filename)
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
 * //   id: "123",
 * //   title: "My Node",
 * //   content: content,
 * //   summary: "A test node",
 * //   color: O.some("#FF0000")
 * // }
 * ```
 */
export function parseMarkdownToGraphNode(content: string, filename: string): GraphNode {
  const frontmatter = extractFrontmatter(content)

  return {
    id: frontmatter.node_id ?? filenameToNodeId(filename),
    title: frontmatter.title ?? extractTitle(content) ?? 'Untitled',
    content,
    summary: frontmatter.summary ?? '',
    color: frontmatter.color ? O.some(frontmatter.color) : O.none
  }
}

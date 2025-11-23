import * as O from 'fp-ts/lib/Option.js'
import * as E from 'fp-ts/lib/Either.js'
import matter from 'gray-matter'
import type {GraphNode} from '@/pure/graph'
import {extractFrontmatter, type Frontmatter} from '@/pure/graph/markdown-parsing/extract-frontmatter.ts'
import {filenameToNodeId} from '@/pure/graph/markdown-parsing/filename-utils.ts'
import {markdownToTitle} from '@/pure/graph/markdown-parsing/markdown-to-title.ts'
import {extractEdges} from "@/pure/graph/markdown-parsing/extract-edges.ts";

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
/**
 * Safely extract frontmatter, returning empty object on error
 */
function safeFrontmatterExtraction(content: string, filename: string): Frontmatter {
    const frontmatterEither = E.tryCatch(
        () => extractFrontmatter(content),
        (error) => {
            console.warn(`[parseMarkdownToGraphNode] Invalid YAML frontmatter in ${filename}, using fallback:`, error)
            return error
        }
    )

    return E.getOrElse(() => ({} as Frontmatter))(frontmatterEither)
}

export function parseMarkdownToGraphNode(content: string, filename: string): GraphNode {
    // Try to extract frontmatter, but don't let invalid YAML break the entire app
    const frontmatter = safeFrontmatterExtraction(content, filename)

    // Strip YAML frontmatter from content
    const parsed = matter(content)
    const contentWithoutFrontmatter = parsed.content

    // Extract edges from original content (before stripping wikilinks)
    const edges = extractEdges(content, {})

    // Replace [[link]] with [link]* (strip wikilink syntax)
    const contentWithoutYamlOrLinks = contentWithoutFrontmatter.replace(/\[\[([^\]]+)\]\]/g, '[$1]*')

    // Compute title using markdownToTitle
    const title = markdownToTitle(frontmatter, content, filename)

    // Return node with computed title
    return {
        relativeFilePathIsID: filenameToNodeId(filename),
        outgoingEdges: edges,
        contentWithoutYamlOrLinks,
        nodeUIMetadata: {
            title,
            color: frontmatter.color ? O.some(frontmatter.color) : O.none,
            position: frontmatter.position ? O.some(frontmatter.position) : O.none
        }
    }
}

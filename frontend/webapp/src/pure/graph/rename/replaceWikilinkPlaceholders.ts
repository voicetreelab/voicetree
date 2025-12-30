import type { NodeIdAndFilePath } from '@/pure/graph'
import { linkMatchScore } from '@/pure/graph/markdown-parsing/extract-edges'

/**
 * Extracts the basename (filename without extension) from a node ID path.
 *
 * @example
 * getBasename("folder/my_node.md") => "my_node"
 * getBasename("deep/path/file.md") => "file"
 */
function getBasename(nodeId: NodeIdAndFilePath): string {
    const lastSlashIdx: number = nodeId.lastIndexOf('/')
    const filename: string = lastSlashIdx === -1 ? nodeId : nodeId.slice(lastSlashIdx + 1)
    return filename.replace(/\.md$/, '')
}

/**
 * Replaces wikilink placeholders in content that match the old node ID with the new node's basename.
 *
 * Content stores wikilinks as `[link_text]*` placeholders. The link_text may be:
 * - Just basename: "my_node"
 * - Relative path: "folder/my_node"
 * - Full path with extension: "folder/my_node.md"
 *
 * Uses linkMatchScore to determine if a placeholder resolves to the old node ID.
 * If score > 0, replaces with the new node's basename.
 *
 * @param content - Content with [link]* placeholders
 * @param oldNodeId - The node ID being renamed (e.g., "folder/my_node.md")
 * @param newNodeId - The new node ID (e.g., "folder/new_title.md")
 * @returns Content with matching placeholders updated to use new basename
 *
 * @example
 * replaceWikilinkPlaceholders(
 *   "See [my_node]* for details",
 *   "folder/my_node.md",
 *   "folder/new_title.md"
 * )
 * // => "See [new_title]* for details"
 */
export function replaceWikilinkPlaceholders(
    content: string,
    oldNodeId: NodeIdAndFilePath,
    newNodeId: NodeIdAndFilePath
): string {
    if (content.length === 0) {
        return content
    }

    const newBasename: string = getBasename(newNodeId)

    // Match [link_text]* placeholders
    const placeholderRegex: RegExp = /\[([^\]]+)\]\*/g

    return content.replace(placeholderRegex, (match: string, linkText: string): string => {
        const score: number = linkMatchScore(linkText, oldNodeId)
        if (score > 0) {
            return `[${newBasename}]*`
        }
        return match
    })
}

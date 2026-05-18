/**
 * Image file extensions supported by Voicetree
 * Used to identify image nodes in the graph
 */
export const IMAGE_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']

/**
 * Checks if a node ID represents an image file based on its extension.
 *
 * Pure function: same input -> same output, no side effects
 *
 * @param nodeId - The node ID (file path)
 * @returns true if the node is an image file, false otherwise
 *
 * @example
 * ```typescript
 * isImageNode('/path/to/image.png')
 * // => true
 *
 * isImageNode('/path/to/note.md')
 * // => false
 *
 * isImageNode('/path/to/photo.PNG')  // Case-insensitive
 * // => true
 * ```
 */
export function isImageNode(nodeId: string): boolean {
    if (!nodeId) return false
    const lowerCaseId: string = nodeId.toLowerCase()
    return IMAGE_EXTENSIONS.some(ext => lowerCaseId.endsWith(ext))
}

/**
 * Video file extensions supported by Voicetree
 * Used to identify video nodes in the graph and detect video wikilinks in the editor
 */
export const VIDEO_EXTENSIONS: readonly string[] = ['.mp4', '.webm', '.mov', '.ogg', '.mkv']

/**
 * Checks if a node ID represents a video file based on its extension.
 *
 * Pure function: same input -> same output, no side effects
 *
 * @param nodeId - The node ID (file path)
 * @returns true if the node is a video file, false otherwise
 *
 * @example
 * ```typescript
 * isVideoNode('/path/to/video.mp4')
 * // => true
 *
 * isVideoNode('/path/to/note.md')
 * // => false
 *
 * isVideoNode('/path/to/clip.MP4')  // Case-insensitive
 * // => true
 * ```
 */
export function isVideoNode(nodeId: string): boolean {
    if (!nodeId) return false
    const lowerCaseId: string = nodeId.toLowerCase()
    return VIDEO_EXTENSIONS.some(ext => lowerCaseId.endsWith(ext))
}

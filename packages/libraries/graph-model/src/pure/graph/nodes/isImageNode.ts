/**
 * Image file extensions supported by Voicetree
 * Used to identify image nodes in the graph
 */
export const IMAGE_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']

/** Returns a predicate that checks if a node ID ends with one of the given extensions (case-insensitive). */
export function makeNodeExtensionChecker(extensions: readonly string[]): (nodeId: string) => boolean {
    return (nodeId) => {
        if (!nodeId) return false
        const lower = nodeId.toLowerCase()
        return extensions.some(ext => lower.endsWith(ext))
    }
}

export const isImageNode = makeNodeExtensionChecker(IMAGE_EXTENSIONS)

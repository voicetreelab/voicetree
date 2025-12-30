import type { NodeIdAndFilePath } from '@/pure/graph'

/**
 * Extracts the folder prefix from a node ID (everything before the last slash).
 * Returns empty string if no folder prefix exists.
 */
function getFolderPrefix(nodeId: NodeIdAndFilePath): string {
    const lastSlashIndex: number = nodeId.lastIndexOf('/')
    if (lastSlashIndex === -1) {
        return ''
    }
    return nodeId.slice(0, lastSlashIndex + 1)
}

/**
 * Converts a title to snake_case format suitable for a filename.
 * - Converts to lowercase
 * - Replaces spaces and special characters with underscores
 * - Collapses multiple consecutive underscores
 * - Trims leading/trailing underscores
 */
function titleToSnakeCase(title: string): string {
    const snakeCase: string = title
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')  // Replace non-alphanumeric (except underscore) with underscore
        .replace(/_+/g, '_')           // Collapse multiple underscores
        .replace(/^_|_$/g, '')         // Trim leading/trailing underscores

    return snakeCase
}

/**
 * Finds the first available suffix for a node ID that doesn't conflict with existing IDs.
 * Uses recursion to find _2, _3, etc.
 */
function findAvailableSuffix(
    folderPrefix: string,
    baseName: string,
    existingIds: ReadonlySet<string>,
    suffix: number
): NodeIdAndFilePath {
    const candidateId: NodeIdAndFilePath = `${folderPrefix}${baseName}_${suffix}.md`
    if (!existingIds.has(candidateId)) {
        return candidateId
    }
    return findAvailableSuffix(folderPrefix, baseName, existingIds, suffix + 1)
}

/**
 * Converts a title to a new node ID in snake_case format.
 *
 * - Converts to lowercase
 * - Replaces spaces with underscores
 * - Strips special characters
 * - Preserves folder prefix from currentNodeId
 * - Appends _2, _3, etc. if ID already exists
 * - Returns "untitled.md" for empty titles
 */
export function computeNewNodeIdFromTitle(
    title: string,
    currentNodeId: NodeIdAndFilePath,
    existingIds: ReadonlySet<string>
): NodeIdAndFilePath {
    const folderPrefix: string = getFolderPrefix(currentNodeId)

    // Convert title to snake_case, fallback to 'untitled' if empty
    const snakeCaseTitle: string = titleToSnakeCase(title)
    const baseName: string = snakeCaseTitle === '' ? 'untitled' : snakeCaseTitle

    // Build the base ID (without conflict suffix)
    const baseId: NodeIdAndFilePath = `${folderPrefix}${baseName}.md`

    // If no conflict, return base ID
    if (!existingIds.has(baseId)) {
        return baseId
    }

    // Find first available suffix (_2, _3, etc.) using recursion
    return findAvailableSuffix(folderPrefix, baseName, existingIds, 2)
}

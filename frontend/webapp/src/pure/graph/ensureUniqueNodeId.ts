import type { NodeIdAndFilePath } from '@/pure/graph'

/**
 * Finds the first available suffix for a node ID that doesn't conflict with existing IDs.
 * Uses recursion to find _2, _3, etc.
 */
function findAvailableSuffix(
    baseNameWithoutExt: string,
    existingIds: ReadonlySet<string>,
    suffix: number
): NodeIdAndFilePath {
    const candidateId: NodeIdAndFilePath = `${baseNameWithoutExt}_${suffix}.md`
    if (!existingIds.has(candidateId)) {
        return candidateId
    }
    return findAvailableSuffix(baseNameWithoutExt, existingIds, suffix + 1)
}

/**
 * Ensures a candidate node ID is unique by appending _2, _3, etc. if collision exists.
 *
 * @param candidateId - The proposed node ID (must end in .md)
 * @param existingIds - Set of all existing node IDs in the graph
 * @returns The candidateId if unique, otherwise candidateId with _2, _3, etc. suffix
 *
 * @example
 * ensureUniqueNodeId('foo.md', new Set(['foo.md'])) // => 'foo_2.md'
 * ensureUniqueNodeId('foo.md', new Set(['foo.md', 'foo_2.md'])) // => 'foo_3.md'
 * ensureUniqueNodeId('bar/baz.md', new Set(['bar/baz.md'])) // => 'bar/baz_2.md'
 */
export function ensureUniqueNodeId(
    candidateId: NodeIdAndFilePath,
    existingIds: ReadonlySet<string>
): NodeIdAndFilePath {
    if (!existingIds.has(candidateId)) {
        return candidateId
    }

    // Strip .md extension to get base name (preserves folder prefix)
    const baseNameWithoutExt: string = candidateId.replace(/\.md$/, '')

    return findAvailableSuffix(baseNameWithoutExt, existingIds, 2)
}

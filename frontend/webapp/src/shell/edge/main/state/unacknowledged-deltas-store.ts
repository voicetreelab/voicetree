import type { GraphDelta } from '@/pure/graph'

/**
 * Tracks deltas that were applied by the write path but not yet
 * acknowledged by the read path (FS event handler).
 *
 * When the write path writes to disk, it adds the delta here (keyed by hash).
 * When the read path receives an FS event, it checks if the resulting
 * delta hash is here - if so, it acknowledges (removes) and skips processing.
 *
 * Stores the full delta (not just hash) to enable debugging comparison
 * when acknowledgement fails.
 */

let unacknowledgedDeltas: Map<string, GraphDelta> = new Map()

export const addUnacknowledgedDelta = (hash: string, delta: GraphDelta): void => {
    unacknowledgedDeltas.set(hash, delta)
}

/**
 * Check if a delta hash is unacknowledged, and if so, acknowledge it by removing.
 * Returns true if the hash was present (and has been removed).
 */
export const acknowledgeIfPresent = (hash: string): boolean => {
    if (unacknowledgedDeltas.has(hash)) {
        unacknowledgedDeltas.delete(hash)
        return true
    }
    return false
}

/**
 * Get all unacknowledged deltas for debugging comparison.
 * Returns array of [hash, delta] pairs.
 */
export const getUnacknowledgedDeltas = (): ReadonlyArray<readonly [string, GraphDelta]> => {
    return Array.from(unacknowledgedDeltas.entries())
}

export const clearUnacknowledgedDeltas = (): void => {
    unacknowledgedDeltas = new Map()
}

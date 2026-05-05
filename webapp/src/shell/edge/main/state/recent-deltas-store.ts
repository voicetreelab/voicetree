// Re-export shim — actual implementation in @vt/graph-db-server
export {
    markRecentDelta,
    isOurRecentDelta,
    clearRecentDeltas,
    getRecentDeltasCount,
    getRecentDeltasForNodeId,
} from '@vt/graph-db-server/state/recent-deltas-store'

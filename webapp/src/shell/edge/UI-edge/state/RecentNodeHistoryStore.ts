/**
 * RecentNodeHistoryStore - Edge state for recent node history
 * Follows the same pattern as EditorStore.ts
 */
import {
    createEmptyHistory,
    updateHistoryFromDelta,
    type RecentNodeHistory
} from '@/pure/graph/recentNodeHistoryV2';
import type {GraphDelta} from '@/pure/graph';

let recentNodeHistory: RecentNodeHistory = createEmptyHistory();

export function getRecentNodeHistory(): RecentNodeHistory {
    return recentNodeHistory;
}

export function setRecentNodeHistory(history: RecentNodeHistory): void {
    recentNodeHistory = history;
}

export function updateRecentNodeHistoryFromDelta(delta: GraphDelta): RecentNodeHistory {
    recentNodeHistory = updateHistoryFromDelta(recentNodeHistory, delta);
    return recentNodeHistory;
}

export function clearRecentNodeHistory(): RecentNodeHistory {
    recentNodeHistory = createEmptyHistory();
    return recentNodeHistory;
}

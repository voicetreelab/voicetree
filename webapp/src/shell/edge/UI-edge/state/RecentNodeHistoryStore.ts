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

// Subscription callbacks for recent node history changes
type RecentNodeHistoryCallback = (history: RecentNodeHistory) => void;
const subscribers: Set<RecentNodeHistoryCallback> = new Set();

function notifySubscribers(): void {
    for (const callback of subscribers) {
        callback(recentNodeHistory);
    }
}

/**
 * Subscribe to recent node history changes.
 * @returns unsubscribe function
 */
export function subscribeToRecentNodeHistoryChange(callback: (history: RecentNodeHistory) => void): () => void {
    subscribers.add(callback);
    return () => {
        subscribers.delete(callback);
    };
}

export function getRecentNodeHistory(): RecentNodeHistory {
    return recentNodeHistory;
}

export function setRecentNodeHistory(history: RecentNodeHistory): void {
    recentNodeHistory = history;
}

export function updateRecentNodeHistoryFromDelta(delta: GraphDelta): RecentNodeHistory {
    recentNodeHistory = updateHistoryFromDelta(recentNodeHistory, delta);
    notifySubscribers();
    return recentNodeHistory;
}

export function clearRecentNodeHistory(): RecentNodeHistory {
    recentNodeHistory = createEmptyHistory();
    notifySubscribers();
    return recentNodeHistory;
}

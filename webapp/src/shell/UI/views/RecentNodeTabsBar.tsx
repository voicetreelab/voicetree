/* eslint-disable react-refresh/only-export-components */
/**
 * RecentNodeTabsBar (React) - Renders up to 5 recently added/modified nodes as clickable tabs
 *
 * Self-contained: subscribes to RecentNodeHistoryStore and EditorStore internally.
 * Mounted/unmounted via createRecentNodeTabsBar / disposeRecentNodeTabsBar.
 *
 * Features:
 * - Fixed width tabs with horizontally scrollable text
 * - Positioned in macOS title bar area (left: 80px for window controls)
 * - Clicking a tab navigates to that node
 * - TWO sections: pinned editors (left) and recent nodes (right)
 */

import { createElement, useEffect, useState, useCallback, useMemo } from 'react';
import type { JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { RecentNodeHistory } from '@/pure/graph/recentNodeHistoryV2';
import type { UpsertNodeDelta } from '@/pure/graph';
import { getNodeTitle } from '@/pure/graph/markdown-parsing';
import {
    subscribeToRecentNodeHistoryChange,
    getRecentNodeHistory,
} from '@/shell/edge/UI-edge/state/RecentNodeHistoryStore';
import {
    subscribeToPinnedEditorsChange,
    getPinnedEditors,
} from '@/shell/edge/UI-edge/state/EditorStore';
import { Pin } from 'lucide-react';

const TAB_WIDTH: number = 90;

// =============================================================================
// Store Hooks
// =============================================================================

function useRecentNodeHistory(): RecentNodeHistory {
    const [history, setHistory] = useState<RecentNodeHistory>(getRecentNodeHistory);

    useEffect(() => {
        return subscribeToRecentNodeHistoryChange(setHistory);
    }, []);

    return history;
}

function usePinnedEditors(): Set<string> {
    const [pinned, setPinned] = useState<Set<string>>(() => new Set(getPinnedEditors()));

    useEffect(() => {
        return subscribeToPinnedEditorsChange((editors: Set<string>) => {
            setPinned(new Set(editors));
        });
    }, []);

    return pinned;
}

// =============================================================================
// Tab Components
// =============================================================================

interface RecentTabProps {
    readonly entry: UpsertNodeDelta;
    readonly index: number;
    readonly onNavigate: (nodeId: string) => void;
}

function RecentTab({ entry, index, onNavigate }: RecentTabProps): JSX.Element {
    const nodeId: string = entry.nodeToUpsert.absoluteFilePathIsID;
    const label: string = getNodeTitle(entry.nodeToUpsert);
    const shortcutNumber: number = index + 1;

    const handleClick: () => void = useCallback((): void => {
        onNavigate(nodeId);
    }, [onNavigate, nodeId]);

    return (
        <div className="recent-tab-wrapper">
            <button
                className="recent-tab"
                data-node-id={nodeId}
                title={label}
                style={{ width: `${TAB_WIDTH}px` }}
                onClick={handleClick}
            >
                <span className="recent-tab-text">{label}</span>
            </button>
            <span className="recent-tab-shortcut-hint">{`\u2318${shortcutNumber}`}</span>
        </div>
    );
}

interface PinnedTabProps {
    readonly nodeId: string;
    readonly label: string;
    readonly onNavigate: (nodeId: string) => void;
}

function PinnedTab({ nodeId, label, onNavigate }: PinnedTabProps): JSX.Element {
    const handleClick: () => void = useCallback((): void => {
        onNavigate(nodeId);
    }, [onNavigate, nodeId]);

    return (
        <div className="recent-tab-wrapper">
            <button
                className="recent-tab"
                data-node-id={nodeId}
                data-pinned="true"
                title={label}
                style={{ width: `${TAB_WIDTH}px` }}
                onClick={handleClick}
            >
                <Pin className="pinned-tab-icon" size={12} />
                <span className="recent-tab-text">{label}</span>
            </button>
            <span className="recent-tab-shortcut-hint">pinned</span>
        </div>
    );
}

// =============================================================================
// Main Component
// =============================================================================

interface RecentNodeTabsBarInternalProps {
    readonly onNavigate: (nodeId: string) => void;
    readonly getNodeLabel?: (nodeId: string) => string | undefined;
}

function RecentNodeTabsBarInternal({ onNavigate, getNodeLabel }: RecentNodeTabsBarInternalProps): JSX.Element | null {
    const history: RecentNodeHistory = useRecentNodeHistory();
    const pinnedEditors: Set<string> = usePinnedEditors();

    const hasContent: boolean = pinnedEditors.size > 0 || history.length > 0;

    const pinnedEntries: readonly { nodeId: string; label: string }[] = useMemo(() => {
        const entries: { nodeId: string; label: string }[] = [];
        for (const nodeId of pinnedEditors) {
            const label: string = getNodeLabel?.(nodeId) ?? nodeId.split('/').pop() ?? nodeId;
            entries.push({ nodeId, label });
        }
        return entries;
    }, [pinnedEditors, getNodeLabel]);

    if (!hasContent) return null;

    return (
        <div className="recent-tabs-bar" data-testid="recent-tabs-bar-v2" style={{ display: 'flex' }}>
            <div className="recent-tabs-pinned-section" data-testid="pinned-tabs-section">
                {pinnedEntries.map(({ nodeId, label }) => (
                    <PinnedTab key={nodeId} nodeId={nodeId} label={label} onNavigate={onNavigate} />
                ))}
            </div>
            <div className="recent-tabs-scroll">
                {history.map((entry: UpsertNodeDelta, index: number) => (
                    <RecentTab
                        key={entry.nodeToUpsert.absoluteFilePathIsID}
                        entry={entry}
                        index={index}
                        onNavigate={onNavigate}
                    />
                ))}
            </div>
        </div>
    );
}

// =============================================================================
// Mount / Unmount (public API)
// =============================================================================

let reactRoot: Root | null = null;

/**
 * Create and mount the recent node tabs bar into a parent container.
 * @param container - DOM element to mount into
 * @param onNavigate - Callback when user clicks a tab
 * @param getNodeLabel - Optional callback to get node label by nodeId (for pinned editors)
 * @returns cleanup function
 */
export function createRecentNodeTabsBar(
    container: HTMLElement,
    onNavigate: (nodeId: string) => void,
    getNodeLabel?: (nodeId: string) => string | undefined,
): () => void {
    disposeRecentNodeTabsBar();

    const mountPoint: HTMLDivElement = document.createElement('div');
    mountPoint.setAttribute('data-testid', 'recent-tabs-bar-mount');
    container.appendChild(mountPoint);

    reactRoot = createRoot(mountPoint);
    reactRoot.render(createElement(RecentNodeTabsBarInternal, { onNavigate, getNodeLabel }));

    return disposeRecentNodeTabsBar;
}

/**
 * Dispose the recent node tabs bar and clean up resources.
 */
export function disposeRecentNodeTabsBar(): void {
    if (reactRoot) {
        reactRoot.unmount();
        reactRoot = null;
    }
}

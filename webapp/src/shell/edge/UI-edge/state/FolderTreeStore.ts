/**
 * Push-based folder tree state store.
 * Main process pushes tree updates via syncFolderTreeFromMain().
 * Renderer subscribes via useSyncExternalStore.
 *
 * Follows the same pattern as VaultPathStore.ts.
 */

import type { FolderTreeNode } from '@/pure/folders/types';

export interface FolderTreeState {
    readonly tree: FolderTreeNode | null;
    readonly expandedPaths: ReadonlySet<string>;
    readonly searchQuery: string;
    readonly isOpen: boolean;
    readonly sidebarWidth: number;
}

const STORAGE_KEY_OPEN: string = 'folderTree.isOpen';
const STORAGE_KEY_WIDTH: string = 'folderTree.sidebarWidth';
const DEFAULT_WIDTH: number = 220;

function loadPersistedState(): { isOpen: boolean; sidebarWidth: number } {
    try {
        const isOpen: string | null = localStorage.getItem(STORAGE_KEY_OPEN);
        const width: string | null = localStorage.getItem(STORAGE_KEY_WIDTH);
        return {
            isOpen: isOpen === 'true',
            sidebarWidth: width ? Number(width) : DEFAULT_WIDTH,
        };
    } catch {
        return { isOpen: false, sidebarWidth: DEFAULT_WIDTH };
    }
}

function persistState(isOpen: boolean, sidebarWidth: number): void {
    try {
        localStorage.setItem(STORAGE_KEY_OPEN, String(isOpen));
        localStorage.setItem(STORAGE_KEY_WIDTH, String(sidebarWidth));
    } catch {
        // localStorage unavailable
    }
}

const persisted: { isOpen: boolean; sidebarWidth: number } = loadPersistedState();

const INITIAL_STATE: FolderTreeState = {
    tree: null,
    expandedPaths: new Set(),
    searchQuery: '',
    isOpen: persisted.isOpen,
    sidebarWidth: persisted.sidebarWidth,
};

let currentState: FolderTreeState = INITIAL_STATE;

type FolderTreeCallback = (state: FolderTreeState) => void;
const subscribers: Set<FolderTreeCallback> = new Set();

function notifySubscribers(): void {
    for (const callback of subscribers) {
        callback(currentState);
    }
}

/**
 * Subscribe to folder tree state changes.
 * @returns unsubscribe function
 */
export function subscribeFolderTree(callback: FolderTreeCallback): () => void {
    subscribers.add(callback);
    return () => {
        subscribers.delete(callback);
    };
}

/**
 * Get current folder tree state snapshot.
 * For use with useSyncExternalStore.
 */
export function getFolderTreeState(): FolderTreeState {
    return currentState;
}

/**
 * Sync folder tree from main process.
 * Called when folder scan updates arrive.
 */
export function syncFolderTreeFromMain(tree: FolderTreeNode): void {
    currentState = { ...currentState, tree };
    notifySubscribers();
}

/**
 * Toggle a folder's expanded/collapsed state.
 */
export function toggleFolderExpanded(path: string): void {
    const next: Set<string> = new Set(currentState.expandedPaths);
    if (next.has(path)) {
        next.delete(path);
    } else {
        next.add(path);
    }
    currentState = { ...currentState, expandedPaths: next };
    notifySubscribers();
}

/**
 * Set the search query for filtering tree nodes.
 */
export function setFolderTreeSearch(query: string): void {
    currentState = { ...currentState, searchQuery: query };
    notifySubscribers();
}

/**
 * Toggle sidebar visibility.
 */
export function toggleFolderTreeSidebar(): void {
    const isOpen: boolean = !currentState.isOpen;
    currentState = { ...currentState, isOpen };
    persistState(isOpen, currentState.sidebarWidth);
    notifySubscribers();
}

/**
 * Set sidebar width (for resize).
 */
export function setSidebarWidth(width: number): void {
    currentState = { ...currentState, sidebarWidth: width };
    persistState(currentState.isOpen, width);
    notifySubscribers();
}

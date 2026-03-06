/**
 * Push-based folder tree state store.
 * Main process pushes tree updates via syncFolderTreeFromMain().
 * Renderer subscribes via useSyncExternalStore.
 *
 * Follows the same reducer pattern as reduceFolderConfig in transforms.ts.
 */

import type { FolderTreeNode } from '@/pure/folders/types';

export interface FolderTreeState {
    readonly tree: FolderTreeNode | null;
    readonly starredFolderTrees: Readonly<Record<string, FolderTreeNode>>;
    readonly expandedPaths: ReadonlySet<string>;
    readonly searchQuery: string;
    readonly isOpen: boolean;
    readonly sidebarWidth: number;
}

export type FolderTreeAction =
    | { readonly type: 'SYNC_TREE'; readonly tree: FolderTreeNode }
    | { readonly type: 'SYNC_STARRED_TREES'; readonly trees: Readonly<Record<string, FolderTreeNode>> }
    | { readonly type: 'TOGGLE_EXPANDED'; readonly path: string }
    | { readonly type: 'SET_SEARCH'; readonly query: string }
    | { readonly type: 'TOGGLE_SIDEBAR' }
    | { readonly type: 'SET_WIDTH'; readonly width: number };

/**
 * Pure reducer: (state, action) → state. No side effects.
 */
export function folderTreeReducer(state: FolderTreeState, action: FolderTreeAction): FolderTreeState {
    switch (action.type) {
        case 'SYNC_TREE':
            return { ...state, tree: action.tree };
        case 'SYNC_STARRED_TREES':
            return { ...state, starredFolderTrees: action.trees };
        case 'TOGGLE_EXPANDED': {
            const expandedPaths: ReadonlySet<string> = state.expandedPaths.has(action.path)
                ? new Set([...state.expandedPaths].filter((p: string) => p !== action.path))
                : new Set([...state.expandedPaths, action.path]);
            return { ...state, expandedPaths };
        }
        case 'SET_SEARCH':
            return { ...state, searchQuery: action.query };
        case 'TOGGLE_SIDEBAR':
            return { ...state, isOpen: !state.isOpen };
        case 'SET_WIDTH':
            return { ...state, sidebarWidth: action.width };
    }
}

// --- Persistence (extracted as a store subscriber) ---

const STORAGE_KEY_OPEN: string = 'folderTree.isOpen';
const STORAGE_KEY_WIDTH: string = 'folderTree.sidebarWidth';
const DEFAULT_WIDTH: number = 220;

function loadPersistedState(): { isOpen: boolean; sidebarWidth: number } {
    try {
        const isOpen: string | null = localStorage.getItem(STORAGE_KEY_OPEN);
        const width: string | null = localStorage.getItem(STORAGE_KEY_WIDTH);
        return {
            isOpen: isOpen === null ? true : isOpen === 'true',
            sidebarWidth: width ? Number(width) : DEFAULT_WIDTH,
        };
    } catch {
        return { isOpen: true, sidebarWidth: DEFAULT_WIDTH };
    }
}

// --- Store infrastructure ---

const persisted: { isOpen: boolean; sidebarWidth: number } = loadPersistedState();

const INITIAL_STATE: FolderTreeState = {
    tree: null,
    starredFolderTrees: {},
    expandedPaths: new Set(),
    searchQuery: '',
    isOpen: persisted.isOpen,
    sidebarWidth: persisted.sidebarWidth,
};

let currentState: FolderTreeState = INITIAL_STATE;

type FolderTreeCallback = (state: FolderTreeState) => void;
const subscribers: Set<FolderTreeCallback> = new Set();

function dispatch(action: FolderTreeAction): void {
    currentState = folderTreeReducer(currentState, action);
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

// --- Action dispatchers (thin wrappers over dispatch) ---

export function syncFolderTreeFromMain(tree: FolderTreeNode): void {
    dispatch({ type: 'SYNC_TREE', tree });
}

export function syncStarredTreesFromMain(trees: Readonly<Record<string, FolderTreeNode>>): void {
    dispatch({ type: 'SYNC_STARRED_TREES', trees });
}

export function toggleFolderExpanded(path: string): void {
    dispatch({ type: 'TOGGLE_EXPANDED', path });
}

export function setFolderTreeSearch(query: string): void {
    dispatch({ type: 'SET_SEARCH', query });
}

export function toggleFolderTreeSidebar(): void {
    dispatch({ type: 'TOGGLE_SIDEBAR' });
}

export function setSidebarWidth(width: number): void {
    dispatch({ type: 'SET_WIDTH', width });
}

// --- Persistence subscriber (side effect isolated from reducer) ---

subscribeFolderTree((state: FolderTreeState) => {
    try {
        localStorage.setItem(STORAGE_KEY_OPEN, String(state.isOpen));
        localStorage.setItem(STORAGE_KEY_WIDTH, String(state.sidebarWidth));
    } catch {
        // localStorage unavailable
    }
});

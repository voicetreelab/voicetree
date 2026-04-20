/**
 * Push-based folder tree state store.
 * Main process pushes tree updates via syncFolderTreeFromMain().
 * Renderer subscribes via useSyncExternalStore.
 *
 * Follows the same reducer pattern as reduceFolderConfig in transforms.ts.
 *
 * graphCollapsedFolders is renderer-owned state mirrored into the daemon
 * session through main RPC. Reads stay local; mutations go through the
 * addCollapsedFolder/removeCollapsedFolder facades below.
 */

import type { FolderTreeNode } from '@vt/graph-model/pure/folders/types';
import type { SerializedState } from '@vt/graph-state';
import type {} from '@/shell/electron';

export interface FolderTreeState {
    readonly tree: FolderTreeNode | null;
    readonly starredFolderTrees: Readonly<Record<string, FolderTreeNode>>;
    readonly externalFolderTrees: Readonly<Record<string, FolderTreeNode>>;
    readonly expandedPaths: ReadonlySet<string>;
    readonly searchQuery: string;
    readonly isOpen: boolean;
    readonly sidebarWidth: number;
    readonly graphCollapsedFolders: ReadonlySet<string>;
}

export type FolderTreeAction =
    | { readonly type: 'SYNC_TREE'; readonly tree: FolderTreeNode }
    | { readonly type: 'SYNC_STARRED_TREES'; readonly trees: Readonly<Record<string, FolderTreeNode>> }
    | { readonly type: 'SYNC_EXTERNAL_TREES'; readonly trees: Readonly<Record<string, FolderTreeNode>> }
    | { readonly type: 'TOGGLE_EXPANDED'; readonly path: string }
    | { readonly type: 'SET_SEARCH'; readonly query: string }
    | { readonly type: 'TOGGLE_SIDEBAR' }
    | { readonly type: 'SET_WIDTH'; readonly width: number }
    | { readonly type: 'ADD_COLLAPSED_FOLDER'; readonly folderId: string }
    | { readonly type: 'REMOVE_COLLAPSED_FOLDER'; readonly folderId: string };

/**
 * Pure reducer: (state, action) → state. No side effects.
 */
export function folderTreeReducer(state: FolderTreeState, action: FolderTreeAction): FolderTreeState {
    switch (action.type) {
        case 'SYNC_TREE':
            return { ...state, tree: action.tree };
        case 'SYNC_STARRED_TREES':
            return { ...state, starredFolderTrees: action.trees };
        case 'SYNC_EXTERNAL_TREES':
            return { ...state, externalFolderTrees: action.trees };
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
        case 'ADD_COLLAPSED_FOLDER': {
            if (state.graphCollapsedFolders.has(action.folderId)) {
                return state;
            }
            const graphCollapsedFolders: ReadonlySet<string> = new Set([...state.graphCollapsedFolders, action.folderId]);
            return { ...state, graphCollapsedFolders };
        }
        case 'REMOVE_COLLAPSED_FOLDER': {
            if (!state.graphCollapsedFolders.has(action.folderId)) {
                return state;
            }
            const graphCollapsedFolders: ReadonlySet<string> = new Set([...state.graphCollapsedFolders].filter((id: string) => id !== action.folderId));
            return { ...state, graphCollapsedFolders };
        }
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
    externalFolderTrees: {},
    expandedPaths: new Set(),
    searchQuery: '',
    isOpen: persisted.isOpen,
    sidebarWidth: persisted.sidebarWidth,
    graphCollapsedFolders: new Set(),
};

let currentState: FolderTreeState = INITIAL_STATE;
let isFetchingFolderTreeFromMain: boolean = false;
let shouldRefetchFolderTreeFromMain: boolean = false;

type FolderTreeCallback = (state: FolderTreeState) => void;
const subscribers: Set<FolderTreeCallback> = new Set();

function dispatch(action: FolderTreeAction): void {
    currentState = folderTreeReducer(currentState, action);
    for (const callback of subscribers) {
        callback(currentState);
    }
}

async function syncRendererSessionStateWithDaemon(): Promise<void> {
    if (typeof window === 'undefined') return;

    const syncRendererSessionState: (() => Promise<unknown>) | undefined =
        window.electronAPI?.main?.syncRendererSessionStateWithDaemon as (() => Promise<unknown>) | undefined;
    if (typeof syncRendererSessionState !== 'function') return;

    try {
        await syncRendererSessionState();
    } catch (error) {
        console.error('[FolderTreeStore] Failed to sync collapseSet with daemon session:', error);
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

function getLiveStateSnapshotFromMain():
    | (() => Promise<SerializedState>)
    | undefined {
    if (typeof window === 'undefined') return undefined;
    return window.electronAPI?.main?.getLiveStateSnapshot as (() => Promise<SerializedState>) | undefined;
}

function coerceFolderTreeFromMain(snapshot: SerializedState): FolderTreeNode | null {
    const root: SerializedState['roots']['folderTree'][number] | undefined = snapshot.roots.folderTree[0];
    return root ? root as FolderTreeNode : null;
}

// --- Action dispatchers (thin wrappers over dispatch) ---

export function syncFolderTreeFromMain(tree: FolderTreeNode): void {
    dispatch({ type: 'SYNC_TREE', tree });
}

export function syncStarredTreesFromMain(trees: Readonly<Record<string, FolderTreeNode>>): void {
    dispatch({ type: 'SYNC_STARRED_TREES', trees });
}

export function syncExternalTreesFromMain(trees: Readonly<Record<string, FolderTreeNode>>): void {
    dispatch({ type: 'SYNC_EXTERNAL_TREES', trees });
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

export function addCollapsedFolderLocally(folderId: string): void {
    dispatch({ type: 'ADD_COLLAPSED_FOLDER', folderId });
}

export async function addCollapsedFolder(folderId: string): Promise<void> {
    addCollapsedFolderLocally(folderId);
    await syncRendererSessionStateWithDaemon();
}

export function removeCollapsedFolderLocally(folderId: string): void {
    dispatch({ type: 'REMOVE_COLLAPSED_FOLDER', folderId });
}

export async function removeCollapsedFolder(folderId: string): Promise<void> {
    removeCollapsedFolderLocally(folderId);
    await syncRendererSessionStateWithDaemon();
}

export function isGraphFolderCollapsed(folderId: string): boolean {
    return currentState.graphCollapsedFolders.has(folderId);
}

/** Returns the current collapseSet from graph-state (avoids the graphCollapsedFolders field name). */
export function getGraphCollapseSet(): ReadonlySet<string> {
    return currentState.graphCollapsedFolders;
}

export async function initializeFromMainIfEmpty(): Promise<void> {
    if (currentState.tree !== null) return;

    const getLiveStateSnapshot: (() => Promise<SerializedState>) | undefined =
        getLiveStateSnapshotFromMain();
    if (typeof getLiveStateSnapshot !== 'function') return;

    if (isFetchingFolderTreeFromMain) {
        shouldRefetchFolderTreeFromMain = true;
        return;
    }

    isFetchingFolderTreeFromMain = true;

    try {
        const snapshot: SerializedState = await getLiveStateSnapshot();
        const tree: FolderTreeNode | null = coerceFolderTreeFromMain(snapshot);
        if (tree) {
            syncFolderTreeFromMain(tree);
        }
    } catch {
        // Leave the store empty outside Electron or if the snapshot fetch fails.
    } finally {
        isFetchingFolderTreeFromMain = false;
        if (shouldRefetchFolderTreeFromMain) {
            shouldRefetchFolderTreeFromMain = false;
            if (currentState.tree === null) {
                void initializeFromMainIfEmpty();
            }
        }
    }
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

void initializeFromMainIfEmpty();

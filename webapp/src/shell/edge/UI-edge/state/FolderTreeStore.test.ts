/**
 * BF-114: FolderTreeStore — Graph Collapse State Sync
 *
 * Tests the SYNC_GRAPH_COLLAPSED reducer action and the
 * absolutePathToGraphFolderId path mapping function.
 */

import { describe, it, expect } from 'vitest'
import {
    folderTreeReducer,
    syncGraphCollapsedFolders,
    getFolderTreeState,
    subscribeFolderTree,
    addCollapsedFolder,
    removeCollapsedFolder,
    isGraphFolderCollapsed,
    type FolderTreeState,
} from '@/shell/edge/UI-edge/state/FolderTreeStore'

// ── Pure reducer tests ──

describe('BF-114: folderTreeReducer — SYNC_GRAPH_COLLAPSED', () => {
    const baseState: FolderTreeState = {
        tree: null,
        starredFolderTrees: {},
        externalFolderTrees: {},
        expandedPaths: new Set(),
        searchQuery: '',
        isOpen: true,
        sidebarWidth: 220,
        graphCollapsedFolders: new Set(),
    }

    it('should update graphCollapsedFolders when SYNC_GRAPH_COLLAPSED dispatched', () => {
        const folders: ReadonlySet<string> = new Set(['auth/', 'utils/'])
        const next: FolderTreeState = folderTreeReducer(baseState, { type: 'SYNC_GRAPH_COLLAPSED', folders })

        expect(next.graphCollapsedFolders).toBe(folders)
        expect(next.graphCollapsedFolders.has('auth/')).toBe(true)
        expect(next.graphCollapsedFolders.has('utils/')).toBe(true)
    })

    it('should not mutate other state fields', () => {
        const folders: ReadonlySet<string> = new Set(['auth/'])
        const next: FolderTreeState = folderTreeReducer(baseState, { type: 'SYNC_GRAPH_COLLAPSED', folders })

        expect(next.tree).toBe(baseState.tree)
        expect(next.expandedPaths).toBe(baseState.expandedPaths)
        expect(next.isOpen).toBe(baseState.isOpen)
        expect(next.searchQuery).toBe(baseState.searchQuery)
    })

    it('should handle empty set (all folders expanded)', () => {
        const stateWithCollapsed: FolderTreeState = {
            ...baseState,
            graphCollapsedFolders: new Set(['auth/']),
        }
        const next: FolderTreeState = folderTreeReducer(stateWithCollapsed, {
            type: 'SYNC_GRAPH_COLLAPSED',
            folders: new Set(),
        })

        expect(next.graphCollapsedFolders.size).toBe(0)
    })

    it('should produce referentially new state object', () => {
        const folders: ReadonlySet<string> = new Set(['auth/'])
        const next: FolderTreeState = folderTreeReducer(baseState, { type: 'SYNC_GRAPH_COLLAPSED', folders })

        expect(next).not.toBe(baseState)
    })
})

// ── Store integration (dispatch + subscribe) ──

describe('BF-114: syncGraphCollapsedFolders dispatcher', () => {
    it('should update store state via syncGraphCollapsedFolders', () => {
        const folders: ReadonlySet<string> = new Set(['components/', 'hooks/'])
        syncGraphCollapsedFolders(folders)

        const state: FolderTreeState = getFolderTreeState()
        expect(state.graphCollapsedFolders.has('components/')).toBe(true)
        expect(state.graphCollapsedFolders.has('hooks/')).toBe(true)
    })

    it('should notify subscribers on SYNC_GRAPH_COLLAPSED', () => {
        let notifiedState: FolderTreeState | null = null
        const unsub: () => void = subscribeFolderTree((state: FolderTreeState) => {
            notifiedState = state
        })

        const folders: ReadonlySet<string> = new Set(['api/'])
        syncGraphCollapsedFolders(folders)

        expect(notifiedState).not.toBeNull()
        expect(notifiedState!.graphCollapsedFolders.has('api/')).toBe(true)

        unsub()
    })

    it('should not notify after unsubscribe', () => {
        let callCount: number = 0
        const unsub: () => void = subscribeFolderTree(() => {
            callCount++
        })

        syncGraphCollapsedFolders(new Set(['a/']))
        expect(callCount).toBe(1)

        unsub()
        syncGraphCollapsedFolders(new Set(['b/']))
        expect(callCount).toBe(1)
    })
})

// ── BF-117: ADD_COLLAPSED_FOLDER / REMOVE_COLLAPSED_FOLDER reducer ──

describe('BF-117: folderTreeReducer — ADD/REMOVE_COLLAPSED_FOLDER', () => {
    const baseState: FolderTreeState = {
        tree: null,
        starredFolderTrees: {},
        externalFolderTrees: {},
        expandedPaths: new Set(),
        searchQuery: '',
        isOpen: true,
        sidebarWidth: 220,
        graphCollapsedFolders: new Set(),
    }

    it('should add a folder to graphCollapsedFolders', () => {
        const next: FolderTreeState = folderTreeReducer(baseState, { type: 'ADD_COLLAPSED_FOLDER', folderId: 'auth/' })
        expect(next.graphCollapsedFolders.has('auth/')).toBe(true)
        expect(next.graphCollapsedFolders.size).toBe(1)
    })

    it('should accumulate multiple collapsed folders', () => {
        const s1: FolderTreeState = folderTreeReducer(baseState, { type: 'ADD_COLLAPSED_FOLDER', folderId: 'auth/' })
        const s2: FolderTreeState = folderTreeReducer(s1, { type: 'ADD_COLLAPSED_FOLDER', folderId: 'utils/' })
        expect(s2.graphCollapsedFolders.has('auth/')).toBe(true)
        expect(s2.graphCollapsedFolders.has('utils/')).toBe(true)
        expect(s2.graphCollapsedFolders.size).toBe(2)
    })

    it('should remove a folder from graphCollapsedFolders', () => {
        const withFolders: FolderTreeState = { ...baseState, graphCollapsedFolders: new Set(['auth/', 'utils/']) }
        const next: FolderTreeState = folderTreeReducer(withFolders, { type: 'REMOVE_COLLAPSED_FOLDER', folderId: 'auth/' })
        expect(next.graphCollapsedFolders.has('auth/')).toBe(false)
        expect(next.graphCollapsedFolders.has('utils/')).toBe(true)
        expect(next.graphCollapsedFolders.size).toBe(1)
    })

    it('should handle removing non-existent folder gracefully', () => {
        const next: FolderTreeState = folderTreeReducer(baseState, { type: 'REMOVE_COLLAPSED_FOLDER', folderId: 'nonexistent/' })
        expect(next.graphCollapsedFolders.size).toBe(0)
    })

    it('should not mutate other state fields', () => {
        const next: FolderTreeState = folderTreeReducer(baseState, { type: 'ADD_COLLAPSED_FOLDER', folderId: 'auth/' })
        expect(next.tree).toBe(baseState.tree)
        expect(next.expandedPaths).toBe(baseState.expandedPaths)
        expect(next.isOpen).toBe(baseState.isOpen)
    })
})

// ── BF-117: Dispatchers + query ──

describe('BF-117: addCollapsedFolder / removeCollapsedFolder / isGraphFolderCollapsed', () => {
    it('should add folder via dispatcher and query it', () => {
        addCollapsedFolder('bf117-test-add/')
        expect(isGraphFolderCollapsed('bf117-test-add/')).toBe(true)
    })

    it('should remove folder via dispatcher', () => {
        addCollapsedFolder('bf117-test-rm/')
        expect(isGraphFolderCollapsed('bf117-test-rm/')).toBe(true)
        removeCollapsedFolder('bf117-test-rm/')
        expect(isGraphFolderCollapsed('bf117-test-rm/')).toBe(false)
    })

    it('should return false for non-existent folder', () => {
        expect(isGraphFolderCollapsed('bf117-never-added/')).toBe(false)
    })

    it('should notify subscribers on ADD_COLLAPSED_FOLDER', () => {
        let notifiedState: FolderTreeState | null = null
        const unsub: () => void = subscribeFolderTree((state: FolderTreeState) => {
            notifiedState = state
        })

        addCollapsedFolder('bf117-notify/')
        expect(notifiedState).not.toBeNull()
        expect(notifiedState!.graphCollapsedFolders.has('bf117-notify/')).toBe(true)

        unsub()
    })
})

// ── absolutePathToGraphFolderId (pure function, duplicated in FolderTreeNode + FolderTreeSidebar) ──

describe('BF-114: absolutePathToGraphFolderId path mapping', () => {
    // Reproduce the pure function for testing (same logic in both files)
    function absolutePathToGraphFolderId(
        absolutePath: string, treeRootAbsolutePath: string
    ): string | null {
        if (!absolutePath.startsWith(treeRootAbsolutePath + '/')) return null
        const relative: string = absolutePath.slice(treeRootAbsolutePath.length + 1)
        return relative ? relative + '/' : null
    }

    it('should convert absolute path to relative graph folder ID', () => {
        expect(absolutePathToGraphFolderId(
            '/Users/bob/project/src/auth',
            '/Users/bob/project/src'
        )).toBe('auth/')
    })

    it('should handle nested folders', () => {
        expect(absolutePathToGraphFolderId(
            '/Users/bob/project/src/components/ui',
            '/Users/bob/project/src'
        )).toBe('components/ui/')
    })

    it('should return null for root path (same as tree root)', () => {
        expect(absolutePathToGraphFolderId(
            '/Users/bob/project/src',
            '/Users/bob/project/src'
        )).toBeNull()
    })

    it('should return null for paths outside tree root', () => {
        expect(absolutePathToGraphFolderId(
            '/Users/bob/other/folder',
            '/Users/bob/project/src'
        )).toBeNull()
    })

    it('should handle starred folder with different root (S4)', () => {
        // Starred folder tree might have root /Users/bob/external/
        expect(absolutePathToGraphFolderId(
            '/Users/bob/external/utils',
            '/Users/bob/external'
        )).toBe('utils/')
    })

    it('should return null when path is a prefix but not a child (no slash boundary)', () => {
        // "/Users/bob/project/src-extras" should NOT match root "/Users/bob/project/src"
        expect(absolutePathToGraphFolderId(
            '/Users/bob/project/src-extras',
            '/Users/bob/project/src'
        )).toBeNull()
    })
})

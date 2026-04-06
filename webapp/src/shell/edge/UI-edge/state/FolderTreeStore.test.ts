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

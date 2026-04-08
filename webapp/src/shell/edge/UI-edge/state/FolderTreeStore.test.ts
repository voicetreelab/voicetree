/**
 * FolderTreeStore — Graph Collapse State
 *
 * Tests ADD/REMOVE_COLLAPSED_FOLDER reducer actions and the
 * absolutePathToGraphFolderId path mapping function.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { FolderTreeNode } from '@vt/graph-model/pure/folders/types'
import {
    folderTreeReducer,
    subscribeFolderTree,
    addCollapsedFolder,
    removeCollapsedFolder,
    isGraphFolderCollapsed,
    getFolderTreeState,
    syncFolderTreeFromMain,
    syncStarredTreesFromMain,
    syncExternalTreesFromMain,
    toggleFolderExpanded,
    setFolderTreeSearch,
    toggleFolderTreeSidebar,
    setSidebarWidth,
    type FolderTreeState,
} from '@/shell/edge/UI-edge/state/FolderTreeStore'

function makeFolderTreeNode(label: string): FolderTreeNode {
    return { label } as unknown as FolderTreeNode
}

// ── ADD_COLLAPSED_FOLDER / REMOVE_COLLAPSED_FOLDER reducer ──

describe('folderTreeReducer — ADD/REMOVE_COLLAPSED_FOLDER', () => {
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

describe('folderTreeReducer — core store actions', () => {
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

    it('should sync the primary tree', () => {
        const tree = makeFolderTreeNode('root')
        const next = folderTreeReducer(baseState, { type: 'SYNC_TREE', tree })
        expect(next.tree).toBe(tree)
        expect(next.starredFolderTrees).toBe(baseState.starredFolderTrees)
    })

    it('should sync starred and external trees', () => {
        const starredTrees = { starred: makeFolderTreeNode('starred-root') }
        const externalTrees = { external: makeFolderTreeNode('external-root') }

        const withStarred = folderTreeReducer(baseState, {
            type: 'SYNC_STARRED_TREES',
            trees: starredTrees,
        })
        const withExternal = folderTreeReducer(baseState, {
            type: 'SYNC_EXTERNAL_TREES',
            trees: externalTrees,
        })

        expect(withStarred.starredFolderTrees).toBe(starredTrees)
        expect(withStarred.externalFolderTrees).toBe(baseState.externalFolderTrees)
        expect(withExternal.externalFolderTrees).toBe(externalTrees)
        expect(withExternal.starredFolderTrees).toBe(baseState.starredFolderTrees)
    })

    it('should toggle expanded paths on and off', () => {
        const expanded = folderTreeReducer(baseState, { type: 'TOGGLE_EXPANDED', path: 'auth/' })
        expect(expanded.expandedPaths.has('auth/')).toBe(true)

        const collapsed = folderTreeReducer(expanded, { type: 'TOGGLE_EXPANDED', path: 'auth/' })
        expect(collapsed.expandedPaths.has('auth/')).toBe(false)
        expect(collapsed.expandedPaths.size).toBe(0)
    })

    it('should set the search query', () => {
        const next = folderTreeReducer(baseState, { type: 'SET_SEARCH', query: 'auth' })
        expect(next.searchQuery).toBe('auth')
        expect(next.expandedPaths).toBe(baseState.expandedPaths)
    })

    it('should toggle the sidebar open state', () => {
        const next = folderTreeReducer(baseState, { type: 'TOGGLE_SIDEBAR' })
        expect(next.isOpen).toBe(false)
        expect(next.sidebarWidth).toBe(baseState.sidebarWidth)
    })

    it('should set the sidebar width', () => {
        const next = folderTreeReducer(baseState, { type: 'SET_WIDTH', width: 312 })
        expect(next.sidebarWidth).toBe(312)
        expect(next.isOpen).toBe(baseState.isOpen)
    })
})

// ── Dispatchers + query ──

describe('addCollapsedFolder / removeCollapsedFolder / isGraphFolderCollapsed', () => {
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

describe('FolderTreeStore dispatchers and persistence', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    afterEach(() => {
        localStorage.clear()
        vi.resetModules()
        vi.restoreAllMocks()
    })

    it('should apply sync and view actions through the store surface', () => {
        const tree = makeFolderTreeNode('root')
        const starredTrees = { starred: makeFolderTreeNode('starred-root') }
        const externalTrees = { external: makeFolderTreeNode('external-root') }

        syncFolderTreeFromMain(tree)
        syncStarredTreesFromMain(starredTrees)
        syncExternalTreesFromMain(externalTrees)
        toggleFolderExpanded('projects/')
        setFolderTreeSearch('project')

        const state = getFolderTreeState()
        expect(state.tree).toBe(tree)
        expect(state.starredFolderTrees).toBe(starredTrees)
        expect(state.externalFolderTrees).toBe(externalTrees)
        expect(state.expandedPaths.has('projects/')).toBe(true)
        expect(state.searchQuery).toBe('project')
    })

    it('should load persisted sidebar state on module initialization', async () => {
        localStorage.setItem('folderTree.isOpen', 'false')
        localStorage.setItem('folderTree.sidebarWidth', '333')

        const store = await import('@/shell/edge/UI-edge/state/FolderTreeStore')

        expect(store.getFolderTreeState().isOpen).toBe(false)
        expect(store.getFolderTreeState().sidebarWidth).toBe(333)
    })

    it('should persist sidebar changes when dispatchers run', async () => {
        const store = await import('@/shell/edge/UI-edge/state/FolderTreeStore')

        store.toggleFolderTreeSidebar()
        store.setSidebarWidth(280)

        expect(store.getFolderTreeState().isOpen).toBe(false)
        expect(store.getFolderTreeState().sidebarWidth).toBe(280)
        expect(localStorage.getItem('folderTree.isOpen')).toBe('false')
        expect(localStorage.getItem('folderTree.sidebarWidth')).toBe('280')
    })
})

// ── absolutePathToGraphFolderId (pure function, defined in @vt/graph-model) ──

describe('absolutePathToGraphFolderId path mapping', () => {
    // Reproduce the pure function for testing (same logic in both files)
    function absolutePathToGraphFolderId(
        absolutePath: string, treeRootAbsolutePath: string
    ): string | null {
        if (!absolutePath.startsWith(treeRootAbsolutePath + '/')) return null
        const normalized: string = absolutePath.replace(/\/$/, '')
        return normalized ? normalized + '/' : null
    }

    it('should preserve absolute path and append trailing slash', () => {
        expect(absolutePathToGraphFolderId(
            '/Users/bob/project/src/auth',
            '/Users/bob/project/src'
        )).toBe('/Users/bob/project/src/auth/')
    })

    it('should handle nested folders', () => {
        expect(absolutePathToGraphFolderId(
            '/Users/bob/project/src/components/ui',
            '/Users/bob/project/src'
        )).toBe('/Users/bob/project/src/components/ui/')
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
        )).toBe('/Users/bob/external/utils/')
    })

    it('should return null when path is a prefix but not a child (no slash boundary)', () => {
        // "/Users/bob/project/src-extras" should NOT match root "/Users/bob/project/src"
        expect(absolutePathToGraphFolderId(
            '/Users/bob/project/src-extras',
            '/Users/bob/project/src'
        )).toBeNull()
    })
})

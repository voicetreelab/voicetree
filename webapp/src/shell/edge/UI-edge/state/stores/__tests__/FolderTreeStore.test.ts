// @vitest-environment jsdom
/**
 * FolderTreeStore — sidebar tree state.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { FolderTreeNode } from '@vt/graph-model/folders'
import {
    folderTreeReducer,
    getFolderTreeState,
    syncFolderTreeFromMain,
    syncStarredTreesFromMain,
    syncExternalTreesFromMain,
    toggleFolderExpanded,
    setFolderTreeSearch,
    type FolderTreeState,
} from '@/shell/edge/UI-edge/state/stores/FolderTreeStore'

function makeFolderTreeNode(label: string): FolderTreeNode {
    return {
        name: label,
        absolutePath: `/tmp/${label}` as FolderTreeNode['absolutePath'],
        children: [],
        loadState: 'loaded',
        isWriteTarget: false,
    }
}

describe('folderTreeReducer — core store actions', () => {
    const baseState: FolderTreeState = {
        tree: null,
        starredFolderTrees: {},
        externalFolderTrees: {},
        expandedPaths: new Set(),
        searchQuery: '',
        isOpen: true,
        sidebarWidth: 220,
    }

    it('should sync the primary tree', () => {
        const tree: FolderTreeNode = makeFolderTreeNode('root')
        const next: FolderTreeState = folderTreeReducer(baseState, { type: 'SYNC_TREE', tree })
        expect(next.tree).toBe(tree)
        expect(next.starredFolderTrees).toBe(baseState.starredFolderTrees)
    })

    it('should sync starred and external trees', () => {
        const starredTrees: { starred: FolderTreeNode } = { starred: makeFolderTreeNode('starred-root') }
        const externalTrees: { external: FolderTreeNode } = { external: makeFolderTreeNode('external-root') }

        const withStarred: FolderTreeState = folderTreeReducer(baseState, {
            type: 'SYNC_STARRED_TREES',
            trees: starredTrees,
        })
        const withExternal: FolderTreeState = folderTreeReducer(baseState, {
            type: 'SYNC_EXTERNAL_TREES',
            trees: externalTrees,
        })

        expect(withStarred.starredFolderTrees).toBe(starredTrees)
        expect(withStarred.externalFolderTrees).toBe(baseState.externalFolderTrees)
        expect(withExternal.externalFolderTrees).toBe(externalTrees)
        expect(withExternal.starredFolderTrees).toBe(baseState.starredFolderTrees)
    })

    it('should toggle expanded paths on and off', () => {
        const expanded: FolderTreeState = folderTreeReducer(baseState, { type: 'TOGGLE_EXPANDED', path: 'auth/' })
        expect(expanded.expandedPaths.has('auth/')).toBe(true)

        const collapsed: FolderTreeState = folderTreeReducer(expanded, { type: 'TOGGLE_EXPANDED', path: 'auth/' })
        expect(collapsed.expandedPaths.has('auth/')).toBe(false)
        expect(collapsed.expandedPaths.size).toBe(0)
    })

    it('should set the search query', () => {
        const next: FolderTreeState = folderTreeReducer(baseState, { type: 'SET_SEARCH', query: 'auth' })
        expect(next.searchQuery).toBe('auth')
        expect(next.expandedPaths).toBe(baseState.expandedPaths)
    })

    it('should toggle the sidebar open state', () => {
        const next: FolderTreeState = folderTreeReducer(baseState, { type: 'TOGGLE_SIDEBAR' })
        expect(next.isOpen).toBe(false)
        expect(next.sidebarWidth).toBe(baseState.sidebarWidth)
    })

    it('should set the sidebar width', () => {
        const next: FolderTreeState = folderTreeReducer(baseState, { type: 'SET_WIDTH', width: 312 })
        expect(next.sidebarWidth).toBe(312)
        expect(next.isOpen).toBe(baseState.isOpen)
    })
})

describe('FolderTreeStore dispatchers and persistence', () => {
    beforeEach(() => {
        localStorage.clear()
        Reflect.deleteProperty(window, 'hostAPI')
    })

    afterEach(() => {
        localStorage.clear()
        Reflect.deleteProperty(window, 'hostAPI')
        vi.resetModules()
        vi.restoreAllMocks()
    })

    it('should apply sync and view actions through the store surface', () => {
        const tree: FolderTreeNode = makeFolderTreeNode('root')
        const starredTrees: { starred: FolderTreeNode } = { starred: makeFolderTreeNode('starred-root') }
        const externalTrees: { external: FolderTreeNode } = { external: makeFolderTreeNode('external-root') }

        syncFolderTreeFromMain(tree)
        syncStarredTreesFromMain(starredTrees)
        syncExternalTreesFromMain(externalTrees)
        toggleFolderExpanded('projects/')
        setFolderTreeSearch('project')

        const state: FolderTreeState = getFolderTreeState()
        expect(state.tree).toBe(tree)
        expect(state.starredFolderTrees).toBe(starredTrees)
        expect(state.externalFolderTrees).toBe(externalTrees)
        expect(state.expandedPaths.has('projects/')).toBe(true)
        expect(state.searchQuery).toBe('project')
    })

    it('should load persisted sidebar state on module initialization', async () => {
        localStorage.setItem('folderTree.isOpen', 'false')
        localStorage.setItem('folderTree.sidebarWidth', '333')

        const store: typeof import('@/shell/edge/UI-edge/state/stores/FolderTreeStore') =
            await import('@/shell/edge/UI-edge/state/stores/FolderTreeStore')

        expect(store.getFolderTreeState().isOpen).toBe(false)
        expect(store.getFolderTreeState().sidebarWidth).toBe(333)
    })

    it('should persist sidebar changes when dispatchers run', async () => {
        const store: typeof import('@/shell/edge/UI-edge/state/stores/FolderTreeStore') =
            await import('@/shell/edge/UI-edge/state/stores/FolderTreeStore')

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

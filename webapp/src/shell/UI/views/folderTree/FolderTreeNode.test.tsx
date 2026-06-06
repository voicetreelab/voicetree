// @vitest-environment jsdom

/**
 * FolderTreeNode — Graph Collapse Click Wiring Test
 *
 * Proves that clicking the blue graph-collapse dot (.folder-tree-graph-collapse-icon)
 * calls onToggleGraphCollapse with the folder node's absolute graph ID.
 *
 * Bug report: clicking the blue dot does nothing — the graph folder doesn't collapse.
 * This test should PASS if the wiring is correct, FAIL if it's broken.
 */

import { describe, it, expect, vi } from 'vitest'
import type { Mock } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import type { RenderResult as RTLRenderResult } from '@testing-library/react'
import { FolderTreeNodeComponent } from './FolderTreeNode'
import type { FolderTreeNode as FolderTreeNodeType } from '@vt/graph-model/folders'
import { toAbsolutePath } from '@vt/graph-model/folders'

// Mock the electron.d.ts side-effect import
vi.mock('@/shell/hostApi.d.ts', () => ({}))

describe('FolderTreeNode — graph collapse dot click', () => {
    const treeRootPath: string = '/Users/bob/project'

    function makeFolderNode(overrides: Partial<FolderTreeNodeType> = {}): FolderTreeNodeType {
        return {
            name: 'src',
            absolutePath: toAbsolutePath('/Users/bob/project/src'),
            children: [],
            loadState: 'loaded',
            isWriteTarget: false,
            ...overrides,
        }
    }

    function renderNode(opts: {
        node?: FolderTreeNodeType;
        collapsedGraphFolderIds?: ReadonlySet<string>;
        onToggleGraphCollapse?: (path: string) => void;
    } = {}): RTLRenderResult & { onToggleGraphCollapse: Mock | ((path: string) => void) } {
        const node: FolderTreeNodeType = opts.node ?? makeFolderNode()
        const onToggleGraphCollapse: Mock | ((path: string) => void) = opts.onToggleGraphCollapse ?? vi.fn()
        const collapsedGraphFolderIds: ReadonlySet<string> = opts.collapsedGraphFolderIds ?? new Set<string>()

        const result: RTLRenderResult = render(
            <FolderTreeNodeComponent
                node={node}
                depth={1}
                searchQuery=""
                expandedPaths={new Set<string>()}
                onToggleExpand={vi.fn()}
                onToggleLoad={vi.fn()}
                onFileSelect={vi.fn()}
                onSetWriteTarget={vi.fn()}
                collapsedGraphFolderIds={collapsedGraphFolderIds}
                treeRootPath={treeRootPath}
                onToggleGraphCollapse={onToggleGraphCollapse}
            />
        )

        return { ...result, onToggleGraphCollapse }
    }

    it('should render the graph-collapse blue dot for a sub-folder of the tree root', () => {
        const { container } = renderNode()
        const dot: Element | null = container.querySelector('.folder-tree-graph-collapse-icon')
        expect(dot).not.toBeNull()
    })

    it('should NOT render the blue dot when the node IS the tree root (absolutePathToGraphFolderId returns null)', () => {
        const rootNode: FolderTreeNodeType = makeFolderNode({
            name: 'project',
            absolutePath: toAbsolutePath('/Users/bob/project'),
        })
        const { container } = renderNode({ node: rootNode })
        const dot: Element | null = container.querySelector('.folder-tree-graph-collapse-icon')
        expect(dot).toBeNull()
    })

    it('should call onToggleGraphCollapse with the resolved graphFolderId when the blue dot is clicked', () => {
        const onToggleGraphCollapse: Mock = vi.fn()
        const node: FolderTreeNodeType = makeFolderNode()
        const { container } = renderNode({ node, onToggleGraphCollapse })

        const dot: Element | null = container.querySelector('.folder-tree-graph-collapse-icon')
        expect(dot).not.toBeNull()

        fireEvent.click(dot!)

        expect(onToggleGraphCollapse).toHaveBeenCalledTimes(1)
        expect(onToggleGraphCollapse).toHaveBeenCalledWith('/Users/bob/project/src/')
    })

    it('should stop propagation so the folder row click handler is not triggered', () => {
        const onToggleExpand: Mock = vi.fn()
        const onToggleGraphCollapse: Mock = vi.fn()
        const node: FolderTreeNodeType = makeFolderNode()

        const { container } = render(
            <FolderTreeNodeComponent
                node={node}
                depth={1}
                searchQuery=""
                expandedPaths={new Set<string>()}
                onToggleExpand={onToggleExpand}
                onToggleLoad={vi.fn()}
                onFileSelect={vi.fn()}
                onSetWriteTarget={vi.fn()}
                collapsedGraphFolderIds={new Set<string>()}
                treeRootPath={treeRootPath}
                onToggleGraphCollapse={onToggleGraphCollapse}
            />
        )

        const dot: Element | null = container.querySelector('.folder-tree-graph-collapse-icon')
        expect(dot).not.toBeNull()

        fireEvent.click(dot!)

        // The blue dot click should NOT also toggle folder expansion
        expect(onToggleExpand).not.toHaveBeenCalled()
        // But the graph collapse callback SHOULD have fired
        expect(onToggleGraphCollapse).toHaveBeenCalledTimes(1)
    })

    it('should show "collapsed" class when the folder is in collapsedGraphFolderIds', () => {
        const collapsedGraphFolderIds: ReadonlySet<string> = new Set<string>(['/Users/bob/project/src/'])
        const { container } = renderNode({ collapsedGraphFolderIds })

        const dot: Element | null = container.querySelector('.folder-tree-graph-collapse-icon')
        expect(dot).not.toBeNull()
        expect(dot!.classList.contains('collapsed')).toBe(true)
    })

    it('should show "expanded" class when the folder is NOT in collapsedGraphFolderIds', () => {
        const collapsedGraphFolderIds: ReadonlySet<string> = new Set<string>()
        const { container } = renderNode({ collapsedGraphFolderIds })

        const dot: Element | null = container.querySelector('.folder-tree-graph-collapse-icon')
        expect(dot).not.toBeNull()
        expect(dot!.classList.contains('expanded')).toBe(true)
    })

    // A not-loaded (unloaded/'hidden') folder has no graph presence, so it has no
    // collapse/expand state to show. Rendering the binary dot for it would default
    // to the "expanded" class (absent from collapsedGraphFolderIds) while the
    // folder is nowhere in the graph — the "expanded yet invisible" contradiction.
    it('should NOT render the blue dot for a not-loaded folder (no graph presence to collapse)', () => {
        const notLoaded: FolderTreeNodeType = makeFolderNode({ loadState: 'not-loaded' })
        const { container } = renderNode({ node: notLoaded })

        const dot: Element | null = container.querySelector('.folder-tree-graph-collapse-icon')
        expect(dot).toBeNull()
    })
})

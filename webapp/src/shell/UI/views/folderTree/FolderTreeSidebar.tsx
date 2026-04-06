/**
 * FolderTreeSidebar (React) - Hierarchical file tree sidebar
 *
 * Renders folder tree with load states, starred section, search, and hover actions.
 * Self-contained: subscribes to FolderTreeStore and VaultPathStore internally.
 * Mounted/unmounted via createFolderTreeSidebar / disposeFolderTreeSidebar.
 *
 * Follows the same patterns as TerminalTreeSidebar.
 */

import { createElement, useRef, useEffect, useCallback, useState, useMemo, useSyncExternalStore } from 'react';
import type { JSX, ChangeEvent, KeyboardEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AvailableFolderItem } from '@vt/graph-model/pure/folders/types';
import {
    subscribeFolderTree,
    getFolderTreeState,
    toggleFolderExpanded,
    setFolderTreeSearch,
    toggleFolderTreeSidebar,
    setSidebarWidth,
    type FolderTreeState,
} from '@/shell/edge/UI-edge/state/FolderTreeStore';
import {
    subscribeToVaultPaths,
    getVaultState,
    type VaultPathState,
} from '@/shell/edge/UI-edge/state/VaultPathStore';
import { FolderTreeNodeComponent } from './FolderTreeNode';
import { StarredSection } from './StarredSection';
import { getCyInstance } from '@/shell/edge/UI-edge/state/cytoscape-state';
import { toggleFolderCollapse } from '@/shell/edge/UI-edge/graph/folderCollapse';
import type {} from '@/shell/electron';

import './folder-tree.css';

// =============================================================================
// Path Conversion
// =============================================================================

function absolutePathToGraphFolderId(
    absolutePath: string, treeRootAbsolutePath: string
): string | null {
    if (!absolutePath.startsWith(treeRootAbsolutePath + '/')) return null;
    const relative: string = absolutePath.slice(treeRootAbsolutePath.length + 1);
    return relative ? relative + '/' : null;
}

// =============================================================================
// Store Hooks
// =============================================================================

function useFolderTreeState(): FolderTreeState {
    return useSyncExternalStore(subscribeFolderTree, getFolderTreeState);
}

function useVaultPathState(): VaultPathState {
    return useSyncExternalStore(subscribeToVaultPaths, getVaultState);
}

// =============================================================================
// Resize Hook (same pattern as TerminalTreeSidebar)
// =============================================================================

function useResizeHandle(sidebarRef: React.RefObject<HTMLDivElement | null>): React.RefObject<HTMLDivElement | null> {
    const handleRef: React.RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const handle: HTMLDivElement | null = handleRef.current;
        const sidebar: HTMLDivElement | null = sidebarRef.current;
        if (!handle || !sidebar) return;

        let isResizing: boolean = false;
        let startX: number = 0;
        let startWidth: number = 0;

        const onMouseDown: (e: MouseEvent) => void = (e: MouseEvent): void => {
            isResizing = true;
            startX = e.clientX;
            startWidth = sidebar.offsetWidth;
            handle.classList.add('dragging');
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        };

        const onMouseMove: (e: MouseEvent) => void = (e: MouseEvent): void => {
            if (!isResizing) return;
            const deltaX: number = e.clientX - startX;
            const newWidth: number = Math.min(400, Math.max(120, startWidth + deltaX));
            sidebar.style.width = `${newWidth}px`;
        };

        const onMouseUp: () => void = (): void => {
            isResizing = false;
            handle.classList.remove('dragging');
            const currentWidth: number = sidebarRef.current?.offsetWidth ?? 220;
            setSidebarWidth(currentWidth);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        handle.addEventListener('mousedown', onMouseDown);
        return () => {
            handle.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
    }, [sidebarRef]);

    return handleRef;
}

// StarredSection extracted to ./StarredSection.tsx

// =============================================================================
// Footer Section (Add folder, Browse, Create dated folder)
// =============================================================================

interface FooterSectionProps {
    readonly watchDirectory: string | null;
    readonly readPaths: readonly string[];
}

// eslint-disable-next-line react-refresh/only-export-components
function FooterSection({ watchDirectory, readPaths }: FooterSectionProps): JSX.Element {
    const [addQuery, setAddQuery] = useState<string>('');
    const [availableFolders, setAvailableFolders] = useState<readonly AvailableFolderItem[]>([]);
    const [showResults, setShowResults] = useState<boolean>(false);

    const fetchFolders: (query: string) => Promise<void> = useCallback(async (query: string): Promise<void> => {
        if (!window.electronAPI) return;
        try {
            const folders: readonly AvailableFolderItem[] = await window.electronAPI.main.getAvailableFoldersForSelector(query);
            setAvailableFolders(folders);
        } catch (err) {
            console.error('[FolderTreeSidebar] Failed to fetch available folders:', err);
        }
    }, []);

    useEffect(() => {
        if (addQuery) {
            void fetchFolders(addQuery);
            setShowResults(true);
        } else {
            setAvailableFolders([]);
            setShowResults(false);
        }
    }, [addQuery, fetchFolders]);

    const handleAddAsRead: (path: string) => void = useCallback((path: string): void => {
        void window.electronAPI?.main.addReadPath(path);
        setAddQuery('');
        setShowResults(false);
    }, []);

    const handleSetAsWrite: (path: string) => void = useCallback((path: string): void => {
        void window.electronAPI?.main.addReadPath(path).then(() => {
            void window.electronAPI?.main.setWritePath(path);
        });
        setAddQuery('');
        setShowResults(false);
    }, []);

    const handleBrowseExternal: () => void = useCallback((): void => {
        void (async (): Promise<void> => {
            if (!window.electronAPI) return;
            try {
                const result: { success: boolean; path?: string } = await window.electronAPI.main.showFolderPicker({
                    defaultPath: watchDirectory ?? undefined,
                    buttonLabel: 'Add Folder',
                    title: 'Select Folder to Add',
                });
                if (result.success && result.path) {
                    void window.electronAPI.main.addReadPath(result.path);
                }
            } catch (err) {
                console.error('[FolderTreeSidebar] Error browsing for folder:', err);
            }
        })();
    }, [watchDirectory]);

    const handleCreateDatedFolder: () => void = useCallback((): void => {
        void window.electronAPI?.main.createDatedVoiceTreeFolder();
    }, []);

    const handleInputChange: (e: ChangeEvent<HTMLInputElement>) => void = useCallback(
        (e: ChangeEvent<HTMLInputElement>): void => {
            setAddQuery(e.target.value);
        }, []
    );

    const handleInputKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void = useCallback(
        (e: KeyboardEvent<HTMLInputElement>): void => {
            if (e.key === 'Escape') {
                setAddQuery('');
                setShowResults(false);
            } else if (e.key === 'Enter' && addQuery.trim() && watchDirectory) {
                e.preventDefault();
                const trimmed: string = addQuery.trim();
                const exactMatch: AvailableFolderItem | undefined = availableFolders.find(
                    (f: AvailableFolderItem) => f.displayPath === trimmed
                );
                if (exactMatch) {
                    handleSetAsWrite(exactMatch.absolutePath);
                } else if (!trimmed.startsWith('.')) {
                    handleSetAsWrite(trimmed.startsWith('/') ? trimmed : watchDirectory + '/' + trimmed);
                }
            }
        }, [addQuery, watchDirectory, availableFolders, handleSetAsWrite]
    );

    const visibleFolders: readonly AvailableFolderItem[] = availableFolders.slice(0, 8);

    return (
        <div className="folder-tree-footer">
            {/* Add folder search */}
            <div className="folder-tree-footer-search">
                <input
                    type="text"
                    className="folder-tree-search-input"
                    placeholder="+ Add folder..."
                    value={addQuery}
                    onChange={handleInputChange}
                    onKeyDown={handleInputKeyDown}
                    onFocus={() => { if (addQuery) setShowResults(true); }}
                />
            </div>

            {/* Search results dropdown */}
            {showResults && visibleFolders.length > 0 && (
                <div className="folder-tree-add-results">
                    {visibleFolders.map((folder: AvailableFolderItem) => {
                        const isLoaded: boolean = readPaths.includes(folder.absolutePath);
                        return (
                            <div
                                key={folder.absolutePath}
                                className={`folder-tree-add-result-item${isLoaded ? ' loaded' : ''}`}
                                title={folder.absolutePath}
                            >
                                <span className="folder-tree-add-result-name">
                                    {folder.displayPath === '.' ? './' : './' + folder.displayPath}
                                </span>
                                {!isLoaded && (
                                    <button
                                        className="folder-tree-add-result-btn"
                                        onClick={() => handleAddAsRead(folder.absolutePath)}
                                        title="Add as read folder"
                                    >
                                        +
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Action buttons */}
            <div className="folder-tree-footer-actions">
                <button
                    className="folder-tree-footer-btn"
                    onClick={handleCreateDatedFolder}
                    title="Create new dated voicetree folder"
                >
                    New voicetree
                </button>
                <button
                    className="folder-tree-footer-btn"
                    onClick={handleBrowseExternal}
                    title="Browse and add external folder"
                >
                    Browse...
                </button>
            </div>
        </div>
    );
}

// =============================================================================
// Main Sidebar Component
// =============================================================================

interface SidebarInternalProps {
    readonly callbacks: { readonly onFileSelect: (path: string) => void };
}

// eslint-disable-next-line react-refresh/only-export-components
function FolderTreeSidebarInternal({ callbacks }: SidebarInternalProps): JSX.Element | null {
    const folderState: FolderTreeState = useFolderTreeState();
    const vaultState: VaultPathState = useVaultPathState();
    const sidebarRef: React.RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);
    const resizeHandleRef: React.RefObject<HTMLDivElement | null> = useResizeHandle(sidebarRef);

    const handleSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>): void => {
            setFolderTreeSearch(e.target.value);
        }, []
    );

    const handleClose: () => void = useCallback((): void => {
        toggleFolderTreeSidebar();
    }, []);

    const handleToggleLoad: (path: string, currentState: 'loaded' | 'not-loaded') => void = useCallback(
        (path: string, currentState: 'loaded' | 'not-loaded'): void => {
            if (currentState === 'loaded') {
                void window.electronAPI?.main.removeReadPath(path);
            } else {
                void window.electronAPI?.main.addReadPath(path);
            }
        }, []
    );

    const handleSetWriteTarget: (path: string) => void = useCallback(
        (path: string): void => {
            void window.electronAPI?.main.setWritePath(path);
        }, []
    );

    const handleToggleGraphCollapse: (absolutePath: string) => void = useCallback(
        (absolutePath: string): void => {
            const graphFolderId: string | null = absolutePathToGraphFolderId(
                absolutePath, folderState.tree?.absolutePath ?? ''
            );
            if (!graphFolderId) return;
            void toggleFolderCollapse(getCyInstance(), graphFolderId);
        }, [folderState.tree?.absolutePath]
    );

    const projectName: string = useMemo(() => {
        if (!folderState.tree) return 'Project';
        return folderState.tree.name;
    }, [folderState.tree]);

    const watchDirectory: string | null = useMemo(() => {
        if (!folderState.tree) return null;
        return folderState.tree.absolutePath;
    }, [folderState.tree]);

    return (
        <div
            ref={sidebarRef}
            className="folder-tree-sidebar"
            data-testid="folder-tree-sidebar"
            style={{ width: `${folderState.sidebarWidth}px`, display: folderState.isOpen ? 'flex' : 'none' }}
        >
            {/* Header */}
            <div className="folder-tree-header">
                <span className="folder-tree-header-title">{projectName}</span>
                <button className="folder-tree-close-btn" onClick={handleClose}>&times;</button>
            </div>

            {/* Search */}
            <div className="folder-tree-search">
                <input
                    type="text"
                    className="folder-tree-search-input"
                    placeholder="Search files..."
                    value={folderState.searchQuery}
                    onChange={handleSearchChange}
                />
            </div>

            {/* Starred Section */}
            <StarredSection
                starredFolders={vaultState.starredFolders}
                starredFolderTrees={folderState.starredFolderTrees}
                readPaths={vaultState.readPaths}
                writePath={vaultState.writePath}
                expandedPaths={folderState.expandedPaths}
                onFileSelect={callbacks.onFileSelect}
                onToggleExpand={toggleFolderExpanded}
                onToggleLoad={handleToggleLoad}
                onSetWriteTarget={handleSetWriteTarget}
                graphCollapsedFolders={folderState.graphCollapsedFolders}
                onToggleGraphCollapse={handleToggleGraphCollapse}
            />

            {/* External Folders (read paths outside project root) */}
            {Object.keys(folderState.externalFolderTrees).length > 0 && (
                <div className="folder-tree-external-section">
                    <div className="folder-tree-section-header">EXTERNAL</div>
                    {Object.entries(folderState.externalFolderTrees).map(([folderPath, tree]: [string, import('@vt/graph-model/pure/folders/types').FolderTreeNode]) => (
                        <FolderTreeNodeComponent
                            key={folderPath}
                            node={tree}
                            depth={0}
                            searchQuery={folderState.searchQuery}
                            expandedPaths={folderState.expandedPaths}
                            onToggleExpand={toggleFolderExpanded}
                            onToggleLoad={handleToggleLoad}
                            onFileSelect={callbacks.onFileSelect}
                            onSetWriteTarget={handleSetWriteTarget}
                            graphCollapsedFolders={folderState.graphCollapsedFolders}
                            treeRootPath={tree.absolutePath}
                            onToggleGraphCollapse={handleToggleGraphCollapse}
                        />
                    ))}
                </div>
            )}

            {/* Project Folders */}
            <div className="folder-tree-container">
                {folderState.tree ? (
                    <FolderTreeNodeComponent
                        node={folderState.tree}
                        depth={0}
                        searchQuery={folderState.searchQuery}
                        expandedPaths={folderState.expandedPaths}
                        onToggleExpand={toggleFolderExpanded}
                        onToggleLoad={handleToggleLoad}
                        onFileSelect={callbacks.onFileSelect}
                        onSetWriteTarget={handleSetWriteTarget}
                        graphCollapsedFolders={folderState.graphCollapsedFolders}
                        treeRootPath={folderState.tree.absolutePath}
                        onToggleGraphCollapse={handleToggleGraphCollapse}
                    />
                ) : (
                    <div className="folder-tree-empty">No folder loaded</div>
                )}
            </div>

            {/* Footer */}
            <FooterSection
                watchDirectory={watchDirectory}
                readPaths={vaultState.readPaths}
            />

            {/* Resize Handle */}
            <div ref={resizeHandleRef} className="folder-tree-resize-handle" />
        </div>
    );
}

// =============================================================================
// Mount / Unmount (public API)
// =============================================================================

let reactRoot: Root | null = null;
let mountPoint: HTMLDivElement | null = null;

/**
 * Create and mount the folder tree sidebar into a parent container.
 */
export function createFolderTreeSidebar(
    container: HTMLElement,
    callbacks: { onFileSelect: (path: string) => void },
): void {
    disposeFolderTreeSidebar();

    mountPoint = document.createElement('div');
    mountPoint.setAttribute('data-testid', 'folder-tree-sidebar-mount');
    mountPoint.style.position = 'relative';
    mountPoint.style.height = '100%';
    container.appendChild(mountPoint);

    reactRoot = createRoot(mountPoint);
    reactRoot.render(createElement(FolderTreeSidebarInternal, { callbacks }));
}

/**
 * Dispose the folder tree sidebar and clean up resources.
 */
export function disposeFolderTreeSidebar(): void {
    if (reactRoot) {
        reactRoot.unmount();
        reactRoot = null;
    }
    if (mountPoint) {
        mountPoint.remove();
        mountPoint = null;
    }
}

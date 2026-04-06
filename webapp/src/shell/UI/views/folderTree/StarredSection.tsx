/**
 * StarredSection - Renders starred folders with expandable subtrees.
 *
 * Each starred folder shows its absolute path on hover and renders
 * its children collapsed (like the rest of the file tree) when tree data is available.
 */

import { useState, useCallback } from 'react';
import type { JSX } from 'react';
import type { FolderTreeNode } from '@vt/graph-model/pure/folders/types';
import { FolderTreeNodeComponent } from './FolderTreeNode';
import type {} from '@/shell/electron';

interface StarredSectionProps {
    readonly starredFolders: readonly string[];
    readonly starredFolderTrees: Readonly<Record<string, FolderTreeNode>>;
    readonly readPaths: readonly string[];
    readonly writePath: string | null;
    readonly expandedPaths: ReadonlySet<string>;
    readonly onFileSelect: (path: string) => void;
    readonly onToggleExpand: (path: string) => void;
    readonly onToggleLoad: (path: string, currentState: 'loaded' | 'not-loaded') => void;
    readonly onSetWriteTarget: (path: string) => void;
    readonly graphCollapsedFolders: ReadonlySet<string>;
    readonly onToggleGraphCollapse: (absolutePath: string) => void;
}

export function StarredSection({ starredFolders, starredFolderTrees, readPaths, writePath, expandedPaths, onFileSelect, onToggleExpand, onToggleLoad, onSetWriteTarget, graphCollapsedFolders, onToggleGraphCollapse }: StarredSectionProps): JSX.Element | null {
    const [collapsed, setCollapsed] = useState<boolean>(false);

    const toggleCollapsed: () => void = useCallback((): void => {
        setCollapsed((prev: boolean) => !prev);
    }, []);

    const handleUnstar: (e: React.MouseEvent, folder: string) => void = useCallback(
        (e: React.MouseEvent, folder: string): void => {
            e.stopPropagation();
            void window.electronAPI?.main.removeStarredFolder(folder);
        }, []
    );

    if (starredFolders.length === 0) return null;

    return (
        <div className="folder-tree-starred-section">
            <div className="folder-tree-section-header" onClick={toggleCollapsed}>
                <span className="folder-tree-expand-icon">{collapsed ? '\u25B6' : '\u25BC'}</span>
                <span className="folder-tree-section-title">STARRED</span>
            </div>
            {!collapsed && starredFolders.map((folder: string) => {
                const treeNode: FolderTreeNode | undefined = starredFolderTrees[folder];

                // If tree data is available, render as expandable folder node
                if (treeNode) {
                    return (
                        <div key={folder} className="folder-tree-starred-item-tree" title={folder}>
                            <span
                                className="folder-tree-starred-star"
                                onClick={(e: React.MouseEvent) => handleUnstar(e, folder)}
                                title="Unstar folder"
                            >
                                {'\u2605'}
                            </span>
                            <FolderTreeNodeComponent
                                node={treeNode}
                                depth={0}
                                searchQuery=""
                                expandedPaths={expandedPaths}
                                onToggleExpand={onToggleExpand}
                                onToggleLoad={onToggleLoad}
                                onFileSelect={onFileSelect}
                                onSetWriteTarget={onSetWriteTarget}
                                graphCollapsedFolders={graphCollapsedFolders}
                                treeRootPath={treeNode.absolutePath}
                                onToggleGraphCollapse={onToggleGraphCollapse}
                            />
                        </div>
                    );
                }

                // Fallback: no tree data (folder doesn't exist or hasn't been scanned)
                const isLoaded: boolean = readPaths.includes(folder);
                const isWriteTarget: boolean = writePath === folder;
                const loadState: 'loaded' | 'not-loaded' = isLoaded ? 'loaded' : 'not-loaded';
                return (
                    <div
                        key={folder}
                        className={`folder-tree-starred-item${isLoaded ? '' : ' not-loaded'}`}
                        onClick={() => onFileSelect(folder)}
                        title={folder}
                    >
                        <span
                            className="folder-tree-starred-star"
                            onClick={(e: React.MouseEvent) => handleUnstar(e, folder)}
                            title="Unstar folder"
                        >
                            {'\u2605'}
                        </span>
                        <span className="folder-tree-folder-name">
                            {folder.split('/').pop() ?? folder}
                        </span>
                        <span className="folder-tree-path-tag">
                            {folder.replace(/^\/Users\/[^/]+/, '~')}
                        </span>
                        {isWriteTarget ? (
                            <span className="folder-tree-write-icon" title="Write target">{'\u270E'}</span>
                        ) : (
                            <span
                                className="folder-tree-set-write-btn"
                                onClick={(e: React.MouseEvent) => { e.stopPropagation(); onSetWriteTarget(folder); }}
                                title="Set as write target"
                            >
                                {'\u270E'}
                            </span>
                        )}
                        <span
                            className={`folder-tree-load-indicator ${loadState}`}
                            onClick={(e: React.MouseEvent) => { e.stopPropagation(); onToggleLoad(folder, loadState); }}
                            title={isLoaded ? 'Click to unload' : 'Click to load'}
                        />
                    </div>
                );
            })}
        </div>
    );
}

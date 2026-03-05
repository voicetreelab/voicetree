/**
 * FolderTreeNode - Recursive tree node renderer for folder/file hierarchy.
 *
 * Renders FolderTreeNode (expandable, with load state) and FileTreeNode (leaf, with graph indicator).
 * Follows the same component patterns as TerminalTreeSidebar's TreeNode.
 */

import { useCallback } from 'react';
import type { JSX } from 'react';
import type { FolderTreeNode as FolderTreeNodeType, FileTreeNode as FileTreeNodeType } from '@/pure/folders/types';
import { isFolderTreeNode } from '@/pure/folders/types';

interface FolderNodeProps {
    readonly node: FolderTreeNodeType;
    readonly depth: number;
    readonly searchQuery: string;
    readonly expandedPaths: ReadonlySet<string>;
    readonly onToggleExpand: (path: string) => void;
    readonly onToggleLoad: (path: string, currentState: 'loaded' | 'not-loaded') => void;
    readonly onFileSelect: (path: string) => void;
    readonly onSetWriteTarget: (path: string) => void;
}

interface FileNodeProps {
    readonly node: FileTreeNodeType;
    readonly depth: number;
    readonly parentLoaded: boolean;
    readonly onFileSelect: (path: string) => void;
}

function matchesSearch(name: string, query: string): boolean {
    if (!query) return true;
    return name.toLowerCase().includes(query.toLowerCase());
}

function folderContainsMatch(node: FolderTreeNodeType, query: string): boolean {
    if (!query) return true;
    if (matchesSearch(node.name, query)) return true;
    return node.children.some((child) => {
        if (isFolderTreeNode(child)) return folderContainsMatch(child, query);
        return matchesSearch(child.name, query);
    });
}

function FileNode({ node, depth, parentLoaded, onFileSelect }: FileNodeProps): JSX.Element {
    const handleClick: () => void = useCallback((): void => {
        onFileSelect(node.absolutePath);
    }, [onFileSelect, node.absolutePath]);

    return (
        <div
            className={`folder-tree-file${parentLoaded ? '' : ' not-loaded'}${node.isInGraph ? ' in-graph' : ''}`}
            data-depth={depth}
            onClick={handleClick}
            title={node.absolutePath}
        >
            <span className="folder-tree-file-icon">
                {node.isInGraph ? '\u25CF' : '\u25CB'}
            </span>
            <span className="folder-tree-file-name">{node.name}</span>
        </div>
    );
}

export function FolderTreeNodeComponent({ node, depth, searchQuery, expandedPaths, onToggleExpand, onToggleLoad, onFileSelect, onSetWriteTarget }: FolderNodeProps): JSX.Element | null {
    const handleExpandClick: () => void = useCallback((): void => {
        onToggleExpand(node.absolutePath);
    }, [onToggleExpand, node.absolutePath]);

    const handleLoadClick: (e: React.MouseEvent) => void = useCallback((e: React.MouseEvent): void => {
        e.stopPropagation();
        onToggleLoad(node.absolutePath, node.loadState);
    }, [onToggleLoad, node.absolutePath, node.loadState]);

    const handleSetWriteTarget: (e: React.MouseEvent) => void = useCallback((e: React.MouseEvent): void => {
        e.stopPropagation();
        onSetWriteTarget(node.absolutePath);
    }, [onSetWriteTarget, node.absolutePath]);

    if (searchQuery && !folderContainsMatch(node, searchQuery)) {
        return null;
    }

    const filteredChildren: readonly (FolderTreeNodeType | FileTreeNodeType)[] = searchQuery
        ? node.children.filter((child) => {
            if (isFolderTreeNode(child)) return folderContainsMatch(child, searchQuery);
            return matchesSearch(child.name, searchQuery);
        })
        : node.children;

    return (
        <div className="folder-tree-node-wrapper">
            <div
                className={`folder-tree-folder${node.loadState === 'not-loaded' ? ' not-loaded' : ''}`}
                data-depth={depth}
                onClick={handleExpandClick}
                title={node.absolutePath}
            >
                <span className="folder-tree-expand-icon">
                    {expandedPaths.has(node.absolutePath) ? '\u25BC' : '\u25B6'}
                </span>
                <span className="folder-tree-folder-name">{node.name}</span>
                {node.isWriteTarget ? (
                    <span className="folder-tree-write-icon" title="Write target">{'\u270E'}</span>
                ) : (
                    <span
                        className="folder-tree-set-write-btn"
                        onClick={handleSetWriteTarget}
                        title="Set as write target"
                    >
                        {'\u270E'}
                    </span>
                )}
                <span
                    className={`folder-tree-load-indicator ${node.loadState}`}
                    onClick={handleLoadClick}
                    title={node.loadState === 'loaded' ? 'Click to unload' : 'Click to load'}
                />
            </div>
            {expandedPaths.has(node.absolutePath) && filteredChildren.length > 0 && (
                <div className="folder-tree-children">
                    {filteredChildren.map((child) => {
                        if (isFolderTreeNode(child)) {
                            return (
                                <FolderTreeNodeComponent
                                    key={child.absolutePath}
                                    node={child}
                                    depth={depth + 1}
                                    searchQuery={searchQuery}
                                    expandedPaths={expandedPaths}
                                    onToggleExpand={onToggleExpand}
                                    onToggleLoad={onToggleLoad}
                                    onFileSelect={onFileSelect}
                                    onSetWriteTarget={onSetWriteTarget}
                                />
                            );
                        }
                        return (
                            <FileNode
                                key={child.absolutePath}
                                node={child}
                                depth={depth + 1}
                                parentLoaded={node.loadState === 'loaded'}
                                onFileSelect={onFileSelect}
                            />
                        );
                    })}
                </div>
            )}
        </div>
    );
}

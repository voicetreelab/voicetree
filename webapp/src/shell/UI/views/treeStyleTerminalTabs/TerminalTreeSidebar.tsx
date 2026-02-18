/**
 * TerminalTreeSidebar (React) - Declarative tree-style vertical tabs for terminals
 *
 * Single declarative render path — activity dots, status dots, and active state
 * all derive from props. No separate "targeted DOM update" vs "full re-render" paths.
 *
 * Self-contained: subscribes to TerminalStore internally via useState + useEffect.
 * Mounted/unmounted via createTerminalTreeSidebar / disposeTerminalTreeSidebar.
 */

import { createElement, useRef, useEffect, useCallback, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import { getTerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';
import { buildTerminalTree, type TerminalTreeNode } from '@/pure/agentTabs/terminalTree';
import { getShortcutHintForTab } from '@/pure/agentTabs';
import {
    subscribeToTerminalChanges,
    subscribeToActiveTerminalChange,
    getTerminals,
    getActiveTerminalId,
    clearTerminals,
} from '@/shell/edge/UI-edge/state/TerminalStore';
import {
    syncDisplayOrder,
} from '@/shell/edge/UI-edge/state/AgentTabsStore';
import {
    startTerminalActivityPolling,
    stopTerminalActivityPolling,
} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalActivityPolling';
import { clearActivityForTerminal } from './agentTabsActivity';

// Re-export activity tracking functions for external callers
export { markTerminalActivityForContextNode, clearActivityForTerminal } from './agentTabsActivity';

// =============================================================================
// Store Hooks
// =============================================================================

function useTerminals(): TerminalData[] {
    const [terminals, setTerminals] = useState<TerminalData[]>(
        () => Array.from(getTerminals().values())
    );

    useEffect(() => {
        return subscribeToTerminalChanges(setTerminals);
    }, []);

    return terminals;
}

function useActiveTerminalId(): TerminalId | null {
    const [activeId, setActiveId] = useState<TerminalId | null>(getActiveTerminalId);

    useEffect(() => {
        return subscribeToActiveTerminalChange(setActiveId);
    }, []);

    return activeId;
}

// =============================================================================
// Resize Hook
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
            const newWidth: number = Math.min(300, Math.max(60, startWidth + deltaX));
            sidebar.style.width = `${newWidth}px`;
        };

        const onMouseUp: () => void = (): void => {
            isResizing = false;
            handle.classList.remove('dragging');
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

// =============================================================================
// Tree Node Component
// =============================================================================

interface TreeNodeProps {
    readonly treeNode: TerminalTreeNode;
    readonly isActive: boolean;
    readonly shortcutHint: string | null;
    readonly onSelect: (terminal: TerminalData) => void;
}

function TreeNode({ treeNode, isActive, shortcutHint, onSelect }: TreeNodeProps): JSX.Element {
    const { terminal, depth } = treeNode;
    const terminalId: TerminalId = terminal.terminalId;

    const handleClick: () => void = useCallback((): void => {
        onSelect(terminal);
    }, [onSelect, terminal]);

    const handleClose: (e: React.MouseEvent) => void = useCallback((e: React.MouseEvent): void => {
        e.stopPropagation();
        const terminalElement: Element | null = document.querySelector(`[data-floating-window-id="${terminalId}"]`);
        if (terminalElement) {
            terminalElement.dispatchEvent(new CustomEvent('traffic-light-close', { bubbles: true }));
        }
    }, [terminalId]);

    const handleMouseDown: (e: React.MouseEvent) => void = useCallback((e: React.MouseEvent): void => {
        e.stopPropagation();
    }, []);

    const activityDots: JSX.Element[] = useMemo(() => {
        const dots: JSX.Element[] = [];
        for (let i: number = 0; i < terminal.activityCount; i++) {
            dots.push(<span key={i} className="terminal-tree-activity-dot" />);
        }
        return dots;
    }, [terminal.activityCount]);

    return (
        <div
            className={`terminal-tree-node${isActive ? ' active' : ''}`}
            data-depth={depth}
            data-terminal-id={terminalId}
            onClick={handleClick}
            onMouseDown={handleMouseDown}
        >
            {/* Status indicator */}
            <span className={`terminal-tree-status ${terminal.isDone ? 'done' : 'running'}`} />

            {/* Title container */}
            <span className="terminal-tree-title">
                <span className="terminal-tree-title-text">{terminal.title}</span>
                {terminal.worktreeName && (
                    <span className="terminal-tree-worktree" title={terminal.worktreeName}>
                        {'\u2387'} {terminal.worktreeName}
                    </span>
                )}
                <span className="terminal-tree-agent-id" title={terminalId}>
                    {terminalId}
                </span>
            </span>

            {/* Activity dots */}
            {activityDots}

            {/* Shortcut hint */}
            {shortcutHint && (
                <span className="terminal-tab-shortcut-hint">{shortcutHint}</span>
            )}

            {/* Close button */}
            <button className="terminal-tree-close" onClick={handleClose}>
                &times;
            </button>
        </div>
    );
}

// =============================================================================
// Main Sidebar Component
// =============================================================================

interface SidebarInternalProps {
    readonly onNavigate: (terminal: TerminalData) => void;
}

function TerminalTreeSidebarInternal({ onNavigate }: SidebarInternalProps): JSX.Element | null {
    const terminals: TerminalData[] = useTerminals();
    const activeTerminalId: TerminalId | null = useActiveTerminalId();
    const sidebarRef: React.RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);
    const resizeHandleRef: React.RefObject<HTMLDivElement | null> = useResizeHandle(sidebarRef);

    // Start/stop activity polling with component lifecycle
    useEffect(() => {
        startTerminalActivityPolling();
        return () => stopTerminalActivityPolling();
    }, []);

    const treeNodes: TerminalTreeNode[] = useMemo(
        () => buildTerminalTree(terminals),
        [terminals]
    );

    const displayOrder: TerminalId[] = useMemo(
        () => syncDisplayOrder(terminals),
        [terminals]
    );

    const activeIndex: number = useMemo(
        () => (activeTerminalId ? displayOrder.indexOf(activeTerminalId) : -1),
        [activeTerminalId, displayOrder]
    );

    const totalTabs: number = displayOrder.length;

    const handleSelect: (terminal: TerminalData) => void = useCallback((terminal: TerminalData): void => {
        clearActivityForTerminal(getTerminalId(terminal));
        onNavigate(terminal);
    }, [onNavigate]);

    if (terminals.length === 0) return null;

    return (
        <div
            ref={sidebarRef}
            className="terminal-tree-sidebar"
            data-testid="terminal-tree-sidebar"
            style={{ display: 'flex' }}
        >
            <div className="terminal-tree-header">Terminals</div>
            <div className="terminal-tree-container">
                {treeNodes.map((treeNode: TerminalTreeNode) => {
                    const terminalId: TerminalId = treeNode.terminal.terminalId;
                    const tabIndex: number = displayOrder.indexOf(terminalId);
                    const hint: string | null = getShortcutHintForTab(tabIndex, activeIndex, totalTabs);

                    return (
                        <TreeNode
                            key={terminalId}
                            treeNode={treeNode}
                            isActive={terminalId === activeTerminalId}
                            shortcutHint={hint}
                            onSelect={handleSelect}
                        />
                    );
                })}
            </div>
            <div ref={resizeHandleRef} className="terminal-tree-resize-handle" />
        </div>
    );
}

// =============================================================================
// Mount / Unmount (public API — same surface as imperative version)
// =============================================================================

let reactRoot: Root | null = null;

/**
 * Create and mount the terminal tree sidebar into a parent container.
 * @param container - DOM element to mount into
 * @param onNavigate - Callback when user clicks a terminal tab (for fit-to-terminal navigation)
 * @returns cleanup function
 */
export function createTerminalTreeSidebar(
    container: HTMLElement,
    onNavigate: (terminal: TerminalData) => void,
): () => void {
    disposeTerminalTreeSidebar();

    const mountPoint: HTMLDivElement = document.createElement('div');
    mountPoint.setAttribute('data-testid', 'terminal-tree-sidebar-mount');
    container.appendChild(mountPoint);

    reactRoot = createRoot(mountPoint);
    reactRoot.render(createElement(TerminalTreeSidebarInternal, { onNavigate }));

    return disposeTerminalTreeSidebar;
}

/**
 * Dispose the terminal tree sidebar and clean up resources.
 * Also clears terminal stores to ensure clean state when switching projects.
 */
export function disposeTerminalTreeSidebar(): void {
    if (reactRoot) {
        reactRoot.unmount();
        reactRoot = null;
    }

    // Clear terminal stores to ensure clean state when switching projects
    clearTerminals();
}

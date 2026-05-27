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
import { Play } from 'lucide-react';
import { createRoot, type Root } from 'react-dom/client';
import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/anchoring/types';
import { getTerminalId } from '@/shell/edge/UI-edge/floating-windows/anchoring/types';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';
import { buildTerminalTree, type ChildStatusSummary, type TerminalTreeNode } from '@vt/graph-model/agent-tabs';
import { getShortcutHintForTab } from '@vt/graph-model/agent-tabs';
import { getShortcutPlatform } from '@/shell/UI/platform/shortcutPlatform';

import { useCollapseState } from './terminalTreeCollapseState';
import {
    subscribeToTerminalChanges,
    subscribeToActiveTerminalChange,
    getTerminals,
    getActiveTerminalId,
    clearTerminals,
} from '@/shell/edge/UI-edge/state/stores/TerminalStore';
import {
    clearUnclaimedTmuxSessions,
    startUnclaimedTmuxPolling,
    stopUnclaimedTmuxPolling,
} from '@/shell/edge/UI-edge/state/stores/recovery/UnclaimedTmuxStore';
import {
    attachRecoverySession,
    clearRecoverySessions,
    forkRecoverySession,
    killRecoverySession,
    refreshRecoverySessions,
    removeRecoverySession,
    resumeRecoverySession,
    startRecoverySessionsPolling,
    stopRecoverySessionsPolling,
} from '@/shell/edge/UI-edge/state/stores/recovery/RecoverySessionsStore';
import {useRecoverySessions} from './survivingAgentsHooks';
import {SurvivingAgentsTrashButton} from './SurvivingAgentsTrashButton';
import {
    syncDisplayOrder,
} from '@/shell/edge/UI-edge/state/stores/AgentTabsStore';
import {
    startTerminalActivityPolling,
    stopTerminalActivityPolling,
} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalActivityPolling';
import { clearActivityForTerminal } from './agentTabsActivity';
import { restoreTerminal } from './terminalTabUtils';
import { closeTerminalById } from '@/shell/edge/UI-edge/floating-windows/terminals/closeTerminalById';
import { SurvivingAgentsSection } from './SurvivingAgentsSection';
import type { RecoverableAgentSession } from '@vt/agent-runtime';

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
            const newWidth: number = Math.min(360, Math.max(60, startWidth + deltaX));
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
// Collapsed-parent summary chip
// =============================================================================

/**
 * Renders a tiny pill showing total descendant count + colored pips for any
 * status with a non-zero count. Only the "interesting" statuses get pips —
 * `idle` is omitted to reduce noise (it's the default quiet state).
 *
 * Order: awaiting → errored → active → completed → spawning. This puts the
 * action-required and broken statuses leftmost so the eye sees them first.
 */
function renderSummaryChip(s: ChildStatusSummary): JSX.Element | null {
    if (s.total === 0) return null;
    return (
        <span className="terminal-tree-summary" title={summaryTitle(s)}>
            <span className="terminal-tree-summary-count">{s.total}</span>
        </span>
    );
}

function summaryTitle(s: ChildStatusSummary): string {
    const parts: string[] = [];
    if (s.awaiting) parts.push(`${s.awaiting} awaiting`);
    if (s.errored) parts.push(`${s.errored} errored`);
    if (s.active) parts.push(`${s.active} working`);
    if (s.idle) parts.push(`${s.idle} idle`);
    if (s.completed) parts.push(`${s.completed} done`);
    if (s.spawning) parts.push(`${s.spawning} starting`);
    return `${s.total} descendant${s.total === 1 ? '' : 's'}: ${parts.join(', ')}`;
}

// =============================================================================
// Tree Node Component
// =============================================================================

interface TreeNodeProps {
    readonly treeNode: TerminalTreeNode;
    readonly isActive: boolean;
    readonly shortcutHint: string | null;
    readonly onSelect: (terminal: TerminalData) => void;
    readonly isCollapsed: boolean;
    readonly onToggleCollapse: (id: TerminalId, directChildCount: number) => void;
    readonly resumeCliType: 'claude' | 'codex' | null;
}

// eslint-disable-next-line react-refresh/only-export-components
function TreeNode({ treeNode, isActive, shortcutHint, onSelect, isCollapsed, onToggleCollapse, resumeCliType }: TreeNodeProps): JSX.Element {
    const { terminal, depth, hasChildren, directChildCount, descendantSummary } = treeNode;
    const terminalId: TerminalId = terminal.terminalId;

    // Clicking a parent row both navigates to the orchestrator's terminal AND
    // toggles its sub-agent group — replaces the old separate chevron control.
    const handleClick: () => void = useCallback((): void => {
        if (hasChildren) {
            onToggleCollapse(terminalId, directChildCount);
        }
        onSelect(terminal);
    }, [onSelect, terminal, hasChildren, onToggleCollapse, terminalId, directChildCount]);

    const handleClose: (e: React.MouseEvent) => void = useCallback((e: React.MouseEvent): void => {
        e.stopPropagation();
        if (terminal.isHeadless) {
            void window.electronAPI?.main.closeHeadlessAgent(terminalId);
            return;
        }
        const terminalElement: Element | null = document.querySelector(`[data-floating-window-id="${terminalId}"]`);
        if (terminalElement) {
            terminalElement.dispatchEvent(new CustomEvent('traffic-light-close', { bubbles: true }));
        } else {
            closeTerminalById(terminalId);
        }
    }, [terminalId, terminal.isHeadless]);

    const handleMouseDown: (e: React.MouseEvent) => void = useCallback((e: React.MouseEvent): void => {
        e.stopPropagation();
    }, []);

    const handleFork: (e: React.MouseEvent) => void = useCallback((e: React.MouseEvent): void => {
        e.stopPropagation();
        void forkRecoverySession(terminalId);
    }, [terminalId]);

    const activityDots: JSX.Element[] = useMemo(() => {
        const dots: JSX.Element[] = [];
        for (let i: number = 0; i < terminal.activityCount; i++) {
            dots.push(<span key={i} className="terminal-tree-activity-dot" />);
        }
        return dots;
    }, [terminal.activityCount]);

    // Lifecycle drives both the row tint (only awaiting_input gets blue) and the
    // status icon class. Minimized takes precedence over lifecycle for icon style
    // since it's a viewport hint, not a true state.
    const isAwaiting: boolean = !terminal.isMinimized && terminal.lifecycle === 'awaiting_input';
    const statusClass: string = terminal.isMinimized
        ? 'minimized'
        : `lifecycle-${terminal.lifecycle}`;

    // Collapsed-parent summary chip \u2014 shows count + colored pips for descendants
    // that the user can't see at a glance because they're hidden below the fold.
    const summary: JSX.Element | null = (hasChildren && isCollapsed)
        ? renderSummaryChip(descendantSummary)
        : null;

    return (
        <div
            className={`terminal-tree-node${isActive ? ' active' : ''}${terminal.isHeadless ? ' headless' : ''}${isAwaiting ? ' attn' : ''}${hasChildren ? ' has-children' : ''}`}
            data-depth={depth}
            data-terminal-id={terminalId}
            onClick={handleClick}
            onMouseDown={handleMouseDown}
            aria-expanded={hasChildren ? !isCollapsed : undefined}
        >
            {/* Lifecycle indicator. Glyph (if any) supplied via CSS ::after. */}
            <span className={`terminal-tree-status ${statusClass}`} />

            {/* Title container */}
            <span className="terminal-tree-title">
                <span className="terminal-tree-title-text">{terminal.title}</span>
                {terminal.worktreeName && (
                    <span className="terminal-tree-worktree" title={terminal.worktreeName}>
                        {'\u2387'} {terminal.worktreeName}
                    </span>
                )}
                <span className="terminal-tree-agent-id" title={terminalId}>
                    {terminalId}{terminal.agentTypeName ? ` - ${terminal.agentTypeName}` : ''}{terminal.isHeadless ? ' (Headless)' : ''}
                </span>
            </span>

            {summary}

            {/* Activity dots */}
            {activityDots}

            {/* Shortcut hint */}
            {shortcutHint && (
                <span className="terminal-tab-shortcut-hint">{shortcutHint}</span>
            )}

            {/* Fork button — only shown when the recovery feed reports a resume
                capability for this terminal. Spawns a new tab continuing the
                same conversation, leaving the live agent untouched. */}
            {resumeCliType && (
                <button
                    className="terminal-tree-fork"
                    type="button"
                    onClick={handleFork}
                    onMouseDown={handleMouseDown}
                    title={`Fork ${resumeCliType} session into a new tab`}
                    aria-label={`Fork ${resumeCliType} session`}
                >
                    <Play size={11} aria-hidden="true" />
                </button>
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

// eslint-disable-next-line react-refresh/only-export-components
function TerminalTreeSidebarInternal({ onNavigate }: SidebarInternalProps): JSX.Element | null {
    const allTerminals: TerminalData[] = useTerminals();
    const recoverySessions: readonly RecoverableAgentSession[] = useRecoverySessions();
    const activeTerminalId: TerminalId | null = useActiveTerminalId();
    const sidebarRef: React.RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);
    const resizeHandleRef: React.RefObject<HTMLDivElement | null> = useResizeHandle(sidebarRef);

    const terminals: TerminalData[] = allTerminals;

    // Start/stop activity polling with component lifecycle
    useEffect(() => {
        startTerminalActivityPolling();
        startUnclaimedTmuxPolling();
        startRecoverySessionsPolling();
        return () => {
            stopTerminalActivityPolling();
            stopUnclaimedTmuxPolling();
            stopRecoverySessionsPolling();
        };
    }, []);

    const collapse = useCollapseState();

    const treeNodes: TerminalTreeNode[] = useMemo(
        () => buildTerminalTree(terminals, (parent, n) => collapse.isCollapsed(parent.terminalId as TerminalId, n)),
        [terminals, collapse]
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
    const shortcutPlatform = useMemo(() => getShortcutPlatform(), []);
    const hasSidebarContent: boolean = terminals.length > 0 || recoverySessions.length > 0;

    // Index resume capability by terminalId so TreeNode can render the fork
    // button without re-scanning the session list per row.
    const resumeCliByTerminalId: ReadonlyMap<string, 'claude' | 'codex'> = useMemo(() => {
        const out: Map<string, 'claude' | 'codex'> = new Map();
        for (const session of recoverySessions) {
            if (session.resume) out.set(session.terminalId, session.resume.cliType);
        }
        return out;
    }, [recoverySessions]);

    const handleSelect: (terminal: TerminalData) => void = useCallback((terminal: TerminalData): void => {
        if (!terminal.isHeadless && terminal.isMinimized) {
            restoreTerminal(getTerminalId(terminal));
        }
        clearActivityForTerminal(getTerminalId(terminal));
        onNavigate(terminal);
    }, [onNavigate]);

    return (
        <div
            ref={sidebarRef}
            className="terminal-tree-sidebar"
            data-testid="terminal-tree-sidebar"
            style={{ display: hasSidebarContent ? 'flex' : 'none' }}
        >
            <div className="terminal-tree-header">Terminals</div>
            <div className="terminal-tree-container">
                {treeNodes.map((treeNode: TerminalTreeNode) => {
                    const terminalId: TerminalId = treeNode.terminal.terminalId;
                    const tabIndex: number = displayOrder.indexOf(terminalId);
                    const hint: string | null = getShortcutHintForTab(tabIndex, activeIndex, totalTabs, shortcutPlatform);
                    const collapsed: boolean = treeNode.hasChildren
                        && collapse.isCollapsed(terminalId, treeNode.directChildCount);

                    return (
                        <TreeNode
                            key={terminalId}
                            treeNode={treeNode}
                            isActive={terminalId === activeTerminalId}
                            shortcutHint={hint}
                            onSelect={handleSelect}
                            isCollapsed={collapsed}
                            onToggleCollapse={collapse.toggle}
                            resumeCliType={resumeCliByTerminalId.get(terminalId) ?? null}
                        />
                    );
                })}
            </div>
            <SurvivingAgentsSection
                sessions={recoverySessions}
                onRefresh={refreshRecoverySessions}
                onAttach={attachRecoverySession}
                onKill={killRecoverySession}
                onResume={resumeRecoverySession}
                renderRowActions={(row: RecoverableAgentSession) => (
                    // Trash is rendered only when the row has no live attach
                    // capability — deleting metadata for a live tmux pane is
                    // refused at the runtime layer anyway, but hiding the
                    // button keeps the UI honest about which rows are safe
                    // to nuke.
                    row.attach ? null : (
                        <SurvivingAgentsTrashButton
                            terminalId={row.terminalId}
                            onDelete={removeRecoverySession}
                        />
                    )
                )}
            />
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
    mountPoint.style.position = 'relative';
    mountPoint.style.height = '100%';
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
    clearUnclaimedTmuxSessions();
    clearRecoverySessions();
}

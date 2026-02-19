/**
 * Business logic for determining which menu items appear on a node.
 * Separated from DOM creation (menuItemDom.ts) for independent testability.
 */

import type { Core } from 'cytoscape';
import { Plus, Play, Trash2, AlertTriangle, Clipboard, ChevronDown, Edit2, GitBranch, FolderOpen } from 'lucide';
import type { GraphNode } from "@/pure/graph";
import { createNewChildNodeFromUI, deleteNodesFromUI } from "@/shell/edge/UI-edge/graph/handleUIActions";
import { getCurrentIndex } from '@/shell/UI/cytoscape-graph-ui/services/spatialIndexSync';
import { formatShortcut } from '@/pure/utils/keyboardShortcutDisplay';
import {
    spawnTerminalWithNewContextNode,
    spawnTerminalWithCommandEditor,
    spawnTerminalInNewWorktree,
} from "@/shell/edge/UI-edge/floating-windows/terminals/spawnTerminalWithCommandFromUI";
import { getFilePathForNode, getNodeFromMainToUI } from "@/shell/edge/UI-edge/graph/getNodeFromMainToUI";
import type { VTSettings } from "@/pure/settings";
import { highlightContainedNodes, highlightPreviewNodes, clearContainedHighlights } from '@/shell/UI/cytoscape-graph-ui/highlightContextNodes';
import { getTerminals } from '@/shell/edge/UI-edge/state/TerminalStore';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';
import type { WorktreeInfo } from '@/shell/edge/main/worktree/gitWorktreeCommands';
import type { WatchStatus } from '@/shell/electron';
import { showWorktreeDeleteConfirmation } from '@/shell/edge/UI-edge/graph/worktreeDeletePopup';
import type { SliderConfig, HorizontalMenuItem, NodeMenuItemsInput } from './horizontalMenuTypes';

/**
 * Create slider config for run buttons (non-context nodes only).
 * The slider allows adjusting context retrieval distance and shows preview.
 */
function createRunButtonSliderConfig(
    cy: Core,
    nodeId: string,
    currentDistance: number,
    menuElement: HTMLElement
): SliderConfig {
    return {
        currentDistance,
        onDistanceChange: (newDistance: number): void => {
            void (async (): Promise<void> => {
                const currentSettings: VTSettings | null = await window.electronAPI?.main.loadSettings() ?? null;
                if (currentSettings && window.electronAPI) {
                    await window.electronAPI.main.saveSettings({...currentSettings, contextNodeMaxDistance: newDistance});
                }
                clearContainedHighlights(cy);
                await highlightPreviewNodes(cy, nodeId);
            })();
        },
        menuElement,
    };
}

/**
 * Get menu items for a node - pure function that returns menu item definitions.
 * Extracted for reuse by floating window chrome.
 */
export function getNodeMenuItems(input: NodeMenuItemsInput): HorizontalMenuItem[] {
    const { nodeId, cy, agents, isContextNode, currentDistance, menuElement } = input;
    const menuItems: HorizontalMenuItem[] = [];

    // Create slider config for non-context nodes (context nodes don't need distance slider)
    // Only create if menuElement is provided (required for slider to be appended as child)
    const sliderConfig: SliderConfig | undefined = !isContextNode && currentDistance !== undefined && menuElement
        ? createRunButtonSliderConfig(cy, nodeId, currentDistance, menuElement)
        : undefined;

    // LEFT SIDE: Delete, Copy, Add (3 buttons)
    menuItems.push({
        icon: Trash2, label: 'Delete', hotkey: formatShortcut('Backspace'),
        action: () => deleteNodesFromUI([nodeId], cy),
    });
    menuItems.push({
        icon: Clipboard, label: 'Copy Path',
        action: () => { void navigator.clipboard.writeText(getFilePathForNode(nodeId)); },
    });
    menuItems.push({
        icon: Plus, label: 'Add Child', hotkey: formatShortcut('N'),
        action: () => { void createNewChildNodeFromUI(nodeId, cy, getCurrentIndex(cy)); },
    });

    // RIGHT SIDE: Run, More (2 buttons) + traffic light placeholders (Close, Pin, Fullscreen)
    menuItems.push({
        icon: Play,
        label: 'Run',
        color: '#22c55e', // green
        hotkey: formatShortcut('Enter'),
        action: async () => {
            await spawnTerminalWithNewContextNode(nodeId, cy);
        },
        // Context nodes: show contained nodes. Normal nodes: preview what would be captured.
        onHoverEnter: isContextNode
            ? () => highlightContainedNodes(cy, nodeId)
            : () => highlightPreviewNodes(cy, nodeId),
        onHoverLeave: () => clearContainedHighlights(cy),
        sliderConfig, // Show distance slider on hover for non-context nodes
        getSubMenuItems: async (): Promise<HorizontalMenuItem[]> => {
            const items: HorizontalMenuItem[] = [
                { icon: GitBranch, label: 'New Worktree', action: () => { void spawnTerminalInNewWorktree(nodeId, cy); } },
            ];

            // Fetch existing worktrees dynamically
            const watchStatus: WatchStatus | undefined = await window.electronAPI?.main.getWatchStatus();
            const repoRoot: string | undefined = watchStatus?.directory;
            if (repoRoot) {
                const worktrees: WorktreeInfo[] = await window.electronAPI?.main.listWorktrees(repoRoot) ?? [];
                // Check which worktrees have active (running) terminals
                const terminalMap: Map<string, TerminalData> = getTerminals();
                const activeWorktreeNames: Set<string> = new Set<string>();
                for (const terminal of terminalMap.values()) {
                    if (terminal.worktreeName && !terminal.isDone) {
                        activeWorktreeNames.add(terminal.worktreeName);
                    }
                }

                for (const wt of worktrees) {
                    const hasActiveTerminal: boolean = activeWorktreeNames.has(wt.branch);
                    items.push({
                        icon: GitBranch,
                        label: wt.name,
                        action: () => { void spawnTerminalWithNewContextNode(nodeId, cy, undefined, wt.path); },
                        secondaryAction: {
                            icon: hasActiveTerminal ? AlertTriangle : Trash2,
                            color: hasActiveTerminal ? '#f59e0b' : undefined, // amber warning for active worktrees
                            tooltip: hasActiveTerminal ? 'Terminal active in this worktree' : 'Delete worktree',
                            action: async () => {
                                if (!repoRoot) return;
                                const confirmed: { force: boolean } | null = await showWorktreeDeleteConfirmation(wt.name, wt.path, wt.branch);
                                if (!confirmed) return;

                                const ipcResult: { success: boolean; command: string; error?: string } | undefined =
                                    await window.electronAPI?.main.removeWorktree(repoRoot, wt.path, false);
                                if (ipcResult?.success) return;

                                // Normal delete failed — offer force delete
                                const retry: { force: boolean } | null = await showWorktreeDeleteConfirmation(
                                    wt.name, wt.path, wt.branch,
                                    ipcResult?.error ?? 'Deletion failed',
                                );
                                if (!retry) return;
                                await window.electronAPI?.main.removeWorktree(repoRoot, wt.path, true);
                            },
                        },
                    });
                }
            }

            items.push({ icon: Edit2, label: 'Edit Command', action: () => spawnTerminalWithCommandEditor(nodeId, cy) });
            return items;
        },
    });

    // Expandable "more" menu with Copy to Starred, Copy Content, and additional agents
    const moreSubMenu: HorizontalMenuItem[] = [
        {
            icon: FolderOpen,
            label: 'Copy to...',
            action: () => {}, // No-op, submenu handles interaction
            getSubMenuItems: async (): Promise<HorizontalMenuItem[]> => {
                const starredFolders: readonly string[] = await window.electronAPI?.main.getStarredFolders() ?? [];
                if (starredFolders.length === 0) {
                    return [{
                        icon: FolderOpen,
                        label: 'No starred folders',
                        action: () => {},
                    }];
                }
                return starredFolders.map((folder: string): HorizontalMenuItem => ({
                    icon: FolderOpen,
                    label: folder.split('/').pop() ?? folder,
                    action: async () => {
                        const result: { success: boolean; targetPath: string; error?: string } | undefined =
                            await window.electronAPI?.main.copyNodeToFolder(nodeId, folder);
                        if (result?.success) {
                            console.log(`Copied to ${result.targetPath}`);
                        } else {
                            console.error(`Copy failed: ${result?.error ?? 'Unknown error'}`);
                        }
                    },
                }));
            },
        },
        {
            icon: Clipboard,
            label: 'Copy Content',
            action: async () => {
                const graphNode: GraphNode = await getNodeFromMainToUI(nodeId);
                void navigator.clipboard.writeText(graphNode.contentWithoutYamlOrLinks);
            },
        },
    ];

    // Add non-default agents (skip first which is default, used by Run button)
    for (const agent of agents.slice(1)) {
        moreSubMenu.push({
            icon: Play,
            label: agent.name,
            color: '#6366f1', // indigo to distinguish from default Run
            action: async () => {
                await spawnTerminalWithNewContextNode(nodeId, cy, agent.command);
            },
            // Context nodes: show contained nodes. Normal nodes: preview what would be captured.
            onHoverEnter: isContextNode
                ? () => highlightContainedNodes(cy, nodeId)
                : () => highlightPreviewNodes(cy, nodeId),
            onHoverLeave: () => clearContainedHighlights(cy),
            // TODO: Re-enable slider for secondary agents once hover leniency is improved
            // (slider should stay open when navigating between button and slider, not just on direct hover)
            // sliderConfig,
        });
    }
    menuItems.push({
        icon: ChevronDown,
        label: 'More',
        action: () => {}, // No-op, submenu handles interaction
        subMenu: moreSubMenu,
    });

    return menuItems;
}

/**
 * Business logic for determining which menu items appear on a node.
 * Separated from DOM creation (menuItemDom.ts) for independent testability.
 */

import type { Core } from 'cytoscape';
import { Plus, Play, Trash2, AlertTriangle, Clipboard, ChevronDown, Edit2, GitBranch, FolderOpen, Check, Zap } from 'lucide';
import type { GraphNode } from "@vt/graph-model/graph";
import { createNewChildNodeFromUI, deleteNodesFromUI } from "@/shell/edge/UI-edge/graph/actions/handleUIActions";
import { getCurrentIndex } from '@/shell/UI/cytoscape-graph-ui/services/layout/spatialIndexSync';
import { formatShortcut } from '@vt/graph-model/utils';
import {
    spawnTerminalWithNewContextNode,
    spawnTerminalWithCommandEditor,
    spawnTerminalInNewWorktree,
} from "@/shell/edge/UI-edge/floating-windows/terminals/spawnTerminalWithCommandFromUI";
import { getFilePathForNode, getNodeFromMainToUI } from "@/shell/edge/UI-edge/graph/view/getNodeFromMainToUI";
import { fromNodeToContentWithWikilinks } from "@vt/graph-model/markdown";
import {
    WORKFLOW_INJECTION_WRITER_ID,
    writeMarkdownFileFromUI
} from "@/shell/edge/UI-edge/floating-windows/editors/writeMarkdownFileFromUI";
import { createAnchoredFloatingEditor } from "@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD";
import type { VTSettings, AgentConfig, ResolvedAgent } from "@vt/graph-model/settings";
import { resolveDefaultAgent, isAgentCategory, mapAgentTreeByCommand, flattenAgentTree, agentPathLabel } from "@vt/graph-model/settings";
import { AUTO_RUN_FLAG } from "@/shell/edge/UI-edge/graph/popups/agentCommandEditorPopup";
import { highlightContainedNodes, highlightPreviewNodes, clearContainedHighlights } from '@/shell/UI/cytoscape-graph-ui/highlightContextNodes';
import { getTerminals } from '@/shell/edge/UI-edge/state/stores/TerminalStore';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';
import type { WorktreeInfo } from '@vt/vt-daemon-protocol';
import type { WatchStatus } from '@/shell/hostApi';
import { showWorktreeDeleteConfirmation } from '@/shell/edge/UI-edge/graph/popups/worktreeDeletePopup';
import { hostCapabilities } from '@/shell/runtimeCapabilities';
import type { WorkflowTreeNode } from '@/shell/edge/main/workflows/workflowHandlers';
import type { SliderConfig, HorizontalMenuItem, NodeMenuItemsInput } from './horizontalMenuTypes';
import { squareToHops } from './DistanceSlider';
import { getShortcutPlatform } from '@/shell/UI/platform/shortcutPlatform';

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
        onDistanceChange: (newSquare: number): void => {
            void (async (): Promise<void> => {
                const currentSettings: VTSettings | null = await window.hostAPI?.main.loadSettings() ?? null;
                if (currentSettings && window.hostAPI) {
                    await window.hostAPI.main.saveSettings({...currentSettings, contextNodeMaxDistance: squareToHops(newSquare)});
                }
                clearContainedHighlights(cy);
                await highlightPreviewNodes(cy, nodeId);
            })();
        },
        menuElement,
    };
}

/**
 * Spawn an agent leaf identified by its stable path label, re-resolving from
 * FRESH settings at click time (so an edit between menu-open and click is
 * honoured) and delivering the leaf's composed env via envOverrides.
 */
async function spawnAgentByPath(nodeId: string, cy: Core, pathLabel: string): Promise<void> {
    const settings: VTSettings | null = await window.hostAPI?.main.loadSettings() ?? null;
    const leaf: ResolvedAgent | undefined = settings
        ? flattenAgentTree(settings.agents ?? []).find((candidate: ResolvedAgent) => agentPathLabel(candidate.path) === pathLabel)
        : undefined;
    if (!leaf?.command) {
        console.error(`[getNodeMenuItems] Agent "${pathLabel}" is no longer resolvable from settings.agents`);
        return;
    }
    if (Object.keys(leaf.env).length > 0) {
        await spawnTerminalWithNewContextNode(nodeId, cy, leaf.command, undefined, leaf.env);
    } else {
        await spawnTerminalWithNewContextNode(nodeId, cy, leaf.command);
    }
}

/**
 * Build the agent tree into a cascade of hover submenus (mirrors the Workflows
 * menu): a category node expands into its children; a leaf spawns the agent at
 * its path. `pathNames` accumulates the root->here labels so a leaf can be
 * re-resolved against fresh settings at click time.
 */
function buildAgentMenuItems(
    nodeId: string,
    cy: Core,
    isContextNode: boolean,
    agents: readonly AgentConfig[],
    pathNames: readonly string[],
): HorizontalMenuItem[] {
    return agents.map((node: AgentConfig): HorizontalMenuItem => {
        const here: readonly string[] = [...pathNames, node.name];
        if (isAgentCategory(node)) {
            return {
                icon: FolderOpen,
                label: node.name,
                color: '#6366f1',
                action: () => {}, // category: submenu handles interaction
                getSubMenuItems: async (): Promise<HorizontalMenuItem[]> =>
                    buildAgentMenuItems(nodeId, cy, isContextNode, node.children ?? [], here),
            };
        }
        return {
            icon: Play,
            label: node.name,
            color: '#6366f1', // indigo to distinguish from the default green Run
            action: async () => {
                await spawnAgentByPath(nodeId, cy, agentPathLabel(here));
            },
            onHoverEnter: isContextNode
                ? () => highlightContainedNodes(cy, nodeId)
                : () => highlightPreviewNodes(cy, nodeId),
            onHoverLeave: () => clearContainedHighlights(cy),
        };
    });
}

/**
 * Get menu items for a node - pure function that returns menu item definitions.
 * Extracted for reuse by floating window chrome.
 */
export function getNodeMenuItems(input: NodeMenuItemsInput): HorizontalMenuItem[] {
    const { nodeId, cy, agents, isContextNode, currentDistance, menuElement } = input;
    const menuItems: HorizontalMenuItem[] = [];
    const shortcutPlatform = getShortcutPlatform();

    // Create slider config for non-context nodes (context nodes don't need distance slider)
    // Only create if menuElement is provided (required for slider to be appended as child)
    const sliderConfig: SliderConfig | undefined = !isContextNode && currentDistance !== undefined && menuElement
        ? createRunButtonSliderConfig(cy, nodeId, currentDistance, menuElement)
        : undefined;

    // LEFT SIDE: Delete, Copy, Add (3 buttons)
    menuItems.push({
        icon: Trash2, label: 'Delete', hotkey: formatShortcut('Backspace', shortcutPlatform),
        action: () => deleteNodesFromUI([nodeId], cy),
    });
    menuItems.push({
        icon: Clipboard, label: 'Copy Path',
        action: () => { void navigator.clipboard.writeText(getFilePathForNode(nodeId)); },
    });
    menuItems.push({
        icon: Plus, label: 'Add Child', hotkey: formatShortcut('N', shortcutPlatform),
        action: () => { void createNewChildNodeFromUI(nodeId, cy, getCurrentIndex(cy)); },
    });

    // RIGHT SIDE: Run, More (2 buttons) + traffic light placeholders (Close, Pin, Fullscreen)
    menuItems.push({
        icon: Play,
        label: 'Run',
        color: '#22c55e', // green
        hotkey: formatShortcut('Enter', shortcutPlatform),
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
            const items: HorizontalMenuItem[] = [];

            // Git worktrees are an Electron-only capability; omit the
            // "New Worktree" entry and the existing-worktree list in browser mode.
            const canWorktree: boolean = hostCapabilities().worktrees;
            if (canWorktree) {
                items.push({ icon: GitBranch, label: 'New Worktree', action: () => { void spawnTerminalInNewWorktree(nodeId, cy); } });
            }

            // Fetch existing worktrees dynamically
            const watchStatus: WatchStatus | undefined = canWorktree
                ? await window.hostAPI?.main.getWatchStatus()
                : undefined;
            const repoRoot: string | undefined = watchStatus?.directory;
            if (repoRoot) {
                const worktrees: WorktreeInfo[] = await window.hostAPI?.main.listWorktrees(repoRoot) ?? [];
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
                                    await window.hostAPI?.main.removeWorktree(repoRoot, wt.path, false);
                                if (ipcResult?.success) return;

                                // Normal delete failed — offer force delete
                                const retry: { force: boolean } | null = await showWorktreeDeleteConfirmation(
                                    wt.name, wt.path, wt.branch,
                                    ipcResult?.error ?? 'Deletion failed',
                                );
                                if (!retry) return;
                                await window.hostAPI?.main.removeWorktree(repoRoot, wt.path, true);
                            },
                        },
                    });
                }
            }

            // Auto-run checkbox: only for claude commands, toggles --dangerously-skip-permissions
            const currentSettings: VTSettings | null = await window.hostAPI?.main.loadSettings() ?? null;
            const defaultAgent: ResolvedAgent | undefined = currentSettings ? resolveDefaultAgent(currentSettings.agents ?? [], currentSettings.defaultAgent) : undefined;
            const defaultCommand: string = defaultAgent?.command ?? '';
            if (defaultCommand.toLowerCase().includes('claude')) {
                items.push({
                    icon: Check, // placeholder icon, checkbox renders instead
                    label: 'Auto-run',
                    isCheckbox: true,
                    checked: defaultCommand.includes(AUTO_RUN_FLAG),
                    preventClose: true,
                    action: async () => {
                        const settings: VTSettings | null = await window.hostAPI?.main.loadSettings() ?? null;
                        if (!settings) return;
                        const currentAgents: readonly AgentConfig[] = settings.agents ?? [];
                        const defAgent: ResolvedAgent | undefined = resolveDefaultAgent(currentAgents, settings.defaultAgent);
                        if (!defAgent) return;
                        const cmd: string = defAgent.command;
                        const hasFlag: boolean = cmd.includes(AUTO_RUN_FLAG);

                        let newCommand: string;
                        if (hasFlag) {
                            newCommand = cmd.replace(new RegExp(`\\s*${AUTO_RUN_FLAG}\\s*`), ' ').trim();
                        } else {
                            newCommand = cmd.replace(/^(claude)\s*(.*)$/, `$1 ${AUTO_RUN_FLAG} $2`).trim();
                            if (!newCommand.includes(AUTO_RUN_FLAG)) {
                                newCommand = `${cmd} ${AUTO_RUN_FLAG}`;
                            }
                        }

                        // Rewrite whichever tree node defines that command (any depth).
                        const updatedAgents: readonly AgentConfig[] = mapAgentTreeByCommand(currentAgents, cmd, newCommand);
                        await window.hostAPI?.main.saveSettings({ ...settings, agents: updatedAgents });
                    },
                });
            }

            items.push({ icon: Edit2, label: 'Edit Command', action: () => spawnTerminalWithCommandEditor(nodeId, cy) });
            return items;
        },
    });

    // Expandable "more" menu with Workflows, Copy to Starred, Copy Content, and additional agents
    const moreSubMenu: HorizontalMenuItem[] = [
        {
            icon: Zap,
            label: 'Workflows',
            color: '#f59e0b', // amber
            action: () => {},
            getSubMenuItems: async (): Promise<HorizontalMenuItem[]> => {
                const workflows: WorkflowTreeNode[] | undefined =
                    await window.hostAPI?.main.listWorkflows();
                if (!workflows?.length) {
                    return [{ icon: Zap, label: 'No workflows found', action: () => {} }];
                }
                function buildItems(nodes: WorkflowTreeNode[]): HorizontalMenuItem[] {
                    return nodes.map((wf): HorizontalMenuItem => {
                        const hasChildren: boolean = wf.children.length > 0;
                        const isActionable: boolean = wf.hasSkillFile;
                        return {
                            icon: isActionable ? Zap : FolderOpen,
                            label: (!isActionable && !hasChildren) ? `${wf.name}  ⚠ missing SKILL.md` : wf.name,
                            color: (!isActionable && !hasChildren) ? '#ef4444' : undefined,
                            action: isActionable ? async (): Promise<void> => {
                                const content: string | undefined = await window.hostAPI?.main.readSkillFileSummary(wf.path);
                                if (!content) { console.warn('[workflow-inject] readSkillFileSummary returned empty for', wf.path); return; }
                                console.log('[workflow-inject] SKILL summary length:', content.length);
                                const currentNode: GraphNode = await getNodeFromMainToUI(nodeId);
                                const existing: string = fromNodeToContentWithWikilinks(currentNode);
                                const appended: string = existing ? `${existing}\n\n${content}` : content;
                                console.log('[workflow-inject] appended content length:', appended.length);
                                await createAnchoredFloatingEditor(cy, nodeId, false);
                                await writeMarkdownFileFromUI(nodeId, appended, WORKFLOW_INJECTION_WRITER_ID);
                            } : () => {},
                            ...(hasChildren ? {
                                getSubMenuItems: async (): Promise<HorizontalMenuItem[]> => buildItems(wf.children),
                            } : {}),
                        };
                    });
                }
                return buildItems(workflows);
            },
        },
        {
            icon: FolderOpen,
            label: 'Copy to...',
            action: () => {}, // No-op, submenu handles interaction
            getSubMenuItems: async (): Promise<HorizontalMenuItem[]> => {
                const starredFolders: readonly string[] = await window.hostAPI?.main.getStarredFolders() ?? [];
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
                            await window.hostAPI?.main.copyNodeToFolder(nodeId, folder);
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

    // The full agent tree as a cascading submenu: hover a model (Codex) -> its
    // categories (Local/Remote) -> the leaf (Medium/XHigh) that spawns it. The
    // Run button still quick-launches the default leaf.
    moreSubMenu.push(...buildAgentMenuItems(nodeId, cy, isContextNode, agents, []));
    menuItems.push({
        icon: ChevronDown,
        label: 'More',
        action: () => {}, // No-op, submenu handles interaction
        subMenu: moreSubMenu,
    });

    return menuItems;
}

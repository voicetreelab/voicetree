/** Terminal Flow - V2: Uses types.ts with flat TerminalData type. IDs derived, ui populated after DOM creation. */
import type { NodeIdAndFilePath, Position, GraphNode } from "@/pure/graph";
import type { VTSettings, AgentConfig } from "@/pure/settings";
import { deleteNodesFromUI } from "@/shell/edge/UI-edge/graph/handleUIActions";
import { showAgentCommandEditor } from "@/shell/edge/UI-edge/graph/agentCommandEditorPopup";
import type { Core, NodeCollection, CollectionReturnValue } from "cytoscape";
import '@/shell/electron.d.ts';
import { disposeFloatingWindow, getOrCreateOverlay, registerFloatingWindow } from "@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows";
import { TerminalVanilla } from "@/shell/UI/floating-windows/terminals/TerminalVanilla";
import posthog from "posthog-js";
import { getTerminalId, type TerminalId, type FloatingWindowUIData } from "@/shell/edge/UI-edge/floating-windows/types";
import { vanillaFloatingWindowInstances } from "@/shell/edge/UI-edge/state/UIAppState";
import { getNextTerminalCount, getTerminals } from "@/shell/edge/UI-edge/state/TerminalStore";
import { createWindowChrome } from "@/shell/edge/UI-edge/floating-windows/create-window-chrome";
import { flushEditorForNode } from "@/shell/edge/UI-edge/floating-windows/editors/flushEditorForNode";
import { anchorToNode } from "@/shell/edge/UI-edge/floating-windows/anchor-to-node";
import { getNodeFromMainToUI } from "@/shell/edge/UI-edge/graph/getNodeFromMainToUI";
import { getNodeTitle } from "@/pure/graph/markdown-parsing";
import * as O from "fp-ts/lib/Option.js";
import type { TerminalData } from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";

const MAX_TERMINALS: number = 12;

/**
 * Wait for a node to appear in Cytoscape, polling until found or timeout
 * Used to handle IPC race condition where terminal launch arrives before graph delta
 */
async function waitForNode(
    cy: Core,
    nodeId: string,
    timeoutMs: number = 1000
): Promise<CollectionReturnValue | null> {
    const pollIntervalMs: number = 100;
    const maxAttempts: number = Math.ceil(timeoutMs / pollIntervalMs);

    for (let attempt: number = 0; attempt < maxAttempts; attempt++) {
        const node: CollectionReturnValue = cy.getElementById(nodeId);
        if (node.length > 0) {
            if (attempt > 0) {
                //console.log(`[waitForNode] Node ${nodeId} appeared after ${attempt * pollIntervalMs}ms`);
            }
            return node;
        }
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    console.warn(`[waitForNode] Node ${nodeId} did not appear within ${timeoutMs}ms`);
    return null;
}

interface AgentLaunchConfig {
    finalCommand: string;
    popupWasShown: boolean;
    updatedAgents: readonly AgentConfig[];
    updatedAgentPrompt: string;
    mcpIntegrationEnabled: boolean;
    useDocker: boolean;
}

/** Shows first-run popup if needed. Returns resolved agent launch configuration. */
async function resolveAgentLaunchConfig(
    settings: VTSettings,
    command: string
): Promise<AgentLaunchConfig> {
    // Get current agent prompt from settings
    const currentAgentPrompt: string = typeof settings.INJECT_ENV_VARS.AGENT_PROMPT === 'string'
        ? settings.INJECT_ENV_VARS.AGENT_PROMPT
        : '';

    // Only prompt for Claude agent and only if not already chosen
    const isClaudeAgent: boolean = command.toLowerCase().includes('claude');
    if (settings.agentPermissionModeChosen || !isClaudeAgent) {
        return {
            finalCommand: command, popupWasShown: false, updatedAgents: settings.agents,
            updatedAgentPrompt: currentAgentPrompt, mcpIntegrationEnabled: true, useDocker: false,
        };
    }

    // Show the agent command editor popup with both command and agent prompt
    const result: ReturnType<typeof showAgentCommandEditor> extends Promise<infer T> ? T : never = await showAgentCommandEditor(command, currentAgentPrompt);

    // User cancelled - return original values but mark as chosen to not prompt again
    if (result === null) {
        return {
            finalCommand: command, popupWasShown: true, updatedAgents: settings.agents,
            updatedAgentPrompt: currentAgentPrompt, mcpIntegrationEnabled: true, useDocker: false,
        };
    }

    // Check if user modified the command
    const commandChanged: boolean = result.command !== command;

    // Update the agent's command in settings if it was modified
    let updatedAgents: readonly AgentConfig[] = settings.agents;
    if (commandChanged) {
        updatedAgents = settings.agents.map((agent: AgentConfig): AgentConfig => {
            // Update the agent whose command matches the original command
            if (agent.command === command) {
                return {
                    ...agent,
                    command: result.command,
                };
            }
            return agent;
        });
    }

    return {
        finalCommand: result.command, popupWasShown: true, updatedAgents,
        updatedAgentPrompt: result.agentPrompt, mcpIntegrationEnabled: result.mcpIntegrationEnabled,
        useDocker: result.useDocker,
    };
}

/**
 * Spawn a terminal after showing the command editor popup.
 * Always shows the popup regardless of agentPermissionModeChosen setting.
 * Used when user explicitly requests to edit command before running.
 *
 * @param parentNodeId - The parent node to create context for
 * @param cy - Cytoscape instance (used to flush pending editor content)
 * @param agentCommand - Optional agent command. If not provided, uses the default (first) agent from settings.
 */
export async function spawnTerminalWithCommandEditor(
    parentNodeId: NodeIdAndFilePath,
    cy: Core,
    agentCommand?: string,
): Promise<void> {
    // Flush any pending editor content for this node before creating context
    await flushEditorForNode(parentNodeId, cy);

    const terminalsMap: Map<TerminalId, TerminalData> = getTerminals();

    // Check terminal limit
    if (terminalsMap.size >= MAX_TERMINALS) {
        alert(`Glad you are trying to power use VT! Limit of ${MAX_TERMINALS} agents at once for now but send over an email 1manumasson@gmail.com if you want to alpha-test higher limits`);
        return;
    }

    // Load settings to get agents and agent prompt
    const settings: VTSettings = await window.electronAPI?.main.loadSettings() as VTSettings;
    if (!settings) {
        console.error('[spawnTerminalWithCommandEditor] Failed to load settings');
        return;
    }

    // Determine the command to use
    const agents: readonly AgentConfig[] = settings.agents ?? [];
    const command: string = agentCommand ?? agents[0]?.command ?? '';
    if (!command) {
        console.error('[spawnTerminalWithCommandEditor] No agent command available');
        return;
    }

    // Get current agent prompt from settings
    const currentAgentPrompt: string = typeof settings.INJECT_ENV_VARS.AGENT_PROMPT === 'string'
        ? settings.INJECT_ENV_VARS.AGENT_PROMPT
        : '';

    // Always show the popup (user explicitly requested edit)
    const result: { command: string; agentPrompt: string; mcpIntegrationEnabled: boolean; useDocker: boolean } | null = await showAgentCommandEditor(command, currentAgentPrompt);

    // User cancelled
    if (result === null) {
        return;
    }

    // Check if user modified the command
    const commandChanged: boolean = result.command !== command;

    // Update the agent's command in settings if it was modified
    let updatedAgents: readonly AgentConfig[] = settings.agents;
    if (commandChanged) {
        updatedAgents = settings.agents.map((agent: AgentConfig): AgentConfig => {
            // Update the agent whose command matches the original command
            if (agent.command === command) {
                return {
                    ...agent,
                    command: result.command,
                };
            }
            return agent;
        });
    }

    // Save settings if agent prompt changed or command was modified
    const promptChanged: boolean = result.agentPrompt !== currentAgentPrompt;
    if (promptChanged || commandChanged) {
        const updatedSettings: VTSettings = {
            ...settings,
            agents: updatedAgents,
            agentPermissionModeChosen: true,
            INJECT_ENV_VARS: {
                ...settings.INJECT_ENV_VARS,
                AGENT_PROMPT: result.agentPrompt,
            },
        };
        await window.electronAPI?.main.saveSettings(updatedSettings);
    }

    // Update .mcp.json based on user's MCP integration toggle choice
    await window.electronAPI?.main.setMcpIntegration(result.mcpIntegrationEnabled);

    const terminalCount: number = getNextTerminalCount(terminalsMap, parentNodeId);

    // Spawn terminal with the (possibly modified) command
    await window.electronAPI?.main.spawnTerminalWithContextNode(
        parentNodeId,
        result.command,
        terminalCount
    );
}

/**
 * Spawn a terminal with a new context node
 *
 * This function now simply delegates to the main process, which orchestrates
 * the entire flow without needing setTimeout hacks. The main process has
 * immediate access to the graph after createContextNode completes.
 *
 * @param parentNodeId - The parent node to create context for
 * @param cy - Cytoscape instance (used to flush pending editor content)
 * @param agentCommand - Optional agent command. If not provided, uses the default (first) agent from settings.
 */
export async function spawnTerminalWithNewContextNode(
    parentNodeId: NodeIdAndFilePath,
    cy: Core,
    agentCommand?: string,
    spawnDirectory?: string,
): Promise<void> {
    // Flush any pending editor content for this node before creating context
    // This ensures the context node has the latest typed content (bypasses 300ms debounce)
    await flushEditorForNode(parentNodeId, cy)

    const terminalsMap: Map<TerminalId, TerminalData> = getTerminals();

    // Check terminal limit
    if (terminalsMap.size >= MAX_TERMINALS) {
        alert(`Glad you are trying to power use VT! Limit of ${MAX_TERMINALS} agents at once for now but send over an email 1manumasson@gmail.com if you want to alpha-test higher limits`);
        return;
    }

    // Load settings to get agents and check permission mode
    const settings: VTSettings = await window.electronAPI?.main.loadSettings() as VTSettings;
    if (!settings) {
        console.error('[spawnTerminalWithNewContextNode] Failed to load settings');
        return;
    }

    // Determine the command to use
    const agents: readonly AgentConfig[] = settings.agents ?? [];
    let command: string = agentCommand ?? agents[0]?.command ?? '';
    if (!command) {
        console.error('[spawnTerminalWithNewContextNode] No agent command available');
        return;
    }

    // Show first-run popup if needed, get resolved launch config
    const launchConfig: AgentLaunchConfig = await resolveAgentLaunchConfig(settings, command);

    command = launchConfig.finalCommand;

    // Save settings if permission mode was just chosen
    if (launchConfig.popupWasShown) {
        const updatedSettings: VTSettings = {
            ...settings,
            agents: launchConfig.updatedAgents,
            agentPermissionModeChosen: true,
            INJECT_ENV_VARS: {
                ...settings.INJECT_ENV_VARS,
                AGENT_PROMPT: launchConfig.updatedAgentPrompt,
            },
        };
        await window.electronAPI?.main.saveSettings(updatedSettings);
    }

    // Update .mcp.json based on user's MCP integration toggle choice
    await window.electronAPI?.main.setMcpIntegration(launchConfig.mcpIntegrationEnabled);

    const terminalCount: number = getNextTerminalCount(terminalsMap, parentNodeId);

    // Delegate to main process which has immediate graph access
    await window.electronAPI?.main.spawnTerminalWithContextNode(
        parentNodeId, command, terminalCount, undefined, undefined, undefined, spawnDirectory
    );
}

/**
 * Spawn a terminal in a new git worktree.
 * Creates a worktree named after the node title, then spawns an agent in it.
 */
export async function spawnTerminalInNewWorktree(
    parentNodeId: NodeIdAndFilePath,
    cy: Core,
): Promise<void> {
    // Get node title for worktree name
    const node: GraphNode = await getNodeFromMainToUI(parentNodeId);
    const nodeTitle: string = getNodeTitle(node);

    // Get repo root from watch status
    const watchStatus = await window.electronAPI?.main.getWatchStatus();
    const repoRoot: string | undefined = watchStatus?.directory;
    if (!repoRoot) {
        console.error('[spawnTerminalInNewWorktree] No watched directory available');
        return;
    }

    // Create worktree: generate name from title, then create git worktree
    const worktreeName: string = await window.electronAPI?.main.generateWorktreeName(nodeTitle) as string;
    const worktreePath: string = await window.electronAPI?.main.createWorktree(repoRoot, worktreeName) as string;

    // Delegate to existing spawn function with worktree as spawnDirectory
    return spawnTerminalWithNewContextNode(parentNodeId, cy, undefined, worktreePath);
}

/**
 * Spawn a plain terminal attached to a node (no agent command, no context node)
 *
 * Opens a regular shell terminal anchored to the specified node, useful for
 * manual terminal work without agent automation.
 */
export async function spawnPlainTerminal(
    nodeId: NodeIdAndFilePath,
    _cy: Core,
): Promise<void> {
    const terminalsMap: Map<TerminalId, TerminalData> = getTerminals();

    // Check terminal limit
    if (terminalsMap.size >= MAX_TERMINALS) {
        alert(`Glad you are trying to power use VT! Limit of ${MAX_TERMINALS} agents at once for now but send over an email 1manumasson@gmail.com if you want to alpha-test higher limits`);
        return;
    }

    const terminalCount: number = getNextTerminalCount(terminalsMap, nodeId);

    // Delegate to main process
    await window.electronAPI?.main.spawnPlainTerminal(nodeId, terminalCount);
}

/**
 * Create a floating terminal window
 * Returns TerminalData with ui populated, or undefined if terminal already exists
 */
export async function createFloatingTerminal(
    cy: Core,
    nodeId: string,
    terminalData: TerminalData,
    _nodePos: Position
): Promise<TerminalData | undefined> {
    const terminalId: TerminalId = getTerminalId(terminalData);
    //console.log('[FloatingWindowManager-v2] Creating floating terminal:', terminalId);

    // Check if already exists (use cy.$id to avoid CSS selector escaping issues with / in IDs)
    const existing: NodeCollection = cy.$id(terminalId) as NodeCollection;
    if (existing && existing.length > 0) {
        //console.log('[FloatingWindowManager-v2] Terminal already exists');
        return undefined;
    }

    // Wait for parent node to appear (handles IPC race condition where terminal launch
    // arrives before graph delta is processed)
    await waitForNode(cy, nodeId, 1000);

    try {
        // Create floating terminal window (returns TerminalData with ui populated)
        const terminalWithUI: TerminalData = createFloatingTerminalWindow(cy, terminalData);

        // Anchor to parent node if it exists (creates shadow node in cytoscape graph)
        //console.log('[FloatingWindowManager-v2] anchoredToNodeId:', JSON.stringify(terminalWithUI.anchoredToNodeId));
        //console.log('[FloatingWindowManager-v2] O.isSome check:', O.isSome(terminalWithUI.anchoredToNodeId));
        if (terminalWithUI.ui && O.isSome(terminalWithUI.anchoredToNodeId)) {
            anchorToNode(cy, terminalWithUI);
            // Mark the parent node as having a running terminal (changes shape to square)
            const parentNodeId: string = terminalWithUI.anchoredToNodeId.value;
            //console.log('[FloatingWindowManager-v2] Looking for parent node:', parentNodeId);
            const parentNode: CollectionReturnValue = cy.getElementById(parentNodeId);
            //console.log('[FloatingWindowManager-v2] Parent node found:', parentNode.length > 0);
            if (parentNode.length > 0) {
                parentNode.data('hasRunningTerminal', true);
                //console.log('[FloatingWindowManager-v2] Marked parent node as task node:', parentNodeId);
            } else {
                //console.log('[FloatingWindowManager-v2] Parent node NOT found in Cytoscape!');
            }
        } else if (terminalWithUI.ui) {
            // Fallback: position at a default location if no parent node
            // (rare case - terminals usually have a parent context node)
            terminalWithUI.ui.windowElement.style.left = '100px';
            terminalWithUI.ui.windowElement.style.top = '100px';
        }

        return terminalWithUI;
    } catch (error) {
        console.error('[FloatingWindowManager-v2] Error creating floating terminal:', error);
        return undefined;
    }
}

/**
 * Create a floating terminal window (no anchoring)
 * Returns TerminalData with ui populated
 */
export function createFloatingTerminalWindow(
    cy: Core,
    terminalData: TerminalData
): TerminalData {
    const terminalId: TerminalId = getTerminalId(terminalData);

    // Get overlay
    const overlay: HTMLElement = getOrCreateOverlay(cy);

    // Create window chrome using the new v2 function
    const ui: FloatingWindowUIData = createWindowChrome(cy, terminalData, terminalId);

    // Create TerminalData with ui populated (immutable)
    const terminalWithUI: TerminalData = { ...terminalData, ui };

    // Create Terminal instance
    const terminal: TerminalVanilla = new TerminalVanilla({
        container: ui.contentContainer,
        terminalData: terminalData
    });

    // Store for cleanup (legacy pattern - will be removed in future)
    vanillaFloatingWindowInstances.set(terminalId, terminal);

    // Analytics: Track terminal opened
    posthog.capture('terminal_opened', { terminalId: terminalId });

    // Handle traffic light close button click
    ui.windowElement.addEventListener('traffic-light-close', (): void => {
        void closeTerminal(terminalWithUI, cy);
    });

    // Add to overlay and register for efficient zoom/pan sync
    overlay.appendChild(ui.windowElement);
    registerFloatingWindow(terminalId, ui.windowElement);

    return terminalWithUI;
}

/**
 * Close a terminal and clean up all resources
 */
export async function closeTerminal(terminal: TerminalData, cy: Core): Promise<void> {
    const terminalId: TerminalId = getTerminalId(terminal);

    // DEBUG: Log UI state to diagnose floating window shell bug
    // Issue: cmd-w sometimes leaves empty window frame after closing terminal
    if (!terminal.ui) {
        console.error('[closeTerminal] BUG: terminal.ui is undefined!', {
            terminalId,
            attachedToNodeId: terminal.attachedToNodeId,
        });
    }

    // Phase 3: Notify main process to remove from registry
    // This ensures main stays in sync when terminal is closed from UI
    void window.electronAPI?.main.removeTerminalFromRegistry(terminalId);

    // Analytics: Track terminal closed
    posthog.capture('terminal_closed', { terminalId: terminalId });

    // Dispose vanilla instance
    const vanillaInstance: { dispose: () => void; } | undefined = vanillaFloatingWindowInstances.get(terminalId);
    if (vanillaInstance) {
        vanillaInstance.dispose();
        vanillaFloatingWindowInstances.delete(terminalId);
    }

    // Use disposeFloatingWindow from cytoscape-floating-windows.ts
    // This removes shadow node, DOM elements, and from state (local removal for immediate UI consistency)
    disposeFloatingWindow(cy, terminal);

    // Remove hasRunningTerminal flag from parent node if no other terminals are anchored to it
    if (O.isSome(terminal.anchoredToNodeId)) {
        const parentNodeId: string = terminal.anchoredToNodeId.value;
        // Check if other terminals are still anchored to the same parent (current terminal already removed)
        const terminals: Map<TerminalId, TerminalData> = getTerminals();
        const remainingTerminalsOnParent: TerminalData[] = Array.from(terminals.values())
            .filter((t: TerminalData) =>
                O.isSome(t.anchoredToNodeId) && t.anchoredToNodeId.value === parentNodeId
            );

        if (remainingTerminalsOnParent.length === 0) {
            const parentNode: CollectionReturnValue = cy.getElementById(parentNodeId);
            if (parentNode.length > 0) {
                parentNode.data('hasRunningTerminal', false);
                //console.log('[closeTerminal-v2] Removed task node indicator from:', parentNodeId);
            }
        }
    }

    // Delete the context node if this was the last terminal attached to it
    await deleteContextNodeIfLastTerminal(terminal.attachedToNodeId, cy);
}

/**
 * Delete the context node if:
 * 1. It exists in the graph
 * 2. It has isContextNode: true
 * 3. No other terminals are still attached to it
 *
 * Uses deleteNodesFromUI which handles transitive edge preservation.
 */
async function deleteContextNodeIfLastTerminal(nodeId: NodeIdAndFilePath, cy: Core): Promise<void> {
    try {
        const node: GraphNode | undefined = await window.electronAPI?.main.getNode(nodeId);
        if (!node) return;

        // Only delete if it's a context node
        if (!node.nodeUIMetadata.isContextNode) return;

        // Check if other terminals are still attached (current terminal already removed from store)
        const terminals: Map<TerminalId, TerminalData> = getTerminals();
        const remainingTerminals: TerminalData[] = Array.from(terminals.values())
            .filter((t: TerminalData) => t.attachedToNodeId === nodeId);

        if (remainingTerminals.length > 0) {
            //console.log('[closeTerminal] Other terminals still attached, not deleting context node:', nodeId);
            return;
        }

        // Use the canonical delete path with transitive edge preservation
        await deleteNodesFromUI([nodeId], cy);
        //console.log('[closeTerminal] Deleted context node:', nodeId);
    } catch (error) {
        console.error('[closeTerminal] Failed to delete context node:', error);
    }
}

/**
 * Close all terminals and clean up their UI resources.
 * Used when switching folders - does not delete context nodes since the graph is being cleared.
 */
export function closeAllTerminals(cy: Core): void {
    //console.log('[closeAllTerminals] Closing all terminals');
    const terminals: Map<TerminalId, TerminalData> = getTerminals();

    for (const terminal of terminals.values()) {
        const terminalId: TerminalId = getTerminalId(terminal);

        // Dispose vanilla instance
        const vanillaInstance: { dispose: () => void; } | undefined = vanillaFloatingWindowInstances.get(terminalId);
        if (vanillaInstance) {
            vanillaInstance.dispose();
            vanillaFloatingWindowInstances.delete(terminalId);
        }

        // Dispose floating window (removes shadow node, DOM elements)
        disposeFloatingWindow(cy, terminal);
    }

    // Clear the terminal store - import clearTerminals
    // Note: disposeFloatingWindow already removes from store, but clear to be safe
}

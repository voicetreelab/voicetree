/**
 * Terminal Flow - V2
 *
 * Rewritten to use types-v2.ts with flat TerminalData type.
 * - IDs are derived, not stored
 * - ui field is populated after DOM creation
 * - No stored callbacks - use disposeFloatingWindow()
 */

import type { GraphNode, NodeIdAndFilePath, Position } from "@/pure/graph";
import type { Core, CollectionReturnValue, NodeCollection, Position as CyPosition } from "cytoscape";
import * as O from 'fp-ts/lib/Option.js';
import {
    createWindowChrome,
    anchorToNode,
    disposeFloatingWindow,
    getOrCreateOverlay,
} from "@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows-v2";
import { TerminalVanilla } from "@/shell/UI/floating-windows/terminals/TerminalVanilla";
import posthog from "posthog-js";
import {
    createTerminalData,
    getTerminalId,
    type TerminalData,
    type TerminalId,
    type FloatingWindowUIData, type FloatingWindowFields,
} from "@/shell/edge/UI-edge/floating-windows/types-v2";
import {
    addTerminal,
    getNextTerminalCount,
    getTerminals,
    vanillaFloatingWindowInstances,
} from "@/shell/edge/UI-edge/state/UIAppState";
import { getFilePathForNode, getNodeFromMainToUI } from "@/shell/edge/UI-edge/graph/getNodeFromMainToUI";
import { getNodeTitle } from "@/pure/graph/markdown-parsing";
import type { VTSettings } from "@/pure/settings";


async function launchTerminalOntoUI(cy: cytoscape.Core, contextNodeId: string, terminalData: FloatingWindowFields & {
    readonly type: "Terminal";
    readonly attachedToNodeId: NodeIdAndFilePath;
    readonly terminalCount: number;
    readonly initialEnvVars?: Record<string, string>;
    readonly initialSpawnDirectory?: string;
    readonly initialCommand?: string;
    readonly executeCommand?: boolean
}) : Promise<void> {
    const targetNode: CollectionReturnValue = cy.getElementById(contextNodeId);

    const nodePos: CyPosition = targetNode.position();
    const terminalId: TerminalId = getTerminalId(terminalData);
    console.log("spawn terminal: " + terminalId);
    const terminalWithUI: TerminalData | undefined = await createFloatingTerminal(cy, contextNodeId, terminalData, nodePos);
    console.log("spawned terminal: " + terminalId);

    // Store terminal in state (with ui populated)
    if (terminalWithUI) {
        addTerminal(terminalWithUI);
    }
}

async function prepareTerminalData(parentNode: GraphNode, contextNodeId: string, terminalsMap: Map<TerminalId, TerminalData>, settings: VTSettings, command: string) : Promise<TerminalData> {
    const contextNode: GraphNode = parentNode.nodeUIMetadata.isContextNode
        ? parentNode
        : await getNodeFromMainToUI(contextNodeId);
    const contextContent: string = contextNode.contentWithoutYamlOrLinks;

    // Get next terminal count for the context node
    const terminalCount: number = getNextTerminalCount(terminalsMap, contextNodeId);

    // Get context node title for the terminal window
    const title: string = getNodeTitle(contextNode);

    // Compute initial_spawn_directory from watch directory + relative path setting
    let initialSpawnDirectory: string | undefined;
    const watchStatus: {
        readonly isWatching: boolean;
        readonly directory: string | undefined;
    } = await window.electronAPI?.main.getWatchStatus();
    if (watchStatus?.directory && settings.terminalSpawnPathRelativeToWatchedDirectory) {
        // Simple path join: remove trailing slash from directory, remove leading ./ from relative path
        const baseDir: string = watchStatus.directory.replace(/\/$/, '');
        const relativePath: string = settings.terminalSpawnPathRelativeToWatchedDirectory.replace(/^\.\//, '');
        initialSpawnDirectory = `${baseDir}/${relativePath}`;
    }

    // Get app support path for VOICETREE_APP_SUPPORT env var
    const appSupportPath: string = await window.electronAPI?.main.getAppSupportPath();

    // Create TerminalData using the factory function (flat type, no nested floatingWindow)
    const terminalData: TerminalData = createTerminalData({
        attachedToNodeId: contextNodeId,
        terminalCount: terminalCount,
        title: title,
        anchoredToNodeId: contextNodeId, // Will be wrapped in O.some by factory
        initialCommand: command,
        executeCommand: true,
        initialSpawnDirectory: initialSpawnDirectory,
        initialEnvVars: {
            VOICETREE_APP_SUPPORT: appSupportPath ?? '',
            CONTEXT_NODE_PATH: await getFilePathForNode(contextNodeId) ?? contextNodeId,
            CONTEXT_NODE_CONTENT: contextContent,
        },
    });
    return terminalData;
}

/**
 * Spawn a terminal with a new context node
 * Creates a context node for the parent, then spawns a terminal attached to that context node
 * with the context node content as an environment variable (initial_content)
 *
 * If the parent node is already a context node, reuses it instead of creating a new one.
 *
 * @param parentNodeId - The parent node to create context for
 * @param cy - Cytoscape instance
 * @param agentCommand - Optional agent command. If not provided, uses the default (first) agent from settings.
 */
export async function spawnTerminalWithNewContextNode(
    parentNodeId: NodeIdAndFilePath,
    cy: Core,
    agentCommand?: string,
): Promise<void> {
    const terminalsMap: Map<TerminalId, TerminalData> = getTerminals();

    // Load settings to get agents
    const settings: VTSettings = await window.electronAPI.main.loadSettings();
    if (!settings) {
        throw Error(`Failed to load settings for ${parentNodeId}`);
    }

    // Use provided command or default to first agent
    const agents: readonly { readonly name: string; readonly command: string }[] = settings.agents ?? [];
    const command: string = agentCommand ?? agents[0]?.command ?? '';
    if (!command) {
        throw Error('No agent command available - settings.agents is empty or undefined');
    }

    // Check if the parent node is already a context node - if so, reuse it
    const parentNode: GraphNode = await getNodeFromMainToUI(parentNodeId);
    if (!parentNode) {
        throw Error(`Node ${parentNodeId} not found in graph`);
    }
    let contextNodeId: NodeIdAndFilePath;

    if (parentNode.nodeUIMetadata.isContextNode) {
        // Reuse existing context node
        contextNodeId = parentNodeId;
    } else {
        // Create context node for the parent
        const createdContextNodeId: string = await window.electronAPI?.main.createContextNode(parentNodeId);
        if (!createdContextNodeId) {
            throw Error(`Failed to create contextNodeId ${createdContextNodeId}`);
        }
        contextNodeId = createdContextNodeId;
    }

    // Get the context node to read its content
    // Position the terminal near the context node
    setTimeout(() => {
        void (async () => {
            const terminalData : TerminalData = await prepareTerminalData(parentNode, contextNodeId, terminalsMap, settings, command);
            await launchTerminalOntoUI(cy, contextNodeId, terminalData);
        })();
    }, 1000); // todo remove this hack, need to actually notify on ready? push all into main?
    // will need to contextNode is ready....
}

/**
 * Create a floating terminal window
 * Returns TerminalData with ui populated, or undefined if terminal already exists
 */
export async function createFloatingTerminal(
    cy: Core,
    nodeId: string,
    terminalData: TerminalData,
    nodePos: Position
): Promise<TerminalData | undefined> {
    const terminalId: TerminalId = getTerminalId(terminalData);
    console.log('[FloatingWindowManager-v2] Creating floating terminal:', terminalId);

    // Check if already exists
    const existing: NodeCollection = cy.nodes(`#${terminalId}`);
    if (existing && existing.length > 0) {
        console.log('[FloatingWindowManager-v2] Terminal already exists');
        return undefined;
    }

    // Check if parent node exists
    const parentNode: CollectionReturnValue = cy.getElementById(nodeId);
    const parentNodeExists: boolean = parentNode.length > 0;

    try {
        // Create floating terminal window (returns TerminalData with ui populated)
        const terminalWithUI: TerminalData = createFloatingTerminalWindow(cy, terminalData);

        if (parentNodeExists && O.isSome(terminalWithUI.anchoredToNodeId)) {
            // Anchor to parent node
            anchorToNode(cy, terminalWithUI);
        } else if (terminalWithUI.ui) {
            // Manual positioning if no parent or not anchored
            terminalWithUI.ui.windowElement.style.left = `${nodePos.x + 100}px`;
            terminalWithUI.ui.windowElement.style.top = `${nodePos.y}px`;
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

    // Attach close button handler
    const closeButton: HTMLButtonElement | null = ui.titleBar.querySelector('.cy-floating-window-close');
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            closeTerminal(terminalWithUI, cy);
        });
    }

    // Add to overlay
    overlay.appendChild(ui.windowElement);

    return terminalWithUI;
}

/**
 * Close a terminal and clean up all resources
 */
export function closeTerminal(terminal: TerminalData, cy: Core): void {
    const terminalId: TerminalId = getTerminalId(terminal);
    console.log('[closeTerminal-v2] Closing terminal:', terminalId);

    // Analytics: Track terminal closed
    posthog.capture('terminal_closed', { terminalId: terminalId });

    // Dispose vanilla instance
    const vanillaInstance: { dispose: () => void; } | undefined = vanillaFloatingWindowInstances.get(terminalId);
    if (vanillaInstance) {
        vanillaInstance.dispose();
        vanillaFloatingWindowInstances.delete(terminalId);
    }

    // Use disposeFloatingWindow from cytoscape-floating-windows-v2.ts
    // This removes shadow node, DOM elements, and from state
    disposeFloatingWindow(cy, terminal);
}

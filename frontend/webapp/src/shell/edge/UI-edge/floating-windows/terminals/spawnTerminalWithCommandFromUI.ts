import type {} from '@/shell/electron';
import type {GraphNode, NodeIdAndFilePath, Position} from "@/pure/graph";
import type {Core, CollectionReturnValue, NodeCollection, Position as CyPosition} from "cytoscape";
import {
    anchorToNode,
    createWindowChrome,
    getOrCreateOverlay
} from "@/shell/UI/floating-windows/cytoscape-floating-windows";
import {TerminalVanilla} from "@/shell/UI/floating-windows/terminals/TerminalVanilla";
import posthog from "posthog-js";
import type {FloatingWindowUIHTMLData, TerminalData} from "@/shell/edge/UI-edge/floating-windows/types";
import {getTerminalId} from "@/shell/edge/UI-edge/floating-windows/types";
import {
    addTerminalToMapState,
    getNextTerminalCount,
    getTerminals,
    removeTerminalFromMapState,
    vanillaFloatingWindowInstances
} from "@/shell/edge/UI-edge/state/UIAppState";
import {getFilePathForNode, getNodeFromMainToUI} from "@/shell/edge/UI-edge/graph/getNodeFromMainToUI";
import {getNodeTitle} from "@/pure/graph/markdown-parsing";
import type {VTSettings} from "@/pure/settings";


/**
 * Spawn a terminal with a new context node
 * Creates a context node for the parent, then spawns a terminal attached to that context node
 * with the context node content as an environment variable (initial_content)
 *
 * If the parent node is already a context node, reuses it instead of creating a new one.
 *
 * @param parentNodeId - The parent node to create context for
 * @param cy - Cytoscape instance
 */
export async function spawnTerminalWithNewContextNode(
    parentNodeId: NodeIdAndFilePath,
    cy: Core,
): Promise<void> {
    const terminals: Map<string, TerminalData> = getTerminals();

    // Load settings to get the agentCommand
    const settings : VTSettings = await window.electronAPI.main.loadSettings();
    if (!settings) {
        throw Error(`Failed to load settings for ${parentNodeId}`);
    }
    const agentCommand: string = settings.agentCommand;

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
    const contextNode: GraphNode = parentNode.nodeUIMetadata.isContextNode
        ? parentNode
        : await getNodeFromMainToUI(contextNodeId);
    const contextContent: string = contextNode.contentWithoutYamlOrLinks;

    // Get next terminal count for the context node
    const terminalCount: number = getNextTerminalCount(terminals, contextNodeId);

    // Get context node title for the terminal window
    const title: string = getNodeTitle(contextNode);

    // Compute initial_spawn_directory from watch directory + relative path setting
    let initial_spawn_directory: string | undefined;
    const watchStatus: { readonly isWatching: boolean; readonly directory: string | undefined; } = await window.electronAPI?.main.getWatchStatus();
    if (watchStatus?.directory && settings.terminalSpawnPathRelativeToWatchedDirectory) {
        // Simple path join: remove trailing slash from directory, remove leading ./ from relative path
        const baseDir: string = watchStatus.directory.replace(/\/$/, '');
        const relativePath: string = settings.terminalSpawnPathRelativeToWatchedDirectory.replace(/^\.\//, '');
        initial_spawn_directory = `${baseDir}/${relativePath}`;
    }

    // Get app support path for VOICETREE_APP_SUPPORT env var
    const appSupportPath: string = await window.electronAPI?.main.getAppSupportPath();

    // Create TerminalData object with initial_content env var
    const terminalId: string = `${contextNodeId}-terminal-${terminalCount}`;
    const terminalData: TerminalData = {
        attachedToNodeId: contextNodeId,
        terminalCount: terminalCount,
        initialCommand: agentCommand,
        executeCommand: true,
        initial_spawn_directory: initial_spawn_directory,
        initialEnvVars: {
            VOICETREE_APP_SUPPORT: appSupportPath ?? '',
            CONTEXT_NODE_PATH: await getFilePathForNode(contextNodeId) ?? contextNodeId,
            context_node_content: contextContent,
        },
        floatingWindow: {
            anchored : true,
            cyAnchorNodeId: contextNodeId,
            associatedTerminalOrEditorID: terminalId,
            component: 'Terminal',
            title: title,
            resizable: true
            // shadowNodeDimensions will use defaults: { width: 600, height: 400 }
        }
    };

    // Position the terminal near the context node
    setTimeout(() => {
        void (async () => {
            const targetNode: CollectionReturnValue = cy.getElementById(contextNodeId);

            const nodePos: CyPosition = targetNode.position();
            console.log("spawn terminal: " + terminalId);
            await createFloatingTerminal(cy, contextNodeId, terminalData, nodePos);
            console.log("spawned terminal: " + terminalId);


            // Store terminal in state
            addTerminalToMapState(terminalData);
        })();
    }, 1000); // todo remove this hack, need to actually notify on ready? push all into main?
    // will need to contextNode is ready....

}

/**
 * Create a floating terminal window
 */
export async function createFloatingTerminal(
    cy: Core,
    nodeId: string,
    terminalData: TerminalData,
    nodePos: Position
): Promise<void> {
    const terminalId: string = getTerminalId(terminalData);
    console.log('[FloatingWindowManager] Creating floating terminal:', terminalId);

    // Check if already exists
    const existing: NodeCollection = cy.nodes(`#${terminalId}`);
    if (existing && existing.length > 0) {
        console.log('[FloatingWindowManager] Terminal already exists');
        return;
    }

    // Check if parent node exists
    const parentNode: CollectionReturnValue = cy.getElementById(nodeId);
    const parentNodeExists: boolean = parentNode.length > 0;

    try {
        // Get parent node's title
        const node: GraphNode = await getNodeFromMainToUI(nodeId);
        const title: string = node ? `${getNodeTitle(node)}` : `${nodeId}`;

        // Populate floatingWindow field in terminalData
        // todo why the fyck are we doing this? terminalData already defined with .floatingWindow.
        terminalData.floatingWindow = {
            anchored : true, //todo
            associatedTerminalOrEditorID: terminalId,
            component: 'Terminal',
            title: title,
            resizable: true
            // shadowNodeDimensions will use defaults: { width: 600, height: 400 }
        };

        // Create floating terminal window
        const floatingWindow: FloatingWindowUIHTMLData = await createFloatingTerminalWindow(cy, terminalData);

        if (parentNodeExists) {
            // Anchor to parent node

            anchorToNode(cy, floatingWindow, nodeId, {
                isFloatingWindow: true,
                isShadowNode: true,
                windowType: 'terminal',
                laidOut: false
            });
        } else {
            // Manual positioning if no parent
            floatingWindow.windowElement.style.left = `${nodePos.x + 100}px`;
            floatingWindow.windowElement.style.top = `${nodePos.y}px`;
        }
    } catch (error) {
        console.error('[FloatingWindowManager] Error creating floating terminal:', error);
    }
}

/**
 * Create a floating terminal window (no anchoring)
 * Returns FloatingWindow object that can be anchored or positioned manually
 */
export function createFloatingTerminalWindow(
    cy: cytoscape.Core,
    terminalData: TerminalData
): FloatingWindowUIHTMLData {
    // Extract window configuration from terminalData.floatingWindow
    if (!terminalData.floatingWindow) {
        throw new Error('TerminalData must have floatingWindow field populated');
    }

    const {associatedTerminalOrEditorID, title, resizable = true, onClose} = terminalData.floatingWindow;

    // Get overlay
    const overlay: HTMLElement = getOrCreateOverlay(cy);

    // Create window chrome (don't pass onClose, we'll handle it in the cleanup wrapper)
    const {windowElement, contentContainer, titleBar} = createWindowChrome(cy, {
        associatedTerminalOrEditorID,
        title,
        component: 'Terminal',
        resizable,
        anchored: true //todo
    });

    // Create Terminal instance
    const terminal: TerminalVanilla = new TerminalVanilla({
        container: contentContainer,
        terminalData: terminalData
    }); // todo, move this up one level.

    // Store for cleanup
    vanillaFloatingWindowInstances.set(associatedTerminalOrEditorID, terminal);

    // Analytics: Track terminal opened
    posthog.capture('terminal_opened', {terminalId: associatedTerminalOrEditorID});

    // Create cleanup wrapper that can be extended by anchorToNode
    const floatingWindow: FloatingWindowUIHTMLData = {
        id: associatedTerminalOrEditorID,
        windowElement,
        contentContainer,
        titleBar,
        cleanup: () => {
            // Analytics: Track terminal closed
            posthog.capture('terminal_closed', {terminalId: associatedTerminalOrEditorID});

            // Remove from state
            removeTerminalFromMapState(terminalData);

            const vanillaInstance: { dispose: () => void; } | undefined = vanillaFloatingWindowInstances.get(associatedTerminalOrEditorID);
            if (vanillaInstance) {
                vanillaInstance.dispose();
                vanillaFloatingWindowInstances.delete(associatedTerminalOrEditorID);
            }
            windowElement.remove();
            if (onClose) {
                onClose();
            }
        }
    };

    // Update close button to call floatingWindow.cleanup (so anchorToNode can wrap it)
    const closeButton: HTMLElement = titleBar.querySelector('.cy-floating-window-close') as HTMLElement;
    if (closeButton) {
        // Remove old handler and add new one
        const newCloseButton: HTMLElement = closeButton.cloneNode(true) as HTMLElement;
        closeButton.parentNode?.replaceChild(newCloseButton, closeButton);
        newCloseButton.addEventListener('click', () => floatingWindow.cleanup());
    }

    // Set initial position to offscreen to avoid flash at 0,0
    // windowElement.style.left = '-9999px';
    // windowElement.style.top = '-9999px';

    // Add to overlay
    overlay.appendChild(windowElement);

    return floatingWindow;
}

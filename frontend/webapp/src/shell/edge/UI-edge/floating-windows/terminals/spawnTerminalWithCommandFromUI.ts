import type {NodeIdAndFilePath, Position} from "@/pure/graph";
import type {Core} from "cytoscape";
import {
    anchorToNode,
    createWindowChrome,
    getOrCreateOverlay
} from "@/shell/UI/floating-windows/cytoscape-floating-windows.ts";
import {TerminalVanilla} from "@/shell/UI/floating-windows/terminals/TerminalVanilla.ts";
import posthog from "posthog-js";
import type {FloatingWindowUIHTMLData, TerminalData} from "@/shell/edge/UI-edge/floating-windows/types.ts";
import {getTerminalId} from "@/shell/edge/UI-edge/floating-windows/types.ts";
import {
    addTerminalToMapState,
    getNextTerminalCount,
    getTerminals,
    removeTerminalFromMapState,
    vanillaFloatingWindowInstances
} from "@/shell/edge/UI-edge/state/UIAppState.ts";
import {getNodeFromMainToUI} from "@/shell/edge/UI-edge/graph/getNodeFromMainToUI.ts";


/**
 * Spawn a terminal with a new context node
 * Creates a context node for the parent, then spawns a terminal attached to that context node
 * with the context node content as an environment variable (initial_content)
 *
 * @param parentNodeId - The parent node to create context for
 * @param cy - Cytoscape instance
 */
export async function spawnTerminalWithNewContextNode(
    parentNodeId: NodeIdAndFilePath,
    cy: Core,
): Promise<void> {
    const terminals = getTerminals();

    // Load settings to get the agentCommand
    const settings = await window.electronAPI?.main.loadSettings();
    if (!settings) {
        throw Error(`Failed to load settings for ${parentNodeId}`);
    }
    const agentCommand = settings.agentCommand;

    // Create context node for the parent
    const contextNodeId = await window.electronAPI?.main.createContextNode(parentNodeId);
    if (!contextNodeId) {
        throw Error(`Failed to create contextNodeId ${contextNodeId}`);
    }

    // Get the context node to read its content
    const contextNode = await getNodeFromMainToUI(contextNodeId);
    const contextContent = contextNode.content;

    // Get next terminal count for the context node
    const terminalCount = getNextTerminalCount(terminals, contextNodeId);

    // Get context node title for the terminal window
    const title = contextNode.nodeUIMetadata.title;

    // Create TerminalData object with initial_content env var
    const terminalId = `${contextNodeId}-terminal-${terminalCount}`;
    const terminalData: TerminalData = {
        attachedToNodeId: contextNodeId,
        terminalCount: terminalCount,
        initialCommand: agentCommand,
        executeCommand: true,
        initialEnvVars: {
            initial_content: contextContent
        },
        floatingWindow: {
            cyAnchorNodeId: contextNodeId,
            id: terminalId,
            component: 'Terminal',
            title: title,
            resizable: true
            // shadowNodeDimensions will use defaults: { width: 600, height: 400 }
        }
    };

    // Position the terminal near the context node
    setTimeout(async () => {
        const targetNode = cy.getElementById(contextNodeId);

        const nodePos = targetNode.position();
        console.log("spawn terminal: " + terminalId);
        await createFloatingTerminal(cy, contextNodeId, terminalData, nodePos);
        console.log("spawned terminal: " + terminalId);


        // Store terminal in state
        addTerminalToMapState(terminalData);
    }, 1000); // todo remove this hack, need to actually notify on ready? push all into main?
    // will need to contextNode is ready....

}

/**
 * Spawn a terminal for a node
 * Common function used by context menu, hotkey, and editor
 *
 * @param nodeId - The node ID to spawn terminal for
 * @param cy - Cytoscape instance
 */
export async function spawnTerminalForNode(
    nodeId: NodeIdAndFilePath,
    cy: Core,
): Promise<void> {
    const terminals = getTerminals();
    // Load settings to get the agentCommand
    const settings = await window.electronAPI?.main.loadSettings();
    if (!settings) {
        throw Error(`Failed to load settings for ${nodeId}`);
    }
    const agentCommand = settings.agentCommand;

    // Get next terminal count for this node
    const terminalCount = getNextTerminalCount(terminals, nodeId);

    // Get node title for the terminal window
    const node = await getNodeFromMainToUI(nodeId);
    const title = node ? `${node.nodeUIMetadata.title}` : `${nodeId}`;

    // Create TerminalData object with floatingWindow populated
    const terminalId = `${nodeId}-terminal-${terminalCount}`;
    const terminalData: TerminalData = {
        attachedToNodeId: nodeId,
        terminalCount: terminalCount,
        initialCommand: agentCommand,
        executeCommand: true,
        floatingWindow: {
            cyAnchorNodeId: nodeId,
            id: terminalId,
            component: 'Terminal',
            title: title,
            resizable: true
            // shadowNodeDimensions will use defaults: { width: 600, height: 400 }
        }
    };

    const targetNode = cy.getElementById(nodeId);
    if (targetNode.length > 0) {
        const nodePos = targetNode.position();
        await createFloatingTerminal(cy, nodeId, terminalData, nodePos);
    }
    // Store terminal in state (mutate the global Map for now, can be refactored later)
    addTerminalToMapState(terminalData);
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
    const terminalId = getTerminalId(terminalData);
    console.log('[FloatingWindowManager] Creating floating terminal:', terminalId);

    // Check if already exists
    const existing = cy.nodes(`#${terminalId}`);
    if (existing && existing.length > 0) {
        console.log('[FloatingWindowManager] Terminal already exists');
        return;
    }

    // Check if parent node exists
    const parentNode = cy.getElementById(nodeId);
    const parentNodeExists = parentNode.length > 0;

    try {
        // Get parent node's title
        const node = await getNodeFromMainToUI(nodeId);
        const title = node ? `${node.nodeUIMetadata.title}` : `${nodeId}`;

        // Populate floatingWindow field in terminalData
        terminalData.floatingWindow = {
            cyAnchorNodeId: nodeId,
            id: terminalId,
            component: 'Terminal',
            title: title,
            resizable: true
            // shadowNodeDimensions will use defaults: { width: 600, height: 400 }
        };

        // Create floating terminal window
        const floatingWindow = createFloatingTerminalWindow(cy, terminalData);

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

    const {id, title, resizable = true, onClose} = terminalData.floatingWindow;

    // Get overlay
    const overlay = getOrCreateOverlay(cy);

    // Create window chrome (don't pass onClose, we'll handle it in the cleanup wrapper)
    const {windowElement, contentContainer, titleBar} = createWindowChrome(cy, {
        id,
        title,
        component: 'Terminal',
        resizable,
        cyAnchorNodeId: terminalData.attachedToNodeId
    });

    // Create Terminal instance
    const terminal = new TerminalVanilla({
        container: contentContainer,
        terminalData: terminalData
    }); // todo, move this up one level.

    // Store for cleanup
    vanillaFloatingWindowInstances.set(id, terminal);

    // Analytics: Track terminal opened
    posthog.capture('terminal_opened', {terminalId: id});

    // Create cleanup wrapper that can be extended by anchorToNode
    const floatingWindow: FloatingWindowUIHTMLData = {
        id,
        windowElement,
        contentContainer,
        titleBar,
        cleanup: () => {
            // Analytics: Track terminal closed
            posthog.capture('terminal_closed', {terminalId: id});

            // Remove from state
            removeTerminalFromMapState(terminalData);

            const vanillaInstance = vanillaFloatingWindowInstances.get(id);
            if (vanillaInstance) {
                vanillaInstance.dispose();
                vanillaFloatingWindowInstances.delete(id);
            }
            windowElement.remove();
            if (onClose) {
                onClose();
            }
        }
    };

    // Update close button to call floatingWindow.cleanup (so anchorToNode can wrap it)
    const closeButton = titleBar.querySelector('.cy-floating-window-close') as HTMLElement;
    if (closeButton) {
        // Remove old handler and add new one
        const newCloseButton = closeButton.cloneNode(true) as HTMLElement;
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

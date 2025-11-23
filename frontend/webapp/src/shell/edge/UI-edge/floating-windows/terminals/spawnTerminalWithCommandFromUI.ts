import type {NodeIdAndFilePath, Position} from "@/pure/graph";
import type {Core} from "cytoscape";
import {
    anchorToNode,
    createWindowChrome,
    getOrCreateOverlay
} from "@/shell/UI/floating-windows/cytoscape-floating-windows.ts";
import {TerminalVanilla} from "@/shell/UI/floating-windows/terminals/TerminalVanilla.ts";
import posthog from "posthog-js";
import type {
    FloatingWindowUIHTMLData,
    TerminalData
} from "@/shell/edge/UI-edge/floating-windows/types.ts";
import {vanillaFloatingWindowInstances} from "@/shell/edge/UI-edge/state/UIAppState.ts";


/**
 * Spawn a terminal for a node
 * Common function used by context menu, hotkey, and editor
 *
 * @param nodeId - The node ID to spawn terminal for
 * @param cy - Cytoscape instance
 * @param createFloatingTerminal - Function to create the floating terminal window
 */
export async function spawnTerminalForNode(
    nodeId: NodeIdAndFilePath,
    cy: Core,
): Promise<void> {
    // Load settings to get the agentCommand
    const settings = await window.electronAPI?.main.loadSettings();
    const agentCommand = settings?.agentCommand ?? './claude.sh';

    const nodeMetadata: TerminalData = {
        terminalId: nodeId,
        name: nodeId.replace(/_/g, ' '),
        initialCommand: agentCommand,
        executeCommand: true
    };

    const targetNode = cy.getElementById(nodeId);
    if (targetNode.length > 0) {
        const nodePos = targetNode.position();
        await createFloatingTerminal(cy, nodeId, nodeMetadata, nodePos)
    }
}
    /**
     * Create a floating terminal window
     */
    async function createFloatingTerminal(
        cy : Core,
        nodeId: string,
        nodeMetadata: { id: string; name: string; filePath?: string },
    nodePos: Position
): Promise<void> {
        const terminalId = `${nodeId}-terminal`;
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
        const {getNodeFromMainToUI} = await import("@/shell/edge/UI-edge/graph/getNodeFromMainToUI.ts");
        const node = await getNodeFromMainToUI(nodeId);
        const title = node ? `${node.nodeUIMetadata.title}` : `${nodeId}`;

        // Create floating terminal window
        const floatingWindow = createFloatingTerminalWindow(this.cy, {
            id: terminalId,
            title: title,
            nodeMetadata: nodeMetadata,
            resizable: true
        });

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
    config: {
        id: string;
        title: string;
        nodeMetadata: TerminalData;
        onClose?: () => void;
        resizable?: boolean;
    }
): FloatingWindowUIHTMLData {
    const {id, title, nodeMetadata, onClose, resizable = true} = config;

    // Get overlay
    const overlay = getOrCreateOverlay(cy);

    // Create window chrome (don't pass onClose, we'll handle it in the cleanup wrapper)
    const {windowElement, contentContainer, titleBar} = createWindowChrome(cy, {
        id,
        title,
        component: 'Terminal',
        resizable,
        terminalMetadata: nodeMetadata
    });

    // Create Terminal instance
    const terminal = new TerminalVanilla({
        container: contentContainer,
        nodeMetadata
    });

    // Store for cleanup
    vanillaFloatingWindowInstances.set(id, terminal);

    // Analytics: Track terminal opened
    posthog.capture('terminal_opened', { terminalId: id });

    // Create cleanup wrapper that can be extended by anchorToNode
    const floatingWindow: FloatingWindowUIHTMLData = {
        id,
        windowElement,
        contentContainer,
        titleBar,
        cleanup: () => {
            // Analytics: Track terminal closed
            posthog.capture('terminal_closed', { terminalId: id });

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


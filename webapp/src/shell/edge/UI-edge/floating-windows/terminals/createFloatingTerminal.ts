import type { NodeIdAndFilePath } from "@vt/graph-model/graph";
import type { Core, CollectionReturnValue, EventObject } from "cytoscape";
import { getOrCreateOverlay, registerFloatingWindow } from "@/shell/edge/UI-edge/floating-windows/anchoring/cytoscape-floating-windows";
import { TerminalVanilla } from "@/shell/UI/floating-windows/terminals/TerminalVanilla";
import posthog from "posthog-js";
import { getTerminalId, type TerminalId, type FloatingWindowUIData } from "@/shell/edge/UI-edge/floating-windows/anchoring/types";
import { vanillaFloatingWindowInstances } from "@/shell/edge/UI-edge/state/stores/UIAppState";
import { createWindowChrome } from "@/shell/edge/UI-edge/floating-windows/chrome/create-window-chrome";
import { anchorToNode } from "@/shell/edge/UI-edge/floating-windows/anchoring/anchor-to-node";
import { getCurrentIndex } from '@/shell/UI/cytoscape-graph-ui/services/layout/spatialIndexSync';
import * as O from "fp-ts/lib/Option.js";
import type { TerminalData } from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import { closeTerminal } from "@/shell/edge/UI-edge/floating-windows/terminals/closeTerminal";
import { createInjectBar, registerInjectBar, type InjectBarHandle } from "@/shell/UI/floating-windows/terminals/InjectBar";

// Typed interface for the main-process IPC method used by onInject callback.
// Same pattern as InjectBarMainIPC in InjectBar.ts — cast through this to avoid
// renderer tsconfig issues with Node.js dependencies in the main-process import chain.
interface FloatingTerminalMainIPC {
    injectNodesIntoTerminal(request: { terminalId: string; nodeIds: readonly string[] }): Promise<{ success: boolean; injectedCount: number }>;
}

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
        // [L2-seam-residual] cy-only: shadow-node anchoring must wait for the projected node to exist in Cytoscape.
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

function markParentNodeHasRunningTerminal(cy: Core, parentNodeId: string): void {
    // [L2-seam-residual] cy-only: the running-terminal marker lives on the projected Cytoscape node.
    const parentNode: CollectionReturnValue = cy.getElementById(parentNodeId);
    if (parentNode.length > 0) {
        parentNode.data('hasRunningTerminal', true);
    }
}

function anchorTerminalToNode(cy: Core, terminalWithUI: TerminalData): void {
    if (!terminalWithUI.ui || !O.isSome(terminalWithUI.anchoredToNodeId)) return;
    anchorToNode(cy, terminalWithUI, getCurrentIndex(cy));
    markParentNodeHasRunningTerminal(cy, terminalWithUI.anchoredToNodeId.value);
}

function registerDeferredAnchor(cy: Core, terminalWithUI: TerminalData): void {
    if (!terminalWithUI.ui || !O.isSome(terminalWithUI.anchoredToNodeId)) return;

    const parentNodeId: string = terminalWithUI.anchoredToNodeId.value;
    const handleAddedNode = (event: EventObject): void => {
        if (event.target.id() !== parentNodeId) return;
        cy.off('add', 'node', handleAddedNode);
        anchorTerminalToNode(cy, terminalWithUI);
    };

    cy.on('add', 'node', handleAddedNode);
}

/**
 * Create a floating terminal window
 * Returns TerminalData with ui populated, or undefined if terminal already exists
 */
export async function createFloatingTerminal(
    cy: Core,
    nodeId: string,
    terminalData: TerminalData
): Promise<TerminalData | undefined> {
    const terminalId: TerminalId = getTerminalId(terminalData);
    //console.log('[FloatingWindowManager-v2] Creating floating terminal:', terminalId);

    // Check if already exists in renderer-local UI state.
    if (vanillaFloatingWindowInstances.has(terminalId)) {
        //console.log('[FloatingWindowManager-v2] Terminal already exists');
        return undefined;
    }

    // Wait for task node to appear (handles IPC race condition where terminal launch
    // arrives before graph delta is processed). Context nodes are no longer in cytoscape,
    // so wait for the task node (anchoredToNodeId) instead.
    const waitNodeId: string = O.isSome(terminalData.anchoredToNodeId)
        ? terminalData.anchoredToNodeId.value
        : nodeId;
    const targetNode: CollectionReturnValue | null = await waitForNode(cy, waitNodeId, 1000);

    try {
        // Create floating terminal window (returns TerminalData with ui populated)
        const terminalWithUI: TerminalData = createFloatingTerminalWindow(cy, terminalData);

        // Anchor immediately if the node appeared during the short wait. Otherwise keep the
        // terminal visible at a fallback position and anchor it when SSE later adds the node.
        if (targetNode && terminalWithUI.ui && O.isSome(terminalWithUI.anchoredToNodeId)) {
            anchorTerminalToNode(cy, terminalWithUI);
        } else if (terminalWithUI.ui) {
            // Fallback: position at a default location if no parent node
            // (rare case - terminals usually have a parent context node)
            terminalWithUI.ui.windowElement.style.left = '100px';
            terminalWithUI.ui.windowElement.style.top = '100px';
            registerDeferredAnchor(cy, terminalWithUI);
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

    // Mount InjectBar badge inline in the title bar for agent terminals with a context node.
    // Only shown for agent terminals (those with attachedToContextNodeId), not user-spawned shells.
    if (terminalData.attachedToContextNodeId) {
        // Cast main to typed IPC interface — injectNodesIntoTerminal exists on mainAPI
        // but its type can't resolve in the renderer tsconfig due to Node.js dependencies.
        const mainIPC: FloatingTerminalMainIPC | undefined = window.hostAPI?.main as unknown as FloatingTerminalMainIPC | undefined;
        const injectBar: InjectBarHandle = createInjectBar({
            terminalId,
            onInject: async (nodeIds: NodeIdAndFilePath[]): Promise<void> => {
                try {
                    const result: { success: boolean; injectedCount: number } | undefined = await mainIPC?.injectNodesIntoTerminal({ terminalId, nodeIds });
                    if (result && !result.success) {
                        console.warn('[createFloatingTerminal] injectNodesIntoTerminal returned success=false for', terminalId);
                    }
                } catch (err: unknown) {
                    console.error('[createFloatingTerminal] injectNodesIntoTerminal failed:', err);
                    throw err; // Re-throw so InjectBar's .catch() also fires
                }
            },
        });
        // Insert badge as a child of terminal-context-badge-subtitle (appears inline next to agent name)
        const subtitleRow: Element | null = ui.windowElement.querySelector('.terminal-context-badge-subtitle');
        if (subtitleRow) {
            subtitleRow.appendChild(injectBar.element);
        } else {
            // Fallback: insert into title bar before traffic lights if no context badge
            const titleBar: Element | null = ui.windowElement.querySelector('.terminal-title-bar');
            if (titleBar) {
                const trafficLights: Element | null = titleBar.querySelector('.terminal-traffic-lights');
                if (trafficLights) {
                    titleBar.insertBefore(injectBar.element, trafficLights);
                } else {
                    titleBar.appendChild(injectBar.element);
                }
            }
        }
        registerInjectBar(terminalId, injectBar);
        void injectBar.refresh();
    }

    // Create TerminalData with ui populated (immutable)
    const terminalWithUI: TerminalData = { ...terminalData, ui };

    // Create Terminal instance (after InjectBar so contentContainer height is final for fitAddon.fit())
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

import type { Position } from "@/pure/graph";
import type { Core, NodeCollection, CollectionReturnValue } from "cytoscape";
import { getOrCreateOverlay, registerFloatingWindow } from "@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows";
import { TerminalVanilla } from "@/shell/UI/floating-windows/terminals/TerminalVanilla";
import posthog from "posthog-js";
import { getTerminalId, type TerminalId, type FloatingWindowUIData } from "@/shell/edge/UI-edge/floating-windows/types";
import { vanillaFloatingWindowInstances } from "@/shell/edge/UI-edge/state/UIAppState";
import { createWindowChrome } from "@/shell/edge/UI-edge/floating-windows/create-window-chrome";
import { anchorToNode } from "@/shell/edge/UI-edge/floating-windows/anchor-to-node";
import * as O from "fp-ts/lib/Option.js";
import type { TerminalData } from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import { closeTerminal } from "@/shell/edge/UI-edge/floating-windows/terminals/closeTerminal";

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

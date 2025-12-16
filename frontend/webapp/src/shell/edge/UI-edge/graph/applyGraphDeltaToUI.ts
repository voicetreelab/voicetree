import type {Core, NodeSingular, CollectionReturnValue, EdgeCollection} from "cytoscape";
type CyNodeSingular = NodeSingular;
import type {GraphDelta, GraphNode} from "@/pure/graph";
import * as O from 'fp-ts/lib/Option.js';
import {prettyPrintGraphDelta, stripDeltaForReplay} from "@/pure/graph";
import {getNodeTitle} from "@/pure/graph/markdown-parsing";
import {hasActualContentChanged} from "@/pure/graph/contentChangeDetection";
import posthog from "posthog-js";
import {markTerminalActivityForContextNode} from "@/shell/UI/views/AgentTabsBar";
import type {} from '@/utils/types/cytoscape-layout-utilities';
import {cyFitCollectionByAverageNodeSize} from "@/utils/responsivePadding";

const MAX_EDGES: number = 150;
const FEEDBACK_DELTA_THRESHOLD: number = 40;

// Session-level state for tracking total nodes created
let sessionDeltaCount: number = 0;
let feedbackAlertShown: boolean = false;

/**
 * Creates and shows an HTML dialog for collecting user feedback.
 * Returns a promise that resolves with the feedback text or null if cancelled.
 */
function showFeedbackDialog(): Promise<string | null> {
    return new Promise((resolve) => {
        const dialog: HTMLDialogElement = document.createElement('dialog');
        dialog.id = 'feedback-dialog';
        dialog.style.cssText = `
            border: 1px solid var(--border);
            border-radius: var(--radius);
            background: var(--background);
            color: var(--foreground);
            padding: 24px;
            max-width: 420px;
            width: 90%;
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
        `;

        dialog.innerHTML = `
            <form method="dialog" style="display: flex; flex-direction: column; gap: 16px;">
                <h2 style="margin: 0; font-size: 1.1rem; font-weight: 600;">
                    Hey I'm Manu who built this, glad to see you are using this!
                </h2>
                <p style="margin: 0; color: var(--muted-foreground); font-size: 0.9rem;">
                    It would mean a lot to me if you share any feedback. Hope VoiceTree is useful for you!
                </p>
                <textarea
                    id="feedback-input"
                    rows="4"
                    placeholder="Type your feedback here..."
                    style="
                        width: 100%;
                        padding: 10px 12px;
                        border: 1px solid var(--border);
                        border-radius: calc(var(--radius) - 2px);
                        background: var(--input);
                        color: var(--foreground);
                        font-family: inherit;
                        font-size: 0.9rem;
                        resize: vertical;
                        box-sizing: border-box;
                    "
                ></textarea>
                <div style="display: flex; gap: 8px; justify-content: flex-end;">
                    <button
                        type="submit"
                        id="feedback-submit"
                        disabled
                        style="
                            padding: 8px 16px;
                            border: none;
                            border-radius: calc(var(--radius) - 2px);
                            background: var(--primary);
                            color: var(--primary-foreground);
                            cursor: not-allowed;
                            font-size: 0.9rem;
                            opacity: 0.5;
                        "
                    >Send Feedback</button>
                </div>
            </form>
        `;

        document.body.appendChild(dialog);

        const textarea: HTMLTextAreaElement = dialog.querySelector('#feedback-input')!;
        const submitBtn: HTMLButtonElement = dialog.querySelector('#feedback-submit')!;

        // Enable submit button only when there's content
        textarea.addEventListener('input', () => {
            const hasContent: boolean = textarea.value.trim().length > 0;
            submitBtn.disabled = !hasContent;
            submitBtn.style.opacity = hasContent ? '1' : '0.5';
            submitBtn.style.cursor = hasContent ? 'pointer' : 'not-allowed';
        });

        dialog.addEventListener('close', () => {
            dialog.remove();
        });

        dialog.addEventListener('submit', (e: Event) => {
            e.preventDefault();
            const feedback: string = textarea.value.trim();
            dialog.close();
            resolve(feedback || null);
        });

        // Prevent Escape key from closing dialog - user must submit or cancel
        dialog.addEventListener('cancel', (e: Event) => {
            e.preventDefault();
        });

        dialog.showModal();
        textarea.focus();
    });
}

/**
 * Show feedback request dialog after user creates enough nodes in a session.
 * Collects user feedback and automatically sends it to PostHog.
 * Only shows once per session.
 */
function maybeShowFeedbackAlert(): void {
    if (feedbackAlertShown) return;

    sessionDeltaCount++;

    if (sessionDeltaCount >= FEEDBACK_DELTA_THRESHOLD) {
        feedbackAlertShown = true;
        void showFeedbackDialog().then((feedback: string | null) => {
            if (feedback) {
                posthog.capture('userFeedback', {
                    feedback,
                    source: 'in-app-dialog',
                    sessionDeltaCount
                });
            }
        });
    }
}

/**
 * Validates if a color value is a valid CSS color using the browser's CSS.supports API
 */
function isValidCSSColor(color: string): boolean {
    if (!color) return false;
    return CSS.supports('color', color);
}

/**
 * Apply a GraphDelta to the Cytoscape UI-edge
 *
 * Handles:
 * - Creating new nodes with positions
 * - Updating existing nodes' metadata (except positions)
 * - Creating edges
 * - Deleting nodes
 */
export function applyGraphDeltaToUI(cy: Core, delta: GraphDelta): void {
    console.log("applyGraphDeltaToUI", delta.length);
    console.log('[applyGraphDeltaToUI] Starting\n' + prettyPrintGraphDelta(delta));
    let newNodeCount: number = 0;
    let edgeLimitAlertShown: boolean = false;
    const nodesWithoutPositions: string[] = [];
    cy.batch(() => {
        // PASS 1: Create/update all nodes and handle deletions
        delta.forEach((nodeDelta) => {
            if (nodeDelta.type === 'UpsertNode') {
                const node: GraphNode = nodeDelta.nodeToUpsert;
                const nodeId: string = node.relativeFilePathIsID;
                const existingNode: CollectionReturnValue = cy.getElementById(nodeId);
                const isNewNode: boolean = existingNode.length === 0;

                if (isNewNode) {
                    newNodeCount++;
                    const hasPosition: boolean = O.isSome(node.nodeUIMetadata.position);
                    // Use saved position or temporary (0,0) - placeNewNodes will fix nodes without positions
                    const pos: { x: number; y: number; } = O.getOrElse(() => ({x: 0, y: 0}))(node.nodeUIMetadata.position);
                    const colorValue: string | undefined = O.isSome(node.nodeUIMetadata.color) && isValidCSSColor(node.nodeUIMetadata.color.value)
                        ? node.nodeUIMetadata.color.value
                        : undefined;

                    console.log(`[applyGraphDeltaToUI] Creating node ${nodeId} with color:`, colorValue);

                    cy.add({
                        group: 'nodes' as const,
                        data: {
                            id: nodeId,
                            label: getNodeTitle(node),
                            content: node.contentWithoutYamlOrLinks,
                            summary: '',
                            color: colorValue,
                            isContextNode: node.nodeUIMetadata.isContextNode === true
                        },
                        position: {
                            x: pos.x,
                            y: pos.y
                        }
                    });

                    if (!hasPosition) {
                        nodesWithoutPositions.push(nodeId);
                    }
                } else {
                    // Update existing node metadata (but NOT position)
                    existingNode.data('label', getNodeTitle(node));
                    // DO NOT sET existingNode.data('content', node.content); it's too much storage duplicated unnec in frontend.
                    existingNode.data('summary', '');
                    const color: string | undefined = O.isSome(node.nodeUIMetadata.color) && isValidCSSColor(node.nodeUIMetadata.color.value)
                        ? node.nodeUIMetadata.color.value
                        : undefined;
                    if (color === undefined) {
                        existingNode.removeData('color'); // todo, really necessary? Cytoscape doesn't clear values when set to undefined but that shouldn't matter?
                    } else {
                        existingNode.data('color', color);
                    }
                    existingNode.data('isContextNode', node.nodeUIMetadata.isContextNode === true);
                    // Only emit content-changed (blue animation) if actual content changed, not just links
                    if (O.isSome(nodeDelta.previousNode) &&
                        hasActualContentChanged(
                            nodeDelta.previousNode.value.contentWithoutYamlOrLinks,
                            node.contentWithoutYamlOrLinks
                        )) {
                        existingNode.emit('content-changed');
                    }
                }
            } else if (nodeDelta.type === 'DeleteNode') {
                const nodeId: string = nodeDelta.nodeId;
                const nodeToRemove: CollectionReturnValue = cy.getElementById(nodeId);
                if (nodeToRemove.length > 0) {
                    nodeToRemove.remove();
                }
            }
        });

        // PASS 2: Sync edges for each node (add missing, remove stale)
        delta.forEach((nodeDelta) => {
            if (nodeDelta.type === 'UpsertNode') {
                const node: GraphNode = nodeDelta.nodeToUpsert;
                const nodeId: string = node.relativeFilePathIsID;

                // Get current edges from this node in Cytoscape
                const currentEdges: EdgeCollection = cy.edges(`[source = "${nodeId}"]`);
                const currentTargets: Set<string> = new Set(currentEdges.map(edge => edge.data('target') as string));
                const desiredTargets: Set<string> = new Set(node.outgoingEdges.map(edge => edge.targetId));

                // Remove edges that are no longer in outgoingEdges
                // BUT: Don't remove edges to floating window shadow nodes (terminals/editors)
                // These are UI-only nodes not tracked in the graph model
                currentEdges.forEach((edge) => {
                    const target: string = edge.data('target') as string;
                    if (!desiredTargets.has(target)) {
                        const targetNode: CyNodeSingular =  cy.getElementById(target);
                        const isShadowNode: boolean = targetNode.length > 0 && targetNode.data('isShadowNode') === true;
                        if (isShadowNode) {
                            console.log(`[applyGraphDeltaToUI] Keeping edge to shadow node: ${nodeId}->${target}`);
                            return;
                        }
                        console.log(`[applyGraphDeltaToUI] Removing edge no longer in graph: ${nodeId}->${target}`);
                        edge.remove();
                    }
                });

                // Add edges for all outgoing connections (if they don't exist)
                node.outgoingEdges.forEach((edge) => {
                    if (!currentTargets.has(edge.targetId)) {
                        const edgeId: string = `${nodeId}->${edge.targetId}`;
                        // Only create edge if target node exists AND edge doesn't already exist
                        // (belt-and-suspenders check - currentTargets should catch most cases,
                        // but direct getElementById catches edge cases like same node appearing
                        // multiple times in delta or race conditions between deltas)
                        const targetNode: CollectionReturnValue = cy.getElementById(edge.targetId);
                        const existingEdge: CollectionReturnValue = cy.getElementById(edgeId);
                        if (existingEdge.length > 0) {
                            // Edge already exists (race condition or duplicate in delta)
                            console.log(`[applyGraphDeltaToUI] Edge ${edgeId} already exists, skipping`);
                        } else if (cy.edges().length >= MAX_EDGES) {
                            // Edge limit reached - only show alert once per delta application
                            if (!edgeLimitAlertShown) {
                                alert(`There is a limit of ${MAX_EDGES} edges at once, contact manu@voicetree.io to increase this`);
                                edgeLimitAlertShown = true;
                            }
                            console.warn(`[applyGraphDeltaToUI] Edge limit reached (${MAX_EDGES}), not adding edge ${edgeId}`);
                        } else if (targetNode.length > 0) {
                            console.log(`[applyGraphDeltaToUI] Adding new edge: ${edgeId} with label ${edge.label}`);
                            cy.add({
                                group: 'edges' as const,
                                data: {
                                    id: edgeId,
                                    source: nodeId,
                                    target: edge.targetId,
                                    label: edge.label ? edge.label.replace(/_/g, ' ') : undefined
                                }
                            });
                            // If source or target is a context node, mark associated terminal as having activity
                            console.log(`[applyGraphDeltaToUI] Checking isContextNode for ${nodeId}:`, node.nodeUIMetadata.isContextNode);
                            if (node.nodeUIMetadata.isContextNode === true) {
                                console.log(`[applyGraphDeltaToUI] Context node ${nodeId} got new edge, marking terminal activity`);
                                markTerminalActivityForContextNode(nodeId);
                            }
                            // Always try to mark activity - markTerminalActivityForContextNode handles non-context nodes gracefully
                            markTerminalActivityForContextNode(edge.targetId);
                        } else {
                            console.warn(`[applyGraphDeltaToUI] Skipping edge ${nodeId}->${edge.targetId}: target node does not exist`);
                        }
                    }
                });
            }
        });
    });

    // Place nodes that don't have saved positions near their neighbors
    if (nodesWithoutPositions.length > 0) {
        let nodesCollection: ReturnType<Core['collection']> = cy.collection();
        nodesWithoutPositions.forEach((nodeId: string) => {
            nodesCollection = nodesCollection.merge(cy.getElementById(nodeId));
        });
        console.log('[applyGraphDeltaToUI] Placing', nodesWithoutPositions.length, 'nodes without positions');
        const layoutUtils: ReturnType<Core['layoutUtilities']> = cy.layoutUtilities({ idealEdgeLength: 200, offset: 50 });
        layoutUtils.placeNewNodes(nodesCollection);
    }

    if (newNodeCount >= 1 && cy.nodes().length <= 4) {
        // Fit so average node takes 10% of viewport for comfortable initial view
        setTimeout(() => { if (!cy.destroyed()) cyFitCollectionByAverageNodeSize(cy, cy.nodes(), 0.1); }, 150);
    }
    else if (newNodeCount > 5) {
        // Bulk load: just fit all nodes in view
        setTimeout(() => { if (!cy.destroyed()) cy.fit(); }, 150);
    }
    //analytics
    const anonGraphDelta: GraphDelta = stripDeltaForReplay(delta);
    posthog.capture('graphDelta', {delta: anonGraphDelta});
    const userId: string = posthog.get_distinct_id()
    console.log("UUID", userId);
    console.log('[applyGraphDeltaToUI] Complete. Total nodes:', cy.nodes().length, 'Total edges:', cy.edges().length);

    // Show feedback request after enough deltas created in session
    if (newNodeCount){
        maybeShowFeedbackAlert();
    }
}

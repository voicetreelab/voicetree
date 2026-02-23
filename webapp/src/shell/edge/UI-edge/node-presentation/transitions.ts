import type { Core, CollectionReturnValue } from 'cytoscape';
import type { NodeIdAndFilePath } from '@/pure/graph';
import type { NodePresentation, NodeState } from '@/pure/graph/node-presentation/types';
import { getPresentation } from './NodePresentationStore';
import { createFloatingEditor, closeEditor } from '@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD';
import { getCachedZoom } from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';
import { forceRefreshPresentation } from './zoomSync';
import type { EditorData } from '@/shell/edge/UI-edge/state/UIAppState';

// Half-height editor spawned on hover (clean swap)
const HALF_EDITOR_WIDTH: number = 340;
const HALF_EDITOR_HEIGHT: number = 200;
// Full editor after commit (dblclick / text selection)
const FULL_EDITOR_WIDTH: number = 420;

// Track floating editors spawned via clean swap, keyed by nodeId
const floatingEditors: Map<string, EditorData> = new Map();

// Cached cy reference for disposeEditor (which doesn't receive cy as param)
let cachedCy: Core | undefined;

// Concurrency guard: prevent double-spawns during async createFloatingEditor
const spawningEditors: Set<string> = new Set();

export function getFloatingEditor(nodeId: string): EditorData | undefined {
    return floatingEditors.get(nodeId);
}

/**
 * Transition a node presentation to a new state using clean swap.
 *
 * HOVER/ANCHORED: hide presentation element + Cy node, spawn a separate
 * floating editor via FloatingEditorCRUD. The editor is an independent DOM
 * element — zoomSync correctly skips HOVER/ANCHORED since the editor manages
 * its own positioning.
 *
 * CARD/PLAIN from editor states: close floating editor, restore presentation
 * element, call forceRefreshPresentation to recalculate zoom morph state.
 *
 * Cy node dimensions are NOT changed for HOVER/ANCHORED — the node stays at
 * card size to hold its layout position. The editor floats independently.
 */
export async function transitionTo(
    cy: Core,
    nodeId: string,
    targetState: NodeState
): Promise<void> {
    cachedCy = cy;

    const presentation: NodePresentation | undefined = getPresentation(nodeId);
    if (!presentation) return;
    if (presentation.state === targetState) return;

    const previousState: NodeState = presentation.state;

    // Don't transition backwards from ANCHORED to HOVER (e.g., stale hover timer)
    if (previousState === 'ANCHORED' && targetState === 'HOVER') return;

    // === SPAWN: entering HOVER or ANCHORED ===
    if (targetState === 'HOVER' || targetState === 'ANCHORED') {
        if (!floatingEditors.has(nodeId)) {
            await spawnCleanSwapEditor(cy, nodeId, presentation, targetState);
            // Re-check: presentation may have been destroyed during async spawn
            if (!getPresentation(nodeId)) return;
        } else if (targetState === 'ANCHORED') {
            // Already have an editor from HOVER — expand to full width
            const editor: EditorData | undefined = floatingEditors.get(nodeId);
            if (editor?.ui) {
                editor.ui.windowElement.dataset.baseWidth = String(FULL_EDITOR_WIDTH);
                editor.ui.windowElement.style.width = `${FULL_EDITOR_WIDTH}px`;
            }
        }
    }

    // === UPDATE STATE (must happen before forceRefreshPresentation) ===
    presentation.element.classList.remove('state-plain', 'state-card', 'state-hover', 'state-anchored');
    presentation.element.classList.add(`state-${targetState.toLowerCase()}`);
    presentation.state = targetState;

    // === RESTORE: leaving HOVER/ANCHORED back to CARD/PLAIN ===
    if ((targetState === 'CARD' || targetState === 'PLAIN') &&
        (previousState === 'HOVER' || previousState === 'ANCHORED')) {
        const editor: EditorData | undefined = floatingEditors.get(nodeId);
        if (editor) {
            closeEditor(cy, editor);
            floatingEditors.delete(nodeId);
        }
        // Show presentation element again
        presentation.element.style.display = '';
        // Recalculate zoom morph (restores correct Cy node opacity + card state)
        forceRefreshPresentation(cy, presentation, getCachedZoom());
    }
}

/**
 * Hide presentation + Cy node, spawn a floating editor at the node's position.
 * Wires mouseleave (auto-close), dblclick (commit/expand), traffic-light-close (restore).
 */
async function spawnCleanSwapEditor(
    cy: Core,
    nodeId: string,
    presentation: NodePresentation,
    targetState: NodeState
): Promise<void> {
    if (spawningEditors.has(nodeId)) return;
    spawningEditors.add(nodeId);

    try {
        // Hide presentation element
        presentation.element.style.display = 'none';

        // Hide Cy node (keep at current size for layout, just invisible)
        const cyNode: CollectionReturnValue = cy.getElementById(nodeId);
        if (cyNode.length > 0) {
            cyNode.style({ 'opacity': 0, 'events': 'no' } as Record<string, unknown>);
        }

        const editor: EditorData | undefined = await createFloatingEditor(
            cy,
            nodeId as NodeIdAndFilePath,
            nodeId as NodeIdAndFilePath, // Cy node is the anchor — enables full menu + position sync
            false
        );

        // Re-check after async gap
        if (!editor?.ui || !getPresentation(nodeId)) {
            // Failed or presentation destroyed — restore
            presentation.element.style.display = '';
            forceRefreshPresentation(cy, presentation, getCachedZoom());
            return;
        }

        // Set dimensions for half-height hover editor or full-size anchored
        const isFullSize: boolean = targetState === 'ANCHORED';
        const width: number = isFullSize ? FULL_EDITOR_WIDTH : HALF_EDITOR_WIDTH;
        editor.ui.windowElement.style.width = `${width}px`;
        editor.ui.windowElement.dataset.baseWidth = String(width);
        if (!isFullSize) {
            editor.ui.windowElement.style.height = `${HALF_EDITOR_HEIGHT}px`;
        }

        // Position centered on Cy node, using actual nodeId for live position tracking
        if (cyNode.length > 0) {
            const pos: { x: number; y: number } = cyNode.position();
            const zoom: number = getCachedZoom();
            editor.ui.windowElement.dataset.shadowNodeId = nodeId;
            editor.ui.windowElement.dataset.transformOrigin = 'center';
            editor.ui.windowElement.style.left = `${pos.x * zoom}px`;
            editor.ui.windowElement.style.top = `${pos.y * zoom}px`;
            editor.ui.windowElement.style.transformOrigin = 'center center';
            editor.ui.windowElement.style.transform = `translate(-50%, -50%) scale(${zoom})`;
        }

        floatingEditors.set(nodeId, editor);

        let committed: boolean = false;

        // dblclick → commit: expand to full width, persist after mouseleave
        editor.ui.windowElement.addEventListener('dblclick', (): void => {
            if (committed) return;
            committed = true;
            void transitionTo(cy, nodeId, 'ANCHORED');
        });

        // mouseleave → close if uncommitted, restore card + Cy node
        editor.ui.windowElement.addEventListener('mouseleave', (): void => {
            if (committed) return;
            void transitionTo(cy, nodeId, 'CARD');
        });

        // traffic-light-close → always restore
        editor.ui.windowElement.addEventListener('traffic-light-close', (): void => {
            committed = false;
            void transitionTo(cy, nodeId, 'CARD');
        });
    } finally {
        spawningEditors.delete(nodeId);
    }
}

/**
 * Cleanup floating editor for a node. Called by destroyNodePresentation.
 * Uses cached cy reference since destroyNodePresentation doesn't pass cy.
 */
export function disposeEditor(nodeId: string): void {
    const editor: EditorData | undefined = floatingEditors.get(nodeId);
    if (!editor) return;

    if (cachedCy) {
        closeEditor(cachedCy, editor);
    } else if (editor.ui) {
        // Fallback: direct DOM removal (shadow node cleaned up when Cy node is destroyed)
        editor.ui.windowElement.remove();
    }
    floatingEditors.delete(nodeId);
}

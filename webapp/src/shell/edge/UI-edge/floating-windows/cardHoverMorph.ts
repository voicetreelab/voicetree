import type {Core, CollectionReturnValue} from 'cytoscape';
import type {NodeIdAndFilePath} from '@/pure/graph';
import type {EditorData} from '@/shell/edge/UI-edge/state/UIAppState';
import {createFloatingEditor, closeEditor} from './editors/FloatingEditorCRUD';
import {getCachedZoom} from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';
import {getNodeCard} from '@/shell/edge/UI-edge/state/NodeCardStore';
import {markNodeDirty} from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/autoLayout';
import {forceRefreshCard} from '@/shell/edge/UI-edge/floating-windows/cardZoomMorph';

// Half-height editor spawned on hover
const HALF_EDITOR_DIMENSIONS: { width: number; height: number } = {width: 340, height: 200};
// Full editor after commit (dblclick / text selection)
const FULL_EDITOR_WIDTH: number = 420;

// Debounce timers per node (shared by card mouseenter and Cy mouseover paths)
const hoverTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

/**
 * Wire card-to-editor morph: mouseenter on card DOM -> morph to floating editor.
 * Used when card is visible (zoomed in). For zoomed-out Cy circle hover,
 * HoverEditor.ts calls morphNodeToEditor directly via Cy mouseover.
 */
export function wireCardHoverMorph(
    cy: Core,
    nodeId: string,
    cardElement: HTMLElement
): void {
    cardElement.addEventListener('mouseenter', (): void => {
        // Only morph if card is visible (not already morphed)
        if (cardElement.style.display === 'none') return;
        // Don't restart timer if one is pending
        if (hoverTimers.has(nodeId)) return;

        const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
            hoverTimers.delete(nodeId);
            void morphNodeToEditor(cy, nodeId);
        }, 200);
        hoverTimers.set(nodeId, timer);
    });

    cardElement.addEventListener('mouseleave', (): void => {
        const timer: ReturnType<typeof setTimeout> | undefined = hoverTimers.get(nodeId);
        if (timer) {
            clearTimeout(timer);
            hoverTimers.delete(nodeId);
        }
    });
}

/**
 * Check if a hover morph is already pending for a node.
 * Used by HoverEditor to avoid duplicate debounce timers.
 */
export function isHoverMorphPending(nodeId: string): boolean {
    return hoverTimers.has(nodeId);
}

/**
 * Morph a node to editor — works from both card hover (zoomed in) and Cy circle hover (zoomed out).
 * Hides card + Cy node, spawns a half-height floating editor at node position.
 * dblclick commits (expands to full width, persists after mouseleave).
 * mouseleave without commit auto-closes and restores prior state.
 */
export async function morphNodeToEditor(
    cy: Core,
    nodeId: string,
): Promise<void> {
    const cardData: ReturnType<typeof getNodeCard> = getNodeCard(nodeId);
    const cardElement: HTMLElement | undefined = cardData?.windowElement;

    // Hide card if it exists
    if (cardElement) {
        cardElement.style.display = 'none';
    }

    // Hide Cy node (circle or layout anchor)
    const cyNode: CollectionReturnValue = cy.getElementById(nodeId);
    if (cyNode.length > 0) {
        cyNode.style({'opacity': 0, 'events': 'no'} as Record<string, unknown>);
    }

    const restore: () => void = (): void => {
        // Restore card + Cy node via forceRefreshCard (recalculates zone-based state)
        if (cardElement && getNodeCard(nodeId)) {
            cardElement.style.display = '';
            forceRefreshCard(cy, cardElement, getCachedZoom());
        } else if (cyNode.length > 0) {
            // No card — restore Cy node directly
            cyNode.style({'opacity': 1, 'events': 'yes'} as Record<string, unknown>);
        }
    };

    const editor: EditorData | undefined = await createFloatingEditor(
        cy,
        nodeId as NodeIdAndFilePath,
        nodeId as NodeIdAndFilePath, // Cy node IS the shadow node — anchor for full menu
        false,
        HALF_EDITOR_DIMENSIONS
    );

    if (!editor?.ui) {
        restore();
        return;
    }

    // Position editor centered on Cy node
    if (cyNode.length > 0) {
        const pos: { x: number; y: number } = cyNode.position();
        const zoom: number = getCachedZoom();
        // shadowNodeId so editor follows Cy node when Cola layout moves it
        editor.ui.windowElement.dataset.shadowNodeId = nodeId;
        editor.ui.windowElement.dataset.transformOrigin = 'center';
        editor.ui.windowElement.style.left = `${pos.x * zoom}px`;
        editor.ui.windowElement.style.top = `${pos.y * zoom}px`;
        editor.ui.windowElement.style.transformOrigin = 'center center';
        editor.ui.windowElement.style.transform = `translate(-50%, -50%) scale(${zoom})`;
    }

    let committed: boolean = false;

    // dblclick -> commit: expand to full width, won't auto-close on mouseleave
    editor.ui.windowElement.addEventListener('dblclick', (): void => {
        if (committed) return;
        committed = true;
        editor.ui!.windowElement.dataset.baseWidth = String(FULL_EDITOR_WIDTH);
        editor.ui!.windowElement.style.width = `${FULL_EDITOR_WIDTH}px`;
        markNodeDirty(cy, nodeId);
    });

    // mouseleave -> close if uncommitted, restore card + Cy node
    editor.ui.windowElement.addEventListener('mouseleave', (): void => {
        if (committed) return;
        closeEditor(cy, editor);
        restore();
    });

    // traffic-light-close (from editor chrome) -> restore card + Cy node
    // closeEditor is already called by the listener in FloatingEditorCRUD
    editor.ui.windowElement.addEventListener('traffic-light-close', (): void => {
        restore();
        committed = false;
    });
}

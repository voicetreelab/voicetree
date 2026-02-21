import type {Core} from 'cytoscape';
import type {NodeIdAndFilePath} from '@/pure/graph';
import type {EditorData} from '@/shell/edge/UI-edge/state/UIAppState';
import {createFloatingEditor, closeEditor} from './editors/FloatingEditorCRUD';
import {getCachedZoom} from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';
import {getNodeCard} from '@/shell/edge/UI-edge/state/NodeCardStore';
import {markNodeDirty} from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/autoLayout';

// Half-height editor spawned on card hover
const HALF_EDITOR_DIMENSIONS: { width: number; height: number } = {width: 340, height: 200};
// Full editor after commit (dblclick / text selection)
const FULL_EDITOR_WIDTH: number = 420;

// Debounce timers per node
const hoverTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

/**
 * Wire card-to-editor morph: hover hides card, spawns a real floating editor.
 * - mouseenter (200ms) -> hide card, create half-height floating editor at card position
 * - dblclick on editor -> expand to full width, mark committed (no auto-close)
 * - mouseleave from editor (if uncommitted) -> close editor, show card
 * - editor closed (any reason) -> show card
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
            void morphToEditor(cy, nodeId, cardElement);
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

async function morphToEditor(
    cy: Core,
    nodeId: string,
    cardElement: HTMLElement
): Promise<void> {
    // Hide card — editor takes its place
    cardElement.style.display = 'none';

    const showCard: () => void = (): void => {
        // Only show card if it still exists in store (might have been destroyed)
        if (getNodeCard(nodeId)) {
            cardElement.style.display = '';
        }
    };

    const editor: EditorData | undefined = await createFloatingEditor(
        cy,
        nodeId as NodeIdAndFilePath,
        nodeId as NodeIdAndFilePath, // card's Cy node IS the shadow node — pass as anchor so createWindowChrome builds the full menu
        false,
        HALF_EDITOR_DIMENSIONS
    );

    if (!editor?.ui) {
        showCard();
        return;
    }

    // Position editor at the Cy node position (same position as card's shadow node)
    const cyNode: import('cytoscape').CollectionReturnValue = cy.getElementById(nodeId);
    if (cyNode.length > 0) {
        const pos: { x: number; y: number } = cyNode.position();
        const zoom: number = getCachedZoom();
        // Use shadowNodeId so editor follows Cy node when Cola layout moves it
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
    });

    // mouseleave -> close if uncommitted, show card
    editor.ui.windowElement.addEventListener('mouseleave', (): void => {
        if (committed) return;
        closeEditor(cy, editor);
        showCard();
    });

    // traffic-light-close (from editor chrome) -> show card
    // closeEditor is already called by the listener in FloatingEditorCRUD
    editor.ui.windowElement.addEventListener('traffic-light-close', (): void => {
        showCard();
        committed = false;
    });
}

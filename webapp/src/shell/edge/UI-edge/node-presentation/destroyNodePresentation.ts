import type { NodePresentation } from '@/pure/graph/node-presentation/types';
import { unregisterFloatingWindow, registerFloatingWindow, getOrCreateOverlay } from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';
import { removePresentation, getPresentation } from './NodePresentationStore';
import { disposeEditor } from './transitions';

export function destroyNodePresentation(nodeId: string): void {
    const presentation: NodePresentation | undefined = getPresentation(nodeId);
    if (!presentation) return;

    disposeEditor(nodeId);
    unregisterFloatingWindow(nodeId + '-presentation');
    presentation.element.remove();
    removePresentation(nodeId);
}

// Detached presentations: keep DOM + editor alive during reparent/dissolution
const detachedElements: Map<string, HTMLElement> = new Map();

/**
 * Detach a presentation from the overlay without destroying it.
 * Keeps the DOM element and editor alive in a holding map.
 * Used during reparent (file move) and folder dissolution (2→1 children).
 */
export function detachPresentation(nodeId: string): void {
    const presentation: NodePresentation | undefined = getPresentation(nodeId);
    if (!presentation) return;

    unregisterFloatingWindow(nodeId + '-presentation');
    // Remove from DOM but keep reference
    if (presentation.element.parentElement) {
        presentation.element.remove();
    }
    detachedElements.set(nodeId, presentation.element);
}

/**
 * Reattach a previously detached presentation to a new Cy node.
 * Re-appends to overlay and re-registers the floating window.
 * The presentation's state and editor remain intact.
 */
export function reattachPresentation(nodeId: string, cy: import('cytoscape').Core): void {
    const presentation: NodePresentation | undefined = getPresentation(nodeId);
    const element: HTMLElement | undefined = detachedElements.get(nodeId);
    if (!presentation || !element) return;

    detachedElements.delete(nodeId);

    // Re-append to overlay
    const overlay: HTMLElement = getOrCreateOverlay(cy);
    overlay.appendChild(element);
    registerFloatingWindow(nodeId + '-presentation', element);

    // Update position from new Cy node
    const cyNode: import('cytoscape').CollectionReturnValue = cy.getElementById(nodeId);
    if (cyNode.length > 0) {
        const zoom: number = cy.zoom();
        const pos: { x: number; y: number } = cyNode.position();
        element.style.left = `${pos.x * zoom}px`;
        element.style.top = `${pos.y * zoom}px`;
    }
}

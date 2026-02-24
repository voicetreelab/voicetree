import type { Core, CollectionReturnValue } from 'cytoscape';
import type { NodePresentation } from '@/pure/graph/node-presentation/types';
import { STATE_DIMENSIONS } from '@/pure/graph/node-presentation/types';
import { getPresentation } from './NodePresentationStore';
import { reconfigureCardCM, getCardCM } from './cardCM';
import { getCachedZoom } from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';
import { forceRefreshPresentation } from './zoomSync';
import { modifyNodeContentFromUI } from '@/shell/edge/UI-edge/floating-windows/editors/modifyNodeContentFromFloatingEditor';
import { createTrafficLights } from '@/shell/edge/UI-edge/floating-windows/traffic-lights';
import { getNodeMenuItems, createHorizontalMenuElement } from '@/shell/UI/cytoscape-graph-ui/services/HorizontalMenuItems';
import { destroyFloatingSlider } from '@/shell/UI/cytoscape-graph-ui/services/DistanceSlider';
import type { HorizontalMenuItem, HorizontalMenuElements } from '@/shell/UI/cytoscape-graph-ui/services/horizontalMenuTypes';
import type { NodeIdAndFilePath } from '@/pure/graph';
import type { CardCMInstance } from '@/pure/graph/node-presentation/cardCMTypes';
import type { ShadowNodeId } from '@/shell/edge/UI-edge/floating-windows/types';

// Debounce timers per node for hover expansion
const hoverTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

// Keyboard isolation: prevent graph hotkeys during editing
const keyboardIsolationListeners: WeakMap<HTMLElement, (e: KeyboardEvent) => void> = new WeakMap();

// Track active CM_EDIT nodeId for single-active enforcement
let activeCMEditNodeId: string | null = null;

// Cleanup functions for horizontal menu (slider destruction) per node
const menuCleanups: Map<string, () => void> = new Map();

/**
 * Wire state transitions onto a node presentation element.
 * All transitions happen on the SAME CardCM instance — no floating editors spawned.
 * - mouseenter (200ms debounce) → CM_EDIT
 * - mouseleave → CM_CARD (unless pinned)
 * - click → CM_EDIT (instant, no debounce)
 * - dblclick → pin editor (stays open on mouseleave)
 * - click outside → CM_CARD
 * - Escape → CM_CARD (unpins first if pinned)
 */
export function wireHoverTransitions(
    cy: Core,
    nodeId: string,
    element: HTMLElement
): void {
    element.addEventListener('mouseenter', (): void => {
        const p: NodePresentation | undefined = getPresentation(nodeId);
        if (!p || p.state !== 'CM_CARD') return;

        const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
            hoverTimers.delete(nodeId);
            enterCMEdit(cy, nodeId);
        }, 200);
        hoverTimers.set(nodeId, timer);
    });

    element.addEventListener('mouseleave', (): void => {
        // Cancel pending hover timer
        const timer: ReturnType<typeof setTimeout> | undefined = hoverTimers.get(nodeId);
        if (timer) {
            clearTimeout(timer);
            hoverTimers.delete(nodeId);
        }

        const p: NodePresentation | undefined = getPresentation(nodeId);
        if (!p) return;
        if (p.state === 'CM_EDIT' && !p.isPinned) {
            exitCMEdit(cy, nodeId);
        }
    });

    // Click → instant CM_EDIT (no debounce)
    element.addEventListener('click', (e: MouseEvent): void => {
        e.stopPropagation();
        const p: NodePresentation | undefined = getPresentation(nodeId);
        if (!p) return;

        if (p.state === 'CM_CARD') {
            // Cancel pending hover timer
            const timer: ReturnType<typeof setTimeout> | undefined = hoverTimers.get(nodeId);
            if (timer) {
                clearTimeout(timer);
                hoverTimers.delete(nodeId);
            }
            enterCMEdit(cy, nodeId);
        }
    });

    // Dblclick → pin editor (stays open even on mouseleave)
    element.addEventListener('dblclick', (e: MouseEvent): void => {
        e.stopPropagation();
        const p: NodePresentation | undefined = getPresentation(nodeId);
        if (!p || p.state !== 'CM_EDIT') return;
        p.isPinned = true;
        element.classList.add('pinned');
    });

    // Click outside → exit CM_EDIT if not pinned
    document.addEventListener('mousedown', (e: MouseEvent): void => {
        const p: NodePresentation | undefined = getPresentation(nodeId);
        if (!p || p.state !== 'CM_EDIT') return;
        if (element.contains(e.target as Node)) return;
        if (p.isPinned) return;
        exitCMEdit(cy, nodeId);
    });

    // Escape → unpin (if pinned) then exit CM_EDIT
    document.addEventListener('keydown', (e: KeyboardEvent): void => {
        if (e.key !== 'Escape') return;
        const p: NodePresentation | undefined = getPresentation(nodeId);
        if (!p || p.state !== 'CM_EDIT') return;
        // Unpin if pinned, then exit
        p.isPinned = false;
        element.classList.remove('pinned');
        exitCMEdit(cy, nodeId);
    });
}

export function enterCMEdit(cy: Core, nodeId: string): void {
    const presentation: NodePresentation | undefined = getPresentation(nodeId);
    if (!presentation || presentation.state !== 'CM_CARD') return;

    // Exit any other active CM_EDIT first (only one at a time)
    if (activeCMEditNodeId && activeCMEditNodeId !== nodeId) {
        exitCMEdit(cy, activeCMEditNodeId);
    }
    activeCMEditNodeId = nodeId;

    // Reconfigure CM to editing mode — single synchronous dispatch, no DOM rebuild
    reconfigureCardCM(nodeId, 'editing', (newContent: string): void => {
        void modifyNodeContentFromUI(nodeId as NodeIdAndFilePath, newContent, cy);
    });

    // Update state + CSS class
    presentation.state = 'CM_EDIT';
    presentation.element.classList.remove('state-cm_card');
    presentation.element.classList.add('state-cm_edit');

    // Expand card dimensions for editing
    const dims: { readonly width: number; readonly height: number } = STATE_DIMENSIONS.CM_EDIT;
    presentation.element.style.width = `${dims.width}px`;
    presentation.element.style.minHeight = `${dims.height}px`;
    presentation.element.style.maxHeight = 'none';

    // Remove zoom scale transform — CM needs unscaled DOM for cursor/selection accuracy
    // Position at screen coords instead of scaled transform
    const zoom: number = getCachedZoom();
    const shadowNodeId: string | undefined = presentation.element.dataset.shadowNodeId;
    if (shadowNodeId) {
        const cyNode: CollectionReturnValue = cy.getElementById(shadowNodeId);
        if (cyNode.length > 0) {
            const pos: { x: number; y: number } = cyNode.position();
            presentation.element.style.transform = 'translate(-50%, -50%)';
            presentation.element.style.left = `${pos.x * zoom}px`;
            presentation.element.style.top = `${pos.y * zoom}px`;
        }
    }

    // Add keyboard isolation — stop graph hotkeys reaching Cy while editing
    addKeyboardIsolation(presentation.element.querySelector('.node-presentation-editor'));

    // Populate horizontal menu (Delete, Copy, Add, Run, More + traffic lights)
    const menuContainer: HTMLElement | null = presentation.element.querySelector('.node-presentation-menu');
    if (menuContainer) {
        menuContainer.innerHTML = '';

        // Card-specific traffic lights: close exits CM_EDIT, pin toggles isPinned
        const trafficLights: HTMLDivElement = createTrafficLights({
            onClose: (): void => exitCMEdit(cy, nodeId),
            onPin: (): boolean => {
                presentation.isPinned = !presentation.isPinned;
                presentation.element.classList.toggle('pinned', presentation.isPinned);
                return presentation.isPinned;
            },
            isPinned: presentation.isPinned,
            cy,
            shadowNodeId: nodeId as ShadowNodeId,
        });

        const cyNode: CollectionReturnValue = cy.getElementById(nodeId);
        const isContextNode: boolean = cyNode.data('isContextNode') === true;

        const menuItems: HorizontalMenuItem[] = getNodeMenuItems({
            nodeId,
            cy,
            agents: [],
            isContextNode,
            currentDistance: 5,
            menuElement: menuContainer,
        });

        const onClose: () => void = (): void => exitCMEdit(cy, nodeId);
        const { leftGroup, spacer, rightGroup }: HorizontalMenuElements =
            createHorizontalMenuElement(menuItems, onClose, trafficLights);

        // Minimal spacer — toolbar layout, not centered-over-node layout
        spacer.style.width = '0';
        spacer.style.flex = '1';
        spacer.style.minHeight = '0';

        menuContainer.appendChild(leftGroup);
        menuContainer.appendChild(spacer);
        menuContainer.appendChild(rightGroup);

        menuCleanups.set(nodeId, (): void => {
            destroyFloatingSlider();
        });
    }

    // Focus the CM editor
    const inst: CardCMInstance | undefined = getCardCM(nodeId);
    if (inst) {
        inst.view.focus();
    }
}

function exitCMEdit(cy: Core, nodeId: string): void {
    const presentation: NodePresentation | undefined = getPresentation(nodeId);
    if (!presentation || presentation.state !== 'CM_EDIT') return;

    // Reconfigure CM back to readonly — preserves scroll position and undo history
    reconfigureCardCM(nodeId, 'readonly');

    // Update state + CSS class
    presentation.state = 'CM_CARD';
    presentation.element.classList.remove('state-cm_edit');
    presentation.element.classList.add('state-cm_card');

    // Remove keyboard isolation
    removeKeyboardIsolation(presentation.element.querySelector('.node-presentation-editor'));

    // Clear horizontal menu
    const menuCleanup: (() => void) | undefined = menuCleanups.get(nodeId);
    if (menuCleanup) {
        menuCleanup();
        menuCleanups.delete(nodeId);
    }
    const menuContainer: HTMLElement | null = presentation.element.querySelector('.node-presentation-menu');
    if (menuContainer) {
        menuContainer.innerHTML = '';
    }

    // Reset card dimensions + restore zoom-scaled transform
    presentation.element.style.width = '';
    presentation.element.style.minHeight = '';
    presentation.element.style.maxHeight = '';
    forceRefreshPresentation(cy, presentation, getCachedZoom());

    // Unpin
    presentation.isPinned = false;
    presentation.element.classList.remove('pinned');

    if (activeCMEditNodeId === nodeId) {
        activeCMEditNodeId = null;
    }
}

function addKeyboardIsolation(container: HTMLElement | null): void {
    if (!container) return;
    const handler: (e: KeyboardEvent) => void = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') return; // Let Escape bubble to document handler
        e.stopPropagation();
    };
    container.addEventListener('keydown', handler, true);
    keyboardIsolationListeners.set(container, handler);
}

function removeKeyboardIsolation(container: HTMLElement | null): void {
    if (!container) return;
    const handler: ((e: KeyboardEvent) => void) | undefined = keyboardIsolationListeners.get(container);
    if (handler) {
        container.removeEventListener('keydown', handler, true);
        keyboardIsolationListeners.delete(container);
    }
}

/** Get the nodeId currently in CM_EDIT, or null if none. */
export function getActiveCMEditNodeId(): string | null {
    return activeCMEditNodeId;
}

/** Exit the currently active CM_EDIT (if any). */
export function exitActiveCMEdit(cy: Core): void {
    if (activeCMEditNodeId) {
        exitCMEdit(cy, activeCMEditNodeId);
    }
}

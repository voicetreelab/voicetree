import type { Core } from 'cytoscape';
import type { NodePresentation } from '@/pure/graph/node-presentation/types';
import { getPresentation } from './NodePresentationStore';
import { transitionTo } from './transitions';

// Debounce timers per node for hover expansion
const hoverTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

/**
 * Wire state transitions onto a node presentation element.
 * - mouseenter (200ms debounce) → HOVER
 * - mouseleave → CARD (unless pinned/anchored)
 * - click → ANCHORED
 * - click outside → CARD (if anchored and not pinned)
 */
export function wireHoverTransitions(
    cy: Core,
    nodeId: string,
    element: HTMLElement
): void {
    element.addEventListener('mouseenter', (): void => {
        const p: NodePresentation | undefined = getPresentation(nodeId);
        if (!p || p.state !== 'CARD') return;

        const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
            hoverTimers.delete(nodeId);
            void transitionTo(cy, nodeId, 'HOVER');
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
        // Collapse from HOVER to CARD (not from ANCHORED — that needs explicit close)
        if (p.state === 'HOVER' && !p.isPinned) {
            void transitionTo(cy, nodeId, 'CARD');
        }
    });

    // Click → ANCHORED
    element.addEventListener('click', (e: MouseEvent): void => {
        e.stopPropagation();
        void transitionTo(cy, nodeId, 'ANCHORED');
    });

    // Click outside → collapse from ANCHORED to CARD (if not pinned)
    document.addEventListener('mousedown', (e: MouseEvent): void => {
        const p: NodePresentation | undefined = getPresentation(nodeId);
        if (!p || p.state !== 'ANCHORED') return;
        if (p.isPinned) return;
        if (!element.contains(e.target as Node)) {
            void transitionTo(cy, nodeId, 'CARD');
        }
    });
}

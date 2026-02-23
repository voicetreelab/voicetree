import type { Core } from 'cytoscape';
import type { NodePresentation } from '@/pure/graph/node-presentation/types';
import { getPresentation } from './NodePresentationStore';
import { transitionTo, getFloatingEditor, clearActiveInlineEdit } from './transitions';
import { isPinned as isEditorPinned } from '@/shell/edge/UI-edge/state/EditorStore';

// Debounce timers per node for hover expansion
const hoverTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

/**
 * Wire state transitions onto a node presentation element.
 * - mouseenter (200ms debounce) → HOVER (kept for Phase 1 compatibility)
 * - mouseleave → CARD (unless pinned/anchored/inline-editing)
 * - click → INLINE_EDIT (instead of ANCHORED)
 * - dblclick → ANCHORED (from INLINE_EDIT, for full editing)
 * - click outside → CARD (exits INLINE_EDIT)
 * - Escape → CARD (exits INLINE_EDIT)
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

        // Ignore mouseleave caused by programmatic hiding (display: none triggers mouseleave).
        // During clean swap, spawnCleanSwapEditor hides the card before spawning the editor.
        // The browser queues a mouseleave macrotask. If createFloatingEditor resolves quickly
        // (cached IPC), the state updates to HOVER before this queued mouseleave fires —
        // causing an immediate HOVER→CARD collapse loop (flickering).
        if (element.style.display === 'none') return;

        const p: NodePresentation | undefined = getPresentation(nodeId);
        if (!p) return;
        // Collapse from HOVER to CARD (not from ANCHORED or INLINE_EDIT — those need explicit close)
        if (p.state === 'HOVER' && !p.isPinned) {
            void transitionTo(cy, nodeId, 'CARD');
        }
    });

    // Click → INLINE_EDIT (instead of ANCHORED)
    element.addEventListener('click', (e: MouseEvent): void => {
        e.stopPropagation();
        const p: NodePresentation | undefined = getPresentation(nodeId);
        if (!p) return;

        // Only transition from CARD or HOVER to INLINE_EDIT
        if (p.state === 'CARD' || p.state === 'HOVER') {
            // Cancel any pending hover timer
            const timer: ReturnType<typeof setTimeout> | undefined = hoverTimers.get(nodeId);
            if (timer) {
                clearTimeout(timer);
                hoverTimers.delete(nodeId);
            }
            void transitionTo(cy, nodeId, 'INLINE_EDIT');
        }
    });

    // Dblclick → ANCHORED (from INLINE_EDIT, for full editing)
    element.addEventListener('dblclick', (e: MouseEvent): void => {
        e.stopPropagation();
        const p: NodePresentation | undefined = getPresentation(nodeId);
        if (!p) return;

        if (p.state === 'INLINE_EDIT') {
            clearActiveInlineEdit();
            void transitionTo(cy, nodeId, 'ANCHORED');
        }
    });

    // Click outside → collapse from INLINE_EDIT or ANCHORED to CARD (if not pinned)
    document.addEventListener('mousedown', (e: MouseEvent): void => {
        const p: NodePresentation | undefined = getPresentation(nodeId);
        if (!p) return;

        if (p.state === 'INLINE_EDIT') {
            // Check if click is inside this card
            if (element.contains(e.target as Node)) return;
            clearActiveInlineEdit();
            void transitionTo(cy, nodeId, 'CARD');
            return;
        }

        if (p.state === 'ANCHORED') {
            if (p.isPinned || isEditorPinned(nodeId)) return;
            // Check both the presentation element and the clean-swap floating editor
            if (element.contains(e.target as Node)) return;
            const floatingEditor: ReturnType<typeof getFloatingEditor> = getFloatingEditor(nodeId);
            if (floatingEditor?.ui?.windowElement.contains(e.target as Node)) return;
            void transitionTo(cy, nodeId, 'CARD');
        }
    });

    // Escape → exit INLINE_EDIT to CARD
    document.addEventListener('keydown', (e: KeyboardEvent): void => {
        if (e.key !== 'Escape') return;
        const p: NodePresentation | undefined = getPresentation(nodeId);
        if (!p || p.state !== 'INLINE_EDIT') return;
        clearActiveInlineEdit();
        void transitionTo(cy, nodeId, 'CARD');
    });
}

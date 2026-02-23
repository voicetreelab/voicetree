import type { Core, CollectionReturnValue } from 'cytoscape';
import type { NodeIdAndFilePath } from '@/pure/graph';
import type { NodePresentation, NodeState } from '@/pure/graph/node-presentation/types';
import { STATE_DIMENSIONS } from '@/pure/graph/node-presentation/types';
import { getPresentation } from './NodePresentationStore';
import { createFloatingEditor, closeEditor } from '@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD';
import { getCachedZoom } from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';
import { getCyInstance } from '@/shell/edge/UI-edge/state/cytoscape-state';
import { forceRefreshPresentation } from './zoomSync';
import type { EditorData } from '@/shell/edge/UI-edge/state/UIAppState';
import { addToPinnedEditors, isPinned as isEditorPinned } from '@/shell/edge/UI-edge/state/EditorStore';
import { mountInlineEditor, unmountInlineEditor, focusInlineEditor, focusInlineEditorAtEnd } from './inlineEditor';
import { getNodeFromMainToUI } from '@/shell/edge/UI-edge/graph/getNodeFromMainToUI';
import { fromNodeToContentWithWikilinks } from '@/pure/graph/markdown-writing/node_to_markdown';
import { modifyNodeContentFromUI } from '@/shell/edge/UI-edge/floating-windows/editors/modifyNodeContentFromFloatingEditor';
import { contentAfterTitle, stripMarkdownFormatting } from '@/pure/graph/markdown-parsing';

// Half-height editor spawned on hover (clean swap)
const HALF_EDITOR_WIDTH: number = 340;
const HALF_EDITOR_HEIGHT: number = 200;
// Full editor after commit (dblclick / text selection)
const FULL_EDITOR_WIDTH: number = 420;

// Track floating editors spawned via clean swap, keyed by nodeId
const floatingEditors: Map<string, EditorData> = new Map();

// Concurrency guard: prevent double-spawns during async createFloatingEditor
const spawningEditors: Set<string> = new Set();

export function getFloatingEditor(nodeId: string): EditorData | undefined {
    return floatingEditors.get(nodeId);
}

/**
 * Transition a node presentation to a new state.
 *
 * INLINE_EDIT: mount CodeMirror inside the card DOM (no floating window).
 * HOVER/ANCHORED: hide presentation element + Cy node, spawn a separate
 * floating editor via FloatingEditorCRUD.
 * CARD/PLAIN from editor states: close editor, restore card display.
 */
export async function transitionTo(
    cy: Core,
    nodeId: string,
    targetState: NodeState,
    focusAtEnd: boolean = false
): Promise<void> {
    const presentation: NodePresentation | undefined = getPresentation(nodeId);
    if (!presentation) return;
    if (presentation.state === targetState) return;

    const previousState: NodeState = presentation.state;

    // Don't transition backwards from ANCHORED to HOVER (e.g., stale hover timer)
    if (previousState === 'ANCHORED' && targetState === 'HOVER') return;

    // === INLINE_EDIT: mount CodeMirror inside card ===
    if (targetState === 'INLINE_EDIT') {
        // Exit any other INLINE_EDIT card first (only one at a time)
        exitActiveInlineEdit(cy, nodeId);

        const editorContainer: HTMLElement | null = presentation.element.querySelector('.node-presentation-editor');
        if (editorContainer) {
            // Expand card dimensions for editing
            const dims: { readonly width: number; readonly height: number } = STATE_DIMENSIONS.INLINE_EDIT;
            presentation.element.style.width = `${dims.width}px`;
            presentation.element.style.minHeight = `${dims.height}px`;
            presentation.element.style.maxHeight = 'none';

            // Update state classes BEFORE async content fetch (so CSS shows editor container)
            presentation.element.classList.remove('state-plain', 'state-card', 'state-hover', 'state-inline_edit', 'state-anchored');
            presentation.element.classList.add('state-inline_edit');
            presentation.state = 'INLINE_EDIT';

            // Mount CodeMirror with empty content immediately (instant cursor)
            mountInlineEditor(editorContainer, '', nodeId as NodeIdAndFilePath, (newContent: string): void => {
                void modifyNodeContentFromUI(nodeId as NodeIdAndFilePath, newContent, cy);
            });

            // Focus immediately
            if (focusAtEnd) {
                focusInlineEditorAtEnd(nodeId);
            } else {
                focusInlineEditor(nodeId);
            }

            // Fetch actual content and update (async, ~10-50ms IPC)
            void (async (): Promise<void> => {
                try {
                    const node: import('@/pure/graph').GraphNode = await getNodeFromMainToUI(nodeId);
                    const content: string = fromNodeToContentWithWikilinks(node);
                    // Re-check state hasn't changed during async gap
                    const currentPres: NodePresentation | undefined = getPresentation(nodeId);
                    if (currentPres?.state === 'INLINE_EDIT') {
                        const instance: { dispose: () => void; focus?: () => void } | undefined =
                            vanillaFloatingWindowInstances.get(`inline-edit:${nodeId}`);
                        if (instance && 'setValue' in instance) {
                            (instance as { setValue: (c: string) => void }).setValue(content);
                        }
                        if (focusAtEnd) {
                            focusInlineEditorAtEnd(nodeId);
                        }
                    }
                } catch (error: unknown) {
                    console.error('[transitions] Failed to load content for inline edit:', error);
                }
            })();

            // Add keyboard isolation (capture phase stopPropagation)
            addKeyboardIsolation(editorContainer);

            return; // State already updated above
        }
    }

    // === SPAWN: entering HOVER or ANCHORED ===
    if (targetState === 'HOVER' || targetState === 'ANCHORED') {
        // If coming from INLINE_EDIT, unmount inline editor first
        if (previousState === 'INLINE_EDIT') {
            unmountInlineEditor(nodeId);
            removeKeyboardIsolation(presentation.element.querySelector('.node-presentation-editor'));
        }

        if (!floatingEditors.has(nodeId)) {
            const spawned: boolean = await spawnCleanSwapEditor(cy, nodeId, presentation, targetState);
            // Re-check: presentation may have been destroyed during async spawn
            if (!getPresentation(nodeId)) return;
            // If spawn failed, don't update state — presentation was restored by spawnCleanSwapEditor
            if (!spawned) return;
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
    presentation.element.classList.remove('state-plain', 'state-card', 'state-hover', 'state-inline_edit', 'state-anchored');
    presentation.element.classList.add(`state-${targetState.toLowerCase()}`);
    presentation.state = targetState;

    // === RESTORE: leaving INLINE_EDIT back to CARD/PLAIN ===
    if ((targetState === 'CARD' || targetState === 'PLAIN') && previousState === 'INLINE_EDIT') {
        unmountInlineEditor(nodeId);
        removeKeyboardIsolation(presentation.element.querySelector('.node-presentation-editor'));

        // Reset card dimensions back to zoom-morphed size
        presentation.element.style.width = '';
        presentation.element.style.minHeight = '';
        presentation.element.style.maxHeight = '';

        // Update preview text from latest content
        void updatePreviewFromNode(nodeId, presentation);

        // Recalculate zoom morph state
        forceRefreshPresentation(cy, presentation, getCachedZoom());
    }

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

// Import vanillaFloatingWindowInstances for inline editor setValue access
import { vanillaFloatingWindowInstances } from '@/shell/edge/UI-edge/state/UIAppState';

// Track active inline edit nodeId for single-active enforcement
let activeInlineEditNodeId: string | null = null;

/**
 * Exit the currently active inline edit (if any), unless it's the target node.
 */
function exitActiveInlineEdit(cy: Core, exceptNodeId: string): void {
    if (activeInlineEditNodeId && activeInlineEditNodeId !== exceptNodeId) {
        void transitionTo(cy, activeInlineEditNodeId, 'CARD');
    }
    activeInlineEditNodeId = exceptNodeId;
}

/**
 * Get the active inline edit node ID (for click-outside handling).
 */
export function getActiveInlineEditNodeId(): string | null {
    return activeInlineEditNodeId;
}

/**
 * Clear active inline edit tracking (called when exiting INLINE_EDIT).
 */
export function clearActiveInlineEdit(): void {
    activeInlineEditNodeId = null;
}

// Keyboard isolation: prevent graph hotkeys during inline editing
const keyboardIsolationListeners: WeakMap<HTMLElement, (e: KeyboardEvent) => void> = new WeakMap();

function addKeyboardIsolation(container: HTMLElement): void {
    const handler: (e: KeyboardEvent) => void = (e: KeyboardEvent): void => {
        // Let Escape bubble up (handled by hoverWiring to exit INLINE_EDIT)
        if (e.key === 'Escape') return;
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

/**
 * Update the preview text of a card from the latest node content.
 */
async function updatePreviewFromNode(nodeId: string, presentation: NodePresentation): Promise<void> {
    try {
        const node: import('@/pure/graph').GraphNode = await getNodeFromMainToUI(nodeId);
        const titleEl: HTMLElement | null = presentation.element.querySelector('.node-presentation-title');
        if (titleEl) {
            const { getNodeTitle } = await import('@/pure/graph/markdown-parsing');
            titleEl.textContent = getNodeTitle(node);
        }
        const previewEl: HTMLElement | null = presentation.element.querySelector('.node-presentation-preview');
        if (previewEl) {
            const bodyText: string = contentAfterTitle(node.contentWithoutYamlOrLinks);
            previewEl.textContent = bodyText
                .split('\n')
                .filter((line: string) => line.trim().length > 0)
                .map((line: string) => stripMarkdownFormatting(line).trim())
                .filter((line: string) => line.length > 0)
                .slice(0, 3)
                .join('\n');
        }
    } catch {
        // Node may have been deleted — ignore
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
): Promise<boolean> {
    if (spawningEditors.has(nodeId)) return false;
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
            return false;
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

        // dblclick → commit: expand to full width, pin so click-outside doesn't collapse
        editor.ui.windowElement.addEventListener('dblclick', (): void => {
            if (committed) return;
            committed = true;
            addToPinnedEditors(nodeId);
            void transitionTo(cy, nodeId, 'ANCHORED');
        });

        // mouseleave → close if uncommitted and not pinned, restore card + Cy node
        editor.ui.windowElement.addEventListener('mouseleave', (): void => {
            if (committed) return;
            if (isEditorPinned(nodeId)) return;
            void transitionTo(cy, nodeId, 'CARD');
        });

        // traffic-light-close → always restore
        editor.ui.windowElement.addEventListener('traffic-light-close', (): void => {
            committed = false;
            void transitionTo(cy, nodeId, 'CARD');
        });

        return true;
    } finally {
        spawningEditors.delete(nodeId);
    }
}

/**
 * Cleanup floating editor and/or inline editor for a node.
 * Called by destroyNodePresentation.
 * Uses getCyInstance() on demand — Cy might be destroyed during shutdown.
 */
export function disposeEditor(nodeId: string): void {
    // Dispose inline editor if mounted
    unmountInlineEditor(nodeId);
    if (activeInlineEditNodeId === nodeId) {
        activeInlineEditNodeId = null;
    }

    // Dispose floating editor if present
    const editor: EditorData | undefined = floatingEditors.get(nodeId);
    if (!editor) return;

    try {
        const cy: Core = getCyInstance();
        closeEditor(cy, editor);
    } catch {
        // Cy destroyed during shutdown — fallback to direct DOM removal
        if (editor.ui) {
            editor.ui.windowElement.remove();
        }
    }
    floatingEditors.delete(nodeId);
}

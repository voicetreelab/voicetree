import type { Core, CollectionReturnValue } from 'cytoscape';

import type { NodeIdAndFilePath } from '@/pure/graph';
import { fromNodeToContentWithWikilinks } from '@/pure/graph/markdown-writing/node_to_markdown';
import { getNodeFromMainToUI } from '@/shell/edge/UI-edge/graph/getNodeFromMainToUI';
import { CodeMirrorEditorView } from '@/shell/UI/floating-windows/editors/CodeMirrorEditorView';
import { modifyNodeContentFromUI } from '@/shell/edge/UI-edge/floating-windows/editors/modifyNodeContentFromFloatingEditor';
import type { VTSettings } from '@/pure/settings/types';
import { markNodeDirty } from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/autoLayout';
import {
    type CardMode,
    type NodeCardData,
    getNodeCard,
    setCardMode,
    isCardPinned,
    pinCard,
    unpinCard,
} from '@/shell/edge/UI-edge/state/NodeCardStore';

// Dimensions for each card mode — Cy node dimensions must match for Cola layout
const CARD_DIMENSIONS: Record<CardMode, { width: number; height: number }> = {
    minimal: { width: 260, height: 80 },
    hover:   { width: 340, height: 400 },
    full:    { width: 440, height: 800 },
};

// Debounce timer per node for hover expansion
const hoverTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

// Track mounting state to prevent double-mounts during async gap
const mountingEditors: Set<string> = new Set();

/**
 * Wire 3-mode card interactions.
 * - mouseenter → debounced expand to hover (mount CodeMirror if needed)
 * - click → expand to full, steal focus
 * - mouseleave → collapse to minimal (if not clicked/pinned)
 * - click outside → collapse to minimal (if full and not pinned)
 * - pin button → toggle pin state
 * - close button → collapse to minimal
 */
export function wireCardClickHandlers(
    cy: Core,
    nodeId: string,
    cardElement: HTMLElement
): void {
    // Mouse enter → debounced hover expansion
    cardElement.addEventListener('mouseenter', (): void => {
        const card: NodeCardData | undefined = getNodeCard(nodeId);
        if (!card || card.mode !== 'minimal') return;

        const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
            hoverTimers.delete(nodeId);
            void transitionTo(cy, nodeId, 'hover');
        }, 200);
        hoverTimers.set(nodeId, timer);
    });

    // Mouse leave → collapse if in hover mode and not pinned
    cardElement.addEventListener('mouseleave', (): void => {
        // Cancel pending hover expansion
        const timer: ReturnType<typeof setTimeout> | undefined = hoverTimers.get(nodeId);
        if (timer) {
            clearTimeout(timer);
            hoverTimers.delete(nodeId);
        }

        const card: NodeCardData | undefined = getNodeCard(nodeId);
        if (!card) return;
        // Only collapse from hover, not from full (full collapses on click-outside)
        if (card.mode === 'hover' && !isCardPinned(nodeId)) {
            void transitionTo(cy, nodeId, 'minimal');
        }
    });

    // Card body click → expand to full
    cardElement.addEventListener('click', (e: MouseEvent): void => {
        // Don't handle clicks on traffic light buttons
        const target: HTMLElement = e.target as HTMLElement;
        if (target.closest('.node-card-traffic-lights')) return;
        e.stopPropagation();
        void transitionTo(cy, nodeId, 'full');
    });

    // Click outside → collapse from full to minimal (if not pinned)
    document.addEventListener('mousedown', (e: MouseEvent): void => {
        const card: NodeCardData | undefined = getNodeCard(nodeId);
        if (!card || card.mode !== 'full') return;
        if (isCardPinned(nodeId)) return;
        if (!cardElement.contains(e.target as Node)) {
            void transitionTo(cy, nodeId, 'minimal');
        }
    });

    // Pin button: toggle persistent state
    const pinBtn: HTMLButtonElement | null = cardElement.querySelector('.tl-pin') as HTMLButtonElement | null;
    pinBtn?.addEventListener('click', (e: MouseEvent): void => {
        e.stopPropagation();
        const isPinned: boolean = isCardPinned(nodeId);
        if (isPinned) {
            unpinCard(nodeId);
            cardElement.classList.remove('pinned');
            if (pinBtn) pinBtn.style.background = '#636366';
        } else {
            pinCard(nodeId);
            cardElement.classList.add('pinned');
            if (pinBtn) pinBtn.style.background = '#ffbd2e';
        }
    });

    // Close button: collapse to minimal
    const closeBtn: HTMLButtonElement | null = cardElement.querySelector('.tl-close') as HTMLButtonElement | null;
    closeBtn?.addEventListener('click', (e: MouseEvent): void => {
        e.stopPropagation();
        void transitionTo(cy, nodeId, 'minimal');
    });

    // Expand button: expand to full
    const expandBtn: HTMLButtonElement | null = cardElement.querySelector('.tl-expand') as HTMLButtonElement | null;
    expandBtn?.addEventListener('click', (e: MouseEvent): void => {
        e.stopPropagation();
        void transitionTo(cy, nodeId, 'full');
    });
}

/**
 * Transition a card to a new mode. Handles:
 * - Mounting CodeMirror on first hover/full (async, with guard)
 * - Applying CSS classes for mode
 * - Updating Cy node dimensions for Cola layout
 */
async function transitionTo(
    cy: Core,
    nodeId: string,
    targetMode: CardMode
): Promise<void> {
    const card: NodeCardData | undefined = getNodeCard(nodeId);
    if (!card) return;
    if (card.mode === targetMode) return;

    const previousMode: CardMode = card.mode;

    // Mount CodeMirror on first expansion (hover or full)
    if (targetMode !== 'minimal' && !card.editor) {
        await mountEditor(cy, nodeId, card);
        // Re-check: card may have been destroyed during async mount
        const recheck: NodeCardData | undefined = getNodeCard(nodeId);
        if (!recheck) return;
    }

    // Apply mode CSS class
    card.windowElement.classList.remove('hover-editor', 'full-editor');
    if (targetMode === 'hover') {
        card.windowElement.classList.add('hover-editor');
    } else if (targetMode === 'full') {
        card.windowElement.classList.add('full-editor');
    }

    // Update card mode in store
    setCardMode(nodeId, targetMode);

    // Update baseWidth for zoom scaling
    const dims: { width: number; height: number } = CARD_DIMENSIONS[targetMode];
    card.windowElement.dataset.baseWidth = String(dims.width);

    // Update Cy node dimensions so Cola layout knows the new size
    const cyNode: CollectionReturnValue = cy.getElementById(nodeId);
    if (cyNode.length > 0) {
        cyNode.style({
            'width': dims.width,
            'height': dims.height,
        });
        markNodeDirty(cy, nodeId);
    }

    // Focus editor when entering full mode
    if (targetMode === 'full' && card.editor) {
        card.editor.focus();
    }

    // When collapsing: show preview, update preview text from editor content
    if (targetMode === 'minimal' && previousMode !== 'minimal' && card.editor) {
        const currentContent: string = card.editor.getValue();
        const previewEl: Element | null = card.windowElement.querySelector('.node-card-preview');
        if (previewEl) {
            previewEl.textContent = currentContent
                .split('\n')
                .filter((line: string) => line.trim().length > 0)
                .slice(0, 3)
                .join('\n');
        }
    }
}

/**
 * Mount a CodeMirror editor into a card's editorArea.
 * Fetches node content and settings, then creates the editor instance.
 * Guards against concurrent mounts with a Set.
 */
async function mountEditor(
    cy: Core,
    nodeId: string,
    card: NodeCardData
): Promise<void> {
    if (mountingEditors.has(nodeId)) return;
    mountingEditors.add(nodeId);

    try {
        const [node, settings] = await Promise.all([
            getNodeFromMainToUI(nodeId),
            window.electronAPI!.main.loadSettings() as Promise<VTSettings>
        ]);

        // Re-check after async: card might have been destroyed
        const recheck: NodeCardData | undefined = getNodeCard(nodeId);
        if (!recheck || recheck.editor) {
            return;
        }

        const content: string = fromNodeToContentWithWikilinks(node);

        const editor: CodeMirrorEditorView = new CodeMirrorEditorView(
            card.editorArea,
            content,
            {
                autosaveDelay: 300,
                darkMode: document.documentElement.classList.contains('dark'),
                vimMode: settings.vimMode ?? false,
                nodeId: nodeId,
            }
        );

        card.editor = editor;

        // Auto-save: debounced content changes written back to graph
        editor.onChange((newContent: string): void => {
            void modifyNodeContentFromUI(nodeId as NodeIdAndFilePath, newContent, cy);
        });
    } finally {
        mountingEditors.delete(nodeId);
    }
}

import type { Core } from 'cytoscape';
import type { GraphNode } from '@/pure/graph';
import { CodeMirrorEditorView } from '@/shell/UI/floating-windows/editors/CodeMirrorEditorView';
import { modifyNodeContentFromUI } from '@/shell/edge/UI-edge/floating-windows/editors/modifyNodeContentFromFloatingEditor';
import { getNodeFromMainToUI } from '@/shell/edge/UI-edge/graph/getNodeFromMainToUI';
import { fromNodeToContentWithWikilinks } from '@/pure/graph/markdown-writing/node_to_markdown';
import { isCardPinned, pinCard, unpinCard } from '@/shell/edge/UI-edge/state/NodeCardStore';

// Module-level map: nodeId → active editor instance (only one active at a time)
const activeCardEditors: Map<string, CodeMirrorEditorView> = new Map();

// Single active card click-outside handler reference for cleanup
let currentClickOutsideHandler: ((e: MouseEvent) => void) | null = null;

// Stored cy instance for emitting zoom updates on baseWidth change
let storedCy: Core | null = null;

/**
 * Wire click → activate on a node card element.
 * Call once after card creation in applyGraphDeltaToUI.
 */
export function wireCardClickHandlers(
    cy: Core,
    nodeId: string,
    cardElement: HTMLElement
): void {
    cardElement.addEventListener('click', (e: MouseEvent): void => {
        e.stopPropagation();
        activateCard(cy, nodeId, cardElement);
    });

    // Pin button: toggle persistent card state (card resists click-outside collapse when pinned)
    const pinBtn: HTMLButtonElement | null = cardElement.querySelector('.tl-pin') as HTMLButtonElement | null;
    pinBtn?.addEventListener('click', (e: MouseEvent): void => {
        e.stopPropagation();
        const isPinned: boolean = isCardPinned(nodeId);
        if (isPinned) {
            unpinCard(nodeId);
            cardElement.classList.remove('pinned');
            if (pinBtn) pinBtn.style.background = '#636366'; // gray = unpinned
        } else {
            pinCard(nodeId);
            cardElement.classList.add('pinned');
            if (pinBtn) pinBtn.style.background = '#ffbd2e'; // yellow = pinned (macOS)
        }
    });

    // Close button: collapse active card; no-op if already minimal (card IS the node)
    const closeBtn: HTMLButtonElement | null = cardElement.querySelector('.tl-close') as HTMLButtonElement | null;
    closeBtn?.addEventListener('click', (e: MouseEvent): void => {
        e.stopPropagation();
        if (cardElement.classList.contains('active')) {
            deactivateCard(cardElement, nodeId);
        }
    });

    // Expand button: activate the card (same effect as clicking the card body)
    const expandBtn: HTMLButtonElement | null = cardElement.querySelector('.tl-expand') as HTMLButtonElement | null;
    expandBtn?.addEventListener('click', (e: MouseEvent): void => {
        e.stopPropagation();
        activateCard(cy, nodeId, cardElement);
    });
}

/**
 * Activate a node card: add .active class, mount CodeMirror editor, register click-outside.
 * Guard: no-op if already active. Deactivates any previously active card first.
 */
export function activateCard(
    cy: Core,
    nodeId: string,
    cardElement: HTMLElement
): void {
    if (cardElement.classList.contains('active')) return;

    storedCy = cy;
    deactivateCurrentCard();

    cardElement.classList.add('active');
    // Update baseWidth so updateWindowFromZoom applies the active card width (400px)
    cardElement.dataset.baseWidth = '400';
    cy.emit('zoom');

    const editorArea: HTMLElement | null = cardElement.querySelector('.node-card-editor-area') as HTMLElement | null;
    if (!editorArea) return;

    // Show editor area (overrides inline display:none from createNodeCard)
    editorArea.style.display = 'block';

    // Load full node content and mount CodeMirror asynchronously
    void (async (): Promise<void> => {
        let initialContent: string = '';
        try {
            const node: GraphNode = await getNodeFromMainToUI(nodeId);
            initialContent = fromNodeToContentWithWikilinks(node);
        } catch {
            // Node not found — editor starts empty
        }

        // Guard: card may have been deactivated while awaiting content
        if (!cardElement.classList.contains('active')) return;

        const editor: CodeMirrorEditorView = new CodeMirrorEditorView(
            editorArea,
            initialContent,
            {
                autosaveDelay: 300,
                darkMode: document.documentElement.classList.contains('dark'),
                nodeId: nodeId,
            }
        );

        // Autosave on every user change
        editor.onChange((newContent: string): void => {
            void (async (): Promise<void> => {
                await modifyNodeContentFromUI(nodeId, newContent, cy);
            })();
        });

        activeCardEditors.set(nodeId, editor);
    })();

    // Register click-outside handler (follow HoverEditor.ts:163-185 pattern exactly)
    const handleClickOutside: (e: MouseEvent) => void = (e: MouseEvent): void => {
        const target: Node = e.target as Node;
        const isInsideCard: boolean = cardElement.contains(target);
        const contextMenu: Element | null = document.querySelector('.ctxmenu');
        const isInsideContextMenu: boolean = contextMenu !== null && contextMenu.contains(target);
        if (!isInsideCard && !isInsideContextMenu) {
            deactivateCard(cardElement, nodeId);
        }
    };

    // Add after short delay to prevent immediate closure on the same click
    setTimeout((): void => {
        currentClickOutsideHandler = handleClickOutside;
        document.addEventListener('mousedown', handleClickOutside);
    }, 100);
}

/**
 * Deactivate a node card: remove .active, destroy CodeMirror, restore preview, remove click-outside.
 * No-op if the card is pinned (pinned cards resist collapse from click-outside and deactivateCurrentCard).
 */
function deactivateCard(cardElement: HTMLElement, nodeId: string): void {
    // Don't collapse if pinned
    if (isCardPinned(nodeId)) return;

    cardElement.classList.remove('active');
    // Restore baseWidth to minimal card width and trigger zoom update
    cardElement.dataset.baseWidth = '260';
    storedCy?.emit('zoom');

    // Remove click-outside listener
    if (currentClickOutsideHandler) {
        document.removeEventListener('mousedown', currentClickOutsideHandler);
        currentClickOutsideHandler = null;
    }

    // Destroy editor and update preview with latest content
    const editor: CodeMirrorEditorView | undefined = activeCardEditors.get(nodeId);
    if (editor) {
        const latestContent: string = editor.getValue();
        const previewEl: Element | null = cardElement.querySelector('.node-card-preview');
        if (previewEl) {
            previewEl.textContent = latestContent
                .split('\n')
                .filter((line: string) => line.trim().length > 0)
                .slice(0, 3)
                .join('\n');
        }
        editor.dispose();
        activeCardEditors.delete(nodeId);
    }

    // Hide editor area
    const editorArea: HTMLElement | null = cardElement.querySelector('.node-card-editor-area') as HTMLElement | null;
    if (editorArea) {
        editorArea.style.display = 'none';
    }
}

/**
 * Deactivate whichever card is currently active (if any).
 */
function deactivateCurrentCard(): void {
    const activeCard: HTMLElement | null = document.querySelector('.node-card.active') as HTMLElement | null;
    if (!activeCard) return;

    const nodeId: string | undefined = activeCard.dataset.nodeId;
    if (!nodeId) return;

    deactivateCard(activeCard, nodeId);
}

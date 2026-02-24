import type {Core} from 'cytoscape';
import type cytoscape from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';

import type {GraphNode, NodeIdAndFilePath} from '@/pure/graph';

import {
    createEditorData,
    type EditorId,
    type FloatingWindowUIData,
    getEditorId,
} from '@/shell/edge/UI-edge/floating-windows/types';

import {
    attachCloseHandler,
    disposeFloatingWindow,
    getOrCreateOverlay,
    registerFloatingWindow,
} from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';

import {type EditorData, vanillaFloatingWindowInstances,} from '@/shell/edge/UI-edge/state/UIAppState';

import {CodeMirrorEditorView} from '@/shell/UI/floating-windows/editors/CodeMirrorEditorView';
import {getNodeFromMainToUI} from '@/shell/edge/UI-edge/graph/getNodeFromMainToUI';
import {fromNodeToContentWithWikilinks} from '@/pure/graph/markdown-writing/node_to_markdown';
import {getNodeTitle} from '@/pure/graph/markdown-parsing';
import {
    addEditor,
    getEditorByNodeId,
    getEditors,
    removeEditor as removeEditorFromStore,
} from "@/shell/edge/UI-edge/state/EditorStore";
import {
    modifyNodeContentFromUI
} from "@/shell/edge/UI-edge/floating-windows/editors/modifyNodeContentFromFloatingEditor";
import {selectFloatingWindowNode} from "@/shell/edge/UI-edge/floating-windows/select-floating-window-node";
import {setupAutoHeight} from "@/shell/edge/UI-edge/floating-windows/editors/SetupAutoHeight";
import {createWindowChrome} from "@/shell/edge/UI-edge/floating-windows/create-window-chrome";

// Re-export from decomposed modules for backwards compatibility
export {isMouseInHoverZone, closeHoverEditor, setupCommandHover} from './HoverEditor';
export {createAnchoredFloatingEditor} from './AnchoredEditor';
export {updateFloatingEditors} from './EditorSync';

// =============================================================================
// Card Mode Constants (graph-coordinate base dimensions for each mode)
// =============================================================================

const CARD_DIMENSIONS: { readonly width: number; readonly height: number } = { width: 200, height: 96 };
const EDIT_DIMENSIONS: { readonly width: number; readonly height: number } = { width: 300, height: 144 };
const PINNED_DIMENSIONS: { readonly width: number; readonly height: number } = { width: 420, height: 400 };
const CARD_HOVER_DEBOUNCE_MS: number = 200;

// =============================================================================
// Core Editor Creation
// =============================================================================

/**
 * Create a floating editor window using v2 types
 * Returns EditorData with ui populated, or undefined if editor already exists
 *
 * @param cy - Cytoscape instance
 * @param nodeId - ID of the node to edit (used to fetch content and derive editor ID)
 * @param anchoredToNodeId - Optional node to anchor to (set for anchored, undefined for hover)
 * @param focusAtEnd - If true, focus editor with cursor at end of content (for new nodes)
 */
export async function createFloatingEditor(
    cy: cytoscape.Core,
    nodeId: NodeIdAndFilePath,
    anchoredToNodeId: NodeIdAndFilePath | undefined,
    focusAtEnd: boolean = false,
    cardMode?: { readonly title: string; readonly preview: string; readonly cyNodeId: string }
): Promise<EditorData | undefined> {
    // Card mode: synchronous creation path (no IPC, position at Cy node, hover wiring)
    if (cardMode) {
        return createCardEditorInternal(cy, nodeId, cardMode);
    }

    // Check if editor already exists for this node
    const existingEditor: O.Option<EditorData> = getEditorByNodeId(nodeId);
    if (O.isSome(existingEditor)) {
        //console.log('[createFloatingEditor-v2] Editor already exists for node:', nodeId);
        return undefined;
    }

    // Fetch settings and node content in parallel
    const [node, settings] = await Promise.all([
        getNodeFromMainToUI(nodeId),
        window.electronAPI!.main.loadSettings()
    ]);

    // Re-check after await - another path may have created editor during async gap
    const existingAfterAwait: O.Option<EditorData> = getEditorByNodeId(nodeId);
    if (O.isSome(existingAfterAwait)) {
        //console.log('[createFloatingEditor-v2] Editor created by another path during await:', nodeId);
        return undefined;
    }

    // Derive title and content from nodeId
    // Editor shows content WITHOUT YAML frontmatter - YAML is managed separately
    let content: string = 'loading...';
    let title: string = `${nodeId}`; // fallback to nodeId if node not found
    if (node) {
        content = fromNodeToContentWithWikilinks(node);
        title = `${getNodeTitle(node)}`;
    }

    // Create EditorData using factory function
    const editorData: EditorData = createEditorData({
        contentLinkedToNodeId: nodeId,
        title,
        anchoredToNodeId,
        initialContent: content,
        resizable: true,
    });

    const editorId: EditorId = getEditorId(editorData);

    // Create window chrome (returns FloatingWindowUIData)
    // Pass agents and currentDistance for horizontal menu (editors only)
    const ui: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId, {
        agents: settings.agents ?? [],
        currentDistance: settings.contextNodeMaxDistance ?? 5,
    });

    // Create EditorData with ui populated (immutable update)
    const editorWithUI: EditorData = { ...editorData, ui };

    // Create CodeMirror editor instance
    const editor: CodeMirrorEditorView = new CodeMirrorEditorView(
        ui.contentContainer,
        content,
        {
            autosaveDelay: 300,
            darkMode: document.documentElement.classList.contains('dark'),
            vimMode: settings.vimMode ?? false,
            nodeId: nodeId, // Pass nodeId for image paste support
        }
    );

    // Setup auto-save with modifyNodeContentFromUI
    // Note: onChange only fires for user input (typing, paste, etc.) - NOT for programmatic setValue() calls
    // This is handled by CodeMirrorEditorView using CM6's isUserEvent("input") check
    editor.onChange((newContent: string): void => {
        void (async (): Promise<void> => {
            //console.log('[createFloatingEditor-v2] Saving editor content for node:', nodeId);
            await modifyNodeContentFromUI(nodeId, newContent, cy);
        })();
    });

    // Store vanilla instance for getValue/setValue access (legacy pattern, but needed for updateFloatingEditors)
    vanillaFloatingWindowInstances.set(editorId, editor);

    // Setup auto-height for all editors
    const cleanupAutoHeight: () => void = setupAutoHeight(
        ui.windowElement,
        editor
    );

    // Attach close handler that will dispose editor and remove from state
    attachCloseHandler(cy, editorWithUI, (): void => {
        cleanupAutoHeight();
        // Additional cleanup: dispose CodeMirror instance
        const vanillaInstance: { dispose: () => void } | undefined = vanillaFloatingWindowInstances.get(editorId);
        if (vanillaInstance) {
            vanillaInstance.dispose();
            vanillaFloatingWindowInstances.delete(editorId);
        }
    });

    // Phase 3: Handle traffic light close button click
    // The close button dispatches a custom event that we listen for here
    ui.windowElement.addEventListener('traffic-light-close', (): void => {
        closeEditor(cy, editorWithUI);
    });

    // Add to overlay and register for efficient zoom/pan sync
    const overlay: HTMLElement = getOrCreateOverlay(cy);
    overlay.appendChild(ui.windowElement);
    registerFloatingWindow(editorId, ui.windowElement);

    // Add to state
    addEditor(editorWithUI);

    // Focus editor after DOM attachment - only when focusAtEnd is true (UI-created nodes)
    // External/auto-pinned editors should NOT steal focus from the user's current work
    // Use requestAnimationFrame to ensure DOM is fully settled before focusing
    if (focusAtEnd) {
        requestAnimationFrame(() => {
            editor.focus();
            editor.focusAtEnd();
            // When focus stealing, also select the corresponding node in the graph
            selectFloatingWindowNode(cy, editorWithUI);
        });
    }

    return editorWithUI;
}

// =============================================================================
// Close Editor
// =============================================================================

/**
 * Close an editor - dispose and remove from state
 */
export function closeEditor(cy: Core, editor: EditorData): void {
    const editorId: EditorId = getEditorId(editor);

    // Dispose CodeMirror instance
    const vanillaInstance: { dispose: () => void } | undefined = vanillaFloatingWindowInstances.get(editorId);
    if (vanillaInstance) {
        vanillaInstance.dispose();
        vanillaFloatingWindowInstances.delete(editorId);
    }

    // Dispose floating window (removes DOM and shadow node)
    disposeFloatingWindow(cy, editor);
}

// =============================================================================
// Close All Editors
// =============================================================================

/**
 * Close all open floating editors
 * Called when graph is cleared
 */
export function closeAllEditors(cy: Core): void {
    const editors: Map<EditorId, EditorData> = getEditors();
    for (const editor of editors.values()) {
        closeEditor(cy, editor);
    }
}

// =============================================================================
// Card Editor Creation (internal — called by createFloatingEditor when cardMode is set)
// =============================================================================

/**
 * Create a card-mode floating editor: synchronous DOM creation, positioned at the Cy node,
 * CM always editable (CSS controls interaction), hover wiring for mode transitions.
 * Content is loaded async via IPC after mount.
 */
function createCardEditorInternal(
    cy: cytoscape.Core,
    nodeId: NodeIdAndFilePath,
    cardMode: { readonly title: string; readonly preview: string; readonly cyNodeId: string }
): EditorData {
    const editorData: EditorData = createEditorData({
        contentLinkedToNodeId: nodeId,
        title: cardMode.title,
        anchoredToNodeId: undefined,
        initialContent: '',
        resizable: false,
        shadowNodeDimensions: CARD_DIMENSIONS,
    });

    const editorId: EditorId = getEditorId(editorData);

    // Create window chrome — Task B's cardMode adds card-header DOM + .mode-card class
    const ui: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId, {
        cardMode: { title: cardMode.title, preview: cardMode.preview },
    });

    const editorWithUI: EditorData = { ...editorData, ui };

    // Create CM editor — always editable, CSS controls interaction in card mode
    // (.mode-card .cm-content { pointer-events: none } blocks input without Compartment toggling)
    const editor: CodeMirrorEditorView = new CodeMirrorEditorView(
        ui.contentContainer,
        '', // Empty content — loaded async below
        {
            autosaveDelay: 300,
            darkMode: document.documentElement.classList.contains('dark'),
            nodeId,
        }
    );

    // Setup auto-save (onChange only fires for user input, not programmatic setValue)
    editor.onChange((newContent: string): void => {
        void modifyNodeContentFromUI(nodeId, newContent, cy);
    });

    vanillaFloatingWindowInstances.set(editorId, editor);

    const cleanupAutoHeight: () => void = setupAutoHeight(ui.windowElement, editor);

    attachCloseHandler(cy, editorWithUI, (): void => {
        cleanupAutoHeight();
        const vanillaInstance: { dispose: () => void } | undefined = vanillaFloatingWindowInstances.get(editorId);
        if (vanillaInstance) {
            vanillaInstance.dispose();
            vanillaFloatingWindowInstances.delete(editorId);
        }
    });

    ui.windowElement.addEventListener('traffic-light-close', (): void => {
        closeEditor(cy, editorWithUI);
    });

    // Position at Cy node — the real graph node IS the anchor (no shadow node created).
    // updateWindowFromZoom reads this to track the node's position on zoom/pan.
    ui.windowElement.dataset.shadowNodeId = cardMode.cyNodeId;

    // Add to overlay and register for zoom/pan sync
    const overlay: HTMLElement = getOrCreateOverlay(cy);
    overlay.appendChild(ui.windowElement);
    registerFloatingWindow(editorId, ui.windowElement);

    // Do NOT register in EditorStore — deferred to pin (dblclick)
    wireCardHoverEvents(ui.windowElement, editorWithUI, editor, editorId);

    // Load content async via IPC (setValue doesn't trigger autosave — not a user event)
    void loadCardContentAsync(nodeId, editor);

    return editorWithUI;
}

// =============================================================================
// Card Hover Wiring (CSS-only mode transitions)
// =============================================================================

/**
 * Update base dimensions for a card editor mode transition.
 * Sets dataset.baseWidth/baseHeight (for updateWindowFromZoom) and inline width
 * (editors always use css-transform strategy, so screen width = base width).
 */
function setCardModeDimensions(
    windowElement: HTMLElement,
    dimensions: { readonly width: number; readonly height: number }
): void {
    windowElement.dataset.baseWidth = String(dimensions.width);
    windowElement.dataset.baseHeight = String(dimensions.height);
    windowElement.style.width = `${dimensions.width}px`;
}

/**
 * Wire hover/click/keyboard events for card-mode editors.
 * Mode switching is purely CSS — no Compartment/setMode dispatches.
 *
 * - mouseenter (200ms debounce) → .mode-edit (1.5× gentle expansion)
 * - mouseleave → .mode-card (unless pinned)
 * - click → instant .mode-edit
 * - dblclick → .mode-pinned (register in EditorStore, full editor)
 * - Escape → unpin, return to .mode-card
 */
function wireCardHoverEvents(
    windowElement: HTMLElement,
    editorWithUI: EditorData,
    editor: CodeMirrorEditorView,
    editorId: EditorId,
): void {
    let isPinned: boolean = false;
    let hoverTimeout: ReturnType<typeof setTimeout> | null = null;

    // mouseenter (200ms debounce) → expand to edit mode preview
    windowElement.addEventListener('mouseenter', (): void => {
        if (isPinned) return;
        hoverTimeout = setTimeout((): void => {
            windowElement.classList.replace('mode-card', 'mode-edit');
            setCardModeDimensions(windowElement, EDIT_DIMENSIONS);
        }, CARD_HOVER_DEBOUNCE_MS);
    });

    // mouseleave → collapse to card mode (unless pinned)
    windowElement.addEventListener('mouseleave', (): void => {
        if (hoverTimeout) { clearTimeout(hoverTimeout); hoverTimeout = null; }
        if (isPinned) return;
        windowElement.classList.replace('mode-edit', 'mode-card');
        setCardModeDimensions(windowElement, CARD_DIMENSIONS);
    });

    // click → instant edit mode (skip debounce)
    windowElement.addEventListener('click', (): void => {
        if (isPinned) return;
        if (hoverTimeout) { clearTimeout(hoverTimeout); hoverTimeout = null; }
        windowElement.classList.replace('mode-card', 'mode-edit');
        setCardModeDimensions(windowElement, EDIT_DIMENSIONS);
    });

    // dblclick → pin (register in EditorStore, full editor size)
    windowElement.addEventListener('dblclick', (): void => {
        if (isPinned) return;
        isPinned = true;
        windowElement.classList.remove('mode-card', 'mode-edit');
        windowElement.classList.add('mode-pinned');
        setCardModeDimensions(windowElement, PINNED_DIMENSIONS);
        addEditor(editorWithUI);
        editor.focus();
    });

    // Escape → unpin, return to card mode
    windowElement.addEventListener('keydown', (e: KeyboardEvent): void => {
        if (e.key === 'Escape' && isPinned) {
            isPinned = false;
            windowElement.classList.remove('mode-pinned');
            windowElement.classList.add('mode-card');
            setCardModeDimensions(windowElement, CARD_DIMENSIONS);
            removeEditorFromStore(editorId);
        }
    });
}

// =============================================================================
// Card Content Async Loading
// =============================================================================

/**
 * Load node content via IPC and update the CM editor.
 * Called after card editor DOM is mounted (content starts empty).
 */
async function loadCardContentAsync(
    nodeId: NodeIdAndFilePath,
    editor: CodeMirrorEditorView
): Promise<void> {
    const node: GraphNode = await getNodeFromMainToUI(nodeId);
    if (node) {
        const content: string = fromNodeToContentWithWikilinks(node);
        editor.setValue(content);
    }
}

// =============================================================================
// Card Editor Convenience Function (public API for Task D)
// =============================================================================

/**
 * Create a card-mode floating editor for a graph node.
 * Convenience wrapper around createFloatingEditor with cardMode option.
 *
 * Card editors start compact (.mode-card), expand on hover (.mode-edit),
 * and become full editors on double-click (.mode-pinned).
 */
export async function createCardEditor(
    cy: Core,
    nodeId: NodeIdAndFilePath,
    title: string,
    preview: string
): Promise<EditorData | undefined> {
    return createFloatingEditor(cy, nodeId, undefined, false, {
        title,
        preview,
        cyNodeId: nodeId,
    });
}

// =============================================================================
// Dispose (Cleanup)
// =============================================================================

// Import closeHoverEditor for disposeEditorManager
import {closeHoverEditor} from './HoverEditor';

/**
 * Cleanup - close hover editor if open
 */
export function disposeEditorManager(cy: Core): void {
    closeHoverEditor(cy);
}

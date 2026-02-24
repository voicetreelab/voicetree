import type {Core} from 'cytoscape';

import type {NodeIdAndFilePath, GraphNode} from '@/pure/graph';

import {
    createEditorData,
    type EditorId,
    type FloatingWindowUIData,
    getEditorId,
} from '@/shell/edge/UI-edge/floating-windows/types';

import {
    getOrCreateOverlay,
    registerFloatingWindow,
    unregisterFloatingWindow,
} from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';
import {updateWindowFromZoom} from '@/shell/edge/UI-edge/floating-windows/update-window-from-zoom';

import {type EditorData, vanillaFloatingWindowInstances} from '@/shell/edge/UI-edge/state/UIAppState';

import {CodeMirrorEditorView} from '@/shell/UI/floating-windows/editors/CodeMirrorEditorView';
import {getNodeFromMainToUI} from '@/shell/edge/UI-edge/graph/getNodeFromMainToUI';
import {fromNodeToContentWithWikilinks} from '@/pure/graph/markdown-writing/node_to_markdown';
import {
    addEditor,
    removeEditor as removeEditorFromStore,
} from "@/shell/edge/UI-edge/state/EditorStore";
import {
    modifyNodeContentFromUI
} from "@/shell/edge/UI-edge/floating-windows/editors/modifyNodeContentFromFloatingEditor";
import {markNodeDirty} from "@/shell/UI/cytoscape-graph-ui/graphviz/layout/autoLayout";
import {screenToGraphDimensions, type ScalingStrategy} from "@/pure/graph/floating-windows/floatingWindowScaling";
import {getCyInstance} from "@/shell/edge/UI-edge/state/cytoscape-state";
import {CIRCLE_SIZE} from "@/pure/graph/node-presentation/types";

import { contentAfterTitle, stripMarkdownFormatting } from '@/pure/graph/markdown-parsing/markdown-to-title';
import {setupAutoHeight} from "@/shell/edge/UI-edge/floating-windows/editors/SetupAutoHeight";
import {createWindowChrome} from "@/shell/edge/UI-edge/floating-windows/create-window-chrome";

// =============================================================================
// Card Mode Constants (graph-coordinate base dimensions for each mode)
// =============================================================================

const CARD_DIMENSIONS: { readonly width: number; readonly height: number } = { width: 200, height: 96 };
const EDIT_DIMENSIONS: { readonly width: number; readonly height: number } = { width: 340, height: 280 };
const PINNED_DIMENSIONS: { readonly width: number; readonly height: number } = { width: 420, height: 400 };
const CARD_HOVER_DEBOUNCE_MS: number = 200;

// =============================================================================
// Card Shell Types & Registry
// =============================================================================

/**
 * Data for a card shell — lightweight DOM container without CM6.
 * CM6 mounts lazily on first hover via mountCM6IntoShell().
 */
export interface CardShellData {
    readonly nodeId: string;
    readonly windowElement: HTMLElement;
    readonly contentContainer: HTMLElement;
    readonly editorId: EditorId;
    cm6Mounted: boolean;  // Flipped on first hover
    isPinned: boolean;  // True when in mode-pinned (survives zoom zone transitions)
    editorData: EditorData;  // The backing EditorData (ui populated)
    readonly menuCleanup: (() => void) | undefined;
}

/**
 * Module-level registry of card shells — exported for zoomSync access.
 * Key is nodeId (same as cyNodeId for card shells).
 */
export const activeCardShells: Map<string, CardShellData> = new Map();

// =============================================================================
// Shell Creation (fast path — DOM only, no CM6)
// =============================================================================

/**
 * Create a card shell: DOM-only, no CM6. Fast path (~0.1ms per node).
 * CM6 mounts lazily on first hover via wireShellHoverEvents → mountCM6IntoShell.
 *
 * @param cy - Cytoscape instance
 * @param nodeId - Node ID (used as shell key and position anchor)
 * @param title - Display title for card header
 * @param preview - Preview text for card header
 */
export async function createCardShell(
    cy: Core,
    nodeId: NodeIdAndFilePath,
    title: string,
    preview: string,
): Promise<CardShellData> {
    const settings: { agents?: readonly import('@/pure/settings').AgentConfig[]; contextNodeMaxDistance?: number } = await window.electronAPI!.main.loadSettings();

    const editorData: EditorData = createEditorData({
        contentLinkedToNodeId: nodeId,
        title,
        anchoredToNodeId: undefined,
        initialContent: '',
        resizable: false,
        shadowNodeDimensions: CARD_DIMENSIONS,
    });

    const editorId: EditorId = getEditorId(editorData);

    // Create window chrome with cardMode — produces card-header DOM + .mode-card class
    const ui: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId, {
        cardMode: { title, preview },
        agents: settings.agents ?? [],
        currentDistance: settings.contextNodeMaxDistance ?? 5,
        closeEditor: (): void => {
            destroyCardShell(nodeId);
        },
    });

    const editorWithUI: EditorData = { ...editorData, ui };

    // Position at Cy node — the real graph node IS the anchor
    ui.windowElement.dataset.shadowNodeId = nodeId;

    // Add to overlay and register for zoom/pan sync
    const overlay: HTMLElement = getOrCreateOverlay(cy);
    overlay.appendChild(ui.windowElement);
    registerFloatingWindow(editorId, ui.windowElement);

    // Position immediately — don't wait for next syncTransform RAF
    updateWindowFromZoom(cy, ui.windowElement, cy.zoom());

    const shell: CardShellData = {
        nodeId,
        windowElement: ui.windowElement,
        contentContainer: ui.contentContainer,
        editorId,
        cm6Mounted: false,
        isPinned: false,
        editorData: editorWithUI,
        menuCleanup: ui.menuCleanup,
    };

    // Wire hover/click events for lazy CM6 mounting
    wireShellHoverEvents(shell, cy);

    // Register in shell registry
    activeCardShells.set(nodeId, shell);

    return shell;
}

// =============================================================================
// Lazy CM6 Mounting (on first hover)
// =============================================================================

/**
 * Mount CM6 editor into an existing card shell. Called on first hover.
 * Creates CM6 in the shell's contentContainer, wires autosave, loads content async.
 */
async function mountCM6IntoShell(shell: CardShellData, cy: Core): Promise<void> {
    if (shell.cm6Mounted) return;
    shell.cm6Mounted = true;

    // Create CM6 editor in the shell's content container
    const editor: CodeMirrorEditorView = new CodeMirrorEditorView(
        shell.contentContainer,
        '', // Empty — loaded async
        {
            autosaveDelay: 300,
            darkMode: document.documentElement.classList.contains('dark'),
            nodeId: shell.nodeId as NodeIdAndFilePath,
        }
    );

    // Autosave wiring (onChange only fires for user input, not programmatic setValue)
    editor.onChange((newContent: string): void => {
        void modifyNodeContentFromUI(shell.nodeId as NodeIdAndFilePath, newContent, cy);
    });

    vanillaFloatingWindowInstances.set(shell.editorId, editor);
    setupAutoHeight(shell.windowElement, editor);

    // Load content async (setValue doesn't trigger autosave — not a user event)
    const node: GraphNode = await getNodeFromMainToUI(shell.nodeId as NodeIdAndFilePath);
    if (node) {
        const content: string = fromNodeToContentWithWikilinks(node);
        editor.setValue(content);
    }
}

// =============================================================================
// Shell Destruction (cleanup)
// =============================================================================

/**
 * Destroy a card shell: dispose CM6 if mounted, remove DOM, unregister, remove from registry.
 */
export function destroyCardShell(nodeId: string): void {
    const shell: CardShellData | undefined = activeCardShells.get(nodeId);
    if (!shell) return;

    // Dispose CM6 if mounted
    if (shell.cm6Mounted) {
        const vanillaInstance: { dispose: () => void } | undefined = vanillaFloatingWindowInstances.get(shell.editorId);
        if (vanillaInstance) {
            vanillaInstance.dispose();
            vanillaFloatingWindowInstances.delete(shell.editorId);
        }
    }

    // Run menu cleanup (disposes floating slider)
    if (shell.menuCleanup) {
        shell.menuCleanup();
    }

    // Remove from EditorStore if pinned
    if (shell.isPinned) {
        removeEditorFromStore(shell.editorId);
    }

    // Remove DOM
    shell.windowElement.remove();

    // Unregister from floatingWindowsMap (zoom/pan sync)
    unregisterFloatingWindow(shell.editorId);

    // Restore Cy node visibility (circle was hidden so label doesn't bleed through)
    try {
        const cy: Core = getCyInstance();
        const cyNode: import('cytoscape').CollectionReturnValue = cy.getElementById(nodeId);
        if (cyNode.length > 0) {
            cyNode.style({
                'opacity': 1,
                'events': 'yes',
                'width': CIRCLE_SIZE,
                'height': CIRCLE_SIZE,
                'shape': 'ellipse',
            });
            if (shell.isPinned) {
                markNodeDirty(cy, nodeId);
            }
        }
    } catch {
        // Graph may be disposed during cleanup
    }

    // Remove from shell registry
    activeCardShells.delete(nodeId);
}

// =============================================================================
// Shell Hover Wiring (lazy CM6 + CSS mode transitions)
// =============================================================================

/**
 * Update base dimensions for a card mode transition.
 * Sets dataset.baseWidth/baseHeight (for updateWindowFromZoom) and inline width.
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
 * Sync the real Cy node's dimensions to the card shell's actual rendered size.
 * Waits one frame for the browser to lay out the new dimensions (e.g. after
 * setCardModeDimensions expands width, auto-height determines actual height),
 * then reads offsetWidth/offsetHeight and converts to graph coordinates.
 *
 * Does NOT write back to dataset.baseWidth/baseHeight — those are owned by
 * setCardModeDimensions. This function only updates the Cy node so layout
 * and edge routing see the correct size.
 */
function syncCyNodeSize(cy: Core, nodeId: string, windowElement: HTMLElement): void {
    requestAnimationFrame((): void => {
        const cyNode: import('cytoscape').CollectionReturnValue = cy.getElementById(nodeId);
        if (cyNode.length === 0) return;

        const strategy: ScalingStrategy = windowElement.dataset.usingCssTransform === 'true' ? 'css-transform' : 'dimension-scaling';
        const zoom: number = cy.zoom();
        const graphDimensions: { readonly width: number; readonly height: number } = screenToGraphDimensions(
            { width: windowElement.offsetWidth, height: windowElement.offsetHeight },
            zoom,
            strategy
        );

        cyNode.style({ 'width': graphDimensions.width, 'height': graphDimensions.height });
        markNodeDirty(cy, nodeId);
    });
}

/**
 * Wire hover/click/keyboard events for card shells.
 * Like wireCardHoverEvents but triggers mountCM6IntoShell on first hover.
 *
 * - mouseenter (200ms debounce) → mount CM6 if needed, then .mode-edit
 * - mouseleave → .mode-card (unless pinned)
 * - click → instant mount CM6 + .mode-edit
 * - dblclick → .mode-pinned (register in EditorStore, full editor)
 * - Escape → unpin, return to .mode-card
 */
function wireShellHoverEvents(shell: CardShellData, cy: Core): void {
    const windowElement: HTMLElement = shell.windowElement;
    let hoverTimeout: ReturnType<typeof setTimeout> | null = null;

    // mouseenter (200ms debounce) → mount CM6 if needed, then expand to edit mode
    windowElement.addEventListener('mouseenter', (): void => {
        if (shell.isPinned) return;
        hoverTimeout = setTimeout((): void => {
            void mountCM6IntoShell(shell, cy).then((): void => {
                windowElement.classList.replace('mode-card', 'mode-edit');
                setCardModeDimensions(windowElement, EDIT_DIMENSIONS);
            });
        }, CARD_HOVER_DEBOUNCE_MS);
    });

    // mouseleave → collapse to card mode (unless pinned)
    windowElement.addEventListener('mouseleave', (): void => {
        if (hoverTimeout) { clearTimeout(hoverTimeout); hoverTimeout = null; }
        if (shell.isPinned) return;
        windowElement.classList.replace('mode-edit', 'mode-card');
        setCardModeDimensions(windowElement, CARD_DIMENSIONS);
    });

    // click → instant mount CM6 + edit mode (skip debounce)
    windowElement.addEventListener('click', (): void => {
        if (shell.isPinned) return;
        if (hoverTimeout) { clearTimeout(hoverTimeout); hoverTimeout = null; }
        void mountCM6IntoShell(shell, cy).then((): void => {
            windowElement.classList.replace('mode-card', 'mode-edit');
            setCardModeDimensions(windowElement, EDIT_DIMENSIONS);
        });
    });

    // dblclick → pin (register in EditorStore, full editor size)
    windowElement.addEventListener('dblclick', (): void => {
        if (shell.isPinned) return;
        pinShell(shell, cy);
    });

    // Expand button in hover-edit mode → pin (same action as double-click)
    windowElement.addEventListener('expand-button-pin-request', (): void => {
        if (!shell.isPinned) {
            pinShell(shell, cy);
        }
    });

    // Escape → unpin, return to card mode
    windowElement.addEventListener('keydown', (e: KeyboardEvent): void => {
        if (e.key === 'Escape' && shell.isPinned) {
            shell.isPinned = false;
            windowElement.classList.remove('mode-pinned');
            windowElement.classList.add('mode-card');
            setCardModeDimensions(windowElement, CARD_DIMENSIONS);
            syncCyNodeSize(cy, shell.nodeId, windowElement);
            // Restore shape to ellipse (circle still hidden — card shell covers it)
            const cyNode: import('cytoscape').CollectionReturnValue = cy.getElementById(shell.nodeId);
            if (cyNode.length > 0) {
                cyNode.style({ 'shape': 'ellipse' } as Record<string, unknown>);
            }
            removeEditorFromStore(shell.editorId);
        }
    });
}

// =============================================================================
// Pin Shell (internal helper — shared by wireShellHoverEvents + pinCardShell)
// =============================================================================

/**
 * Transition a card shell to pinned mode: mount CM6, expand to full editor,
 * register in EditorStore, focus.
 */
function pinShell(shell: CardShellData, cy: Core): void {
    shell.isPinned = true;
    // Hide circle (label bleeds through) and change shape to rectangle for correct layout bbox
    const cyNode: import('cytoscape').CollectionReturnValue = cy.getElementById(shell.nodeId);
    if (cyNode.length > 0) {
        cyNode.style({ 'opacity': 0, 'events': 'no', 'shape': 'rectangle' } as Record<string, unknown>);
    }
    void mountCM6IntoShell(shell, cy).then((): void => {
        shell.windowElement.classList.remove('mode-card', 'mode-edit');
        shell.windowElement.classList.add('mode-pinned');
        setCardModeDimensions(shell.windowElement, PINNED_DIMENSIONS);
        syncCyNodeSize(cy, shell.nodeId, shell.windowElement);
        addEditor(shell.editorData);
        const vanillaInstance: { focus?: () => void; dispose: () => void } | undefined = vanillaFloatingWindowInstances.get(shell.editorId);
        vanillaInstance?.focus?.();
    });
}

// =============================================================================
// Public Pin API (programmatic pinning for callers replacing AnchoredEditor)
// =============================================================================

/**
 * Pin a node's CardShell programmatically. If the shell doesn't exist yet,
 * creates it first (used when not in card zone or shell hasn't been mounted).
 *
 * Replaces createAnchoredFloatingEditor — the real Cy node IS the anchor,
 * no separate shadow node needed.
 */
export async function pinCardShell(cy: Core, nodeId: NodeIdAndFilePath): Promise<void> {
    // If shell already exists, just pin it
    const existing: CardShellData | undefined = activeCardShells.get(nodeId);
    if (existing) {
        if (!existing.isPinned) {
            pinShell(existing, cy);
        }
        return;
    }

    // Create shell (gets title/preview from Cy node data)
    const cyNode: import('cytoscape').CollectionReturnValue = cy.getElementById(nodeId);
    if (cyNode.length === 0) return;
    const title: string = (cyNode.data('label') as string | undefined) ?? nodeId;
    const content: string = (cyNode.data('content') as string | undefined) ?? '';
    const preview: string = stripMarkdownFormatting(contentAfterTitle(content)).trim().replace(/\s+/g, ' ').slice(0, 150);

    // Set Cy node dimensions immediately for layout, hide circle (label shows through otherwise),
    // and change shape to rectangle for correct layout bbox.
    // syncCyNodeSize in pinShell will refine width/height based on actual rendered size after async mount
    cyNode.style({
        'width': PINNED_DIMENSIONS.width,
        'height': PINNED_DIMENSIONS.height,
        'opacity': 0,
        'events': 'no',
        'shape': 'rectangle',
    });
    markNodeDirty(cy, nodeId);

    const shell: CardShellData = await createCardShell(cy, nodeId, title, preview);
    pinShell(shell, cy);
}

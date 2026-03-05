import type {Core} from 'cytoscape';
import type cytoscape from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';

import type {NodeIdAndFilePath} from '@/pure/graph';
import {CIRCLE_SIZE} from '@/pure/graph/node-presentation/types';

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
import {updateWindowFromZoom} from '@/shell/edge/UI-edge/floating-windows/update-window-from-zoom';

import {type EditorData, vanillaFloatingWindowInstances,} from '@/shell/edge/UI-edge/state/UIAppState';

import {CodeMirrorEditorView} from '@/shell/UI/floating-windows/editors/CodeMirrorEditorView';
import {getNodeFromMainToUI} from '@/shell/edge/UI-edge/graph/getNodeFromMainToUI';
import {fromNodeToContentWithWikilinks} from '@/pure/graph/markdown-writing/node_to_markdown';
import {getNodeTitle} from '@/pure/graph/markdown-parsing';
import {
    addEditor,
    getEditorByNodeId,
    getEditors,
} from "@/shell/edge/UI-edge/state/EditorStore";
import {
    modifyNodeContentFromUI
} from "@/shell/edge/UI-edge/floating-windows/editors/modifyNodeContentFromFloatingEditor";
import {selectFloatingWindowNode} from "@/shell/edge/UI-edge/floating-windows/select-floating-window-node";
import {setupAutoHeight} from "@/shell/edge/UI-edge/floating-windows/editors/SetupAutoHeight";
import {createWindowChrome} from "@/shell/edge/UI-edge/floating-windows/create-window-chrome";
import {updateShadowNodeDimensions} from "@/shell/edge/UI-edge/floating-windows/setup-resize-observer";
import {markNodeDirty} from "@/shell/UI/cytoscape-graph-ui/graphviz/layout/autoLayout";
import {addRecentlyVisited} from "@/shell/edge/UI-edge/state/RecentlyVisitedStore";

// Re-export from decomposed modules for backwards compatibility
export {isMouseInHoverZone, closeHoverEditor, setupCommandHover} from './HoverEditor';
export {updateFloatingEditors} from './EditorSync';

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
): Promise<EditorData | undefined> {
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

    // Phase 3: Handle traffic light close button click
    // The close button dispatches a custom event that we listen for here
    ui.windowElement.addEventListener('traffic-light-close', (): void => {
        closeEditor(cy, editorWithUI);
    });

    // Add to overlay and register for efficient zoom/pan sync
    const overlay: HTMLElement = getOrCreateOverlay(cy);
    overlay.appendChild(ui.windowElement);
    registerFloatingWindow(editorId, ui.windowElement);

    // Position on real Cy node
    ui.windowElement.dataset.shadowNodeId = nodeId;
    updateWindowFromZoom(cy, ui.windowElement, cy.zoom());

    // Hide Cy circle shape and switch to rectangle for layout bbox
    const cyNode: import('cytoscape').CollectionReturnValue = cy.getElementById(nodeId);
    if (cyNode.length > 0) {
        cyNode.style({
            'background-opacity': 0,
            'border-opacity': 0,
            'outline-opacity': 0,
            'events': 'no',
            'shape': 'rectangle',
        } as Record<string, unknown>);
    }

    // ResizeObserver: sync DOM size → Cy node dimensions for layout
    let resizeObserver: ResizeObserver | undefined;
    if (cyNode.length > 0 && typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver((): void => {
            const oldW: number = cyNode.width();
            const oldH: number = cyNode.height();
            updateShadowNodeDimensions(cyNode, ui.windowElement);
            const dimChanged: boolean = Math.abs(cyNode.width() - oldW) > 1 || Math.abs(cyNode.height() - oldH) > 1;
            if (dimChanged) {
                markNodeDirty(cy, nodeId);
            }
        });
        resizeObserver.observe(ui.windowElement);
    }

    // Attach close handler that restores Cy node and cleans up
    attachCloseHandler(cy, editorWithUI, (): void => {
        cleanupAutoHeight();
        // Disconnect resize observer
        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = undefined;
        }
        // Restore Cy node to circle
        if (cyNode.length > 0) {
            cyNode.style({
                'background-opacity': 1,
                'border-opacity': 1,
                'outline-opacity': 1,
                'events': 'yes',
                'width': CIRCLE_SIZE,
                'height': CIRCLE_SIZE,
                'shape': 'ellipse',
            });
            markNodeDirty(cy, nodeId);
        }
        // Dispose CodeMirror instance
        const vanillaInstance: { dispose: () => void } | undefined = vanillaFloatingWindowInstances.get(editorId);
        if (vanillaInstance) {
            vanillaInstance.dispose();
            vanillaFloatingWindowInstances.delete(editorId);
        }
    });

    // Add to state
    addEditor(editorWithUI);

    // Select the node and track as recently visited
    cy.$(':selected').unselect();
    if (cyNode.length > 0) {
        cyNode.select();
    }
    addRecentlyVisited(nodeId);

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

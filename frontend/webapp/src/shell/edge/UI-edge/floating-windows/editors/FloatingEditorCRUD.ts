import type cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';

import type {GraphDelta, NodeIdAndFilePath} from '@/pure/graph';
import type {Position} from '@/shell/UI/views/IVoiceTreeGraphView';

import {
    createEditorData,
    type EditorData,
    type EditorId,
    type FloatingWindowUIData,
    getEditorId,
    getShadowNodeId,
} from '@/shell/edge/UI-edge/floating-windows/types';

import {
    attachCloseHandler,
    disposeFloatingWindow,
    getCachedZoom,
    getOrCreateOverlay,
} from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';

import {vanillaFloatingWindowInstances,} from '@/shell/edge/UI-edge/state/UIAppState';

import {CodeMirrorEditorView} from '@/shell/UI/floating-windows/editors/CodeMirrorEditorView';
import {createNewEmptyOrphanNodeFromUI} from '@/shell/edge/UI-edge/graph/handleUIActions';
import {getNodeFromMainToUI} from '@/shell/edge/UI-edge/graph/getNodeFromMainToUI';
import {fromNodeToContentWithWikilinks} from '@/pure/graph/markdown-writing/node_to_markdown';
import {getNodeTitle} from '@/pure/graph/markdown-parsing';
import {
    addEditor,
    getEditorByNodeId,
    getEditors,
    getHoverEditor,
    setLastAutoPinnedEditor,
} from "@/shell/edge/UI-edge/state/EditorStore";
import {
    modifyNodeContentFromUI
} from "@/shell/edge/UI-edge/floating-windows/editors/modifyNodeContentFromFloatingEditor";
import {getAppendedSuffix, isAppendOnly} from "@/pure/graph/contentChangeDetection";
import {selectFloatingWindowNode} from "@/shell/edge/UI-edge/floating-windows/select-floating-window-node";
import {anchorToNode} from "@/shell/edge/UI-edge/floating-windows/anchor-to-node";
import {cySmartCenter} from "@/utils/responsivePadding";
import {setupAutoHeight} from "@/shell/edge/UI-edge/floating-windows/editors/SetupAutoHeight";
import {createWindowChrome} from "@/shell/edge/UI-edge/floating-windows/create-window-chrome";
import {attachFullscreenZoom} from "@/shell/edge/UI-edge/floating-windows/fullscreen-zoom";


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
    focusAtEnd: boolean = false
): Promise<EditorData | undefined> {
    // Check if editor already exists for this node
    const existingEditor: O.Option<EditorData> = getEditorByNodeId(nodeId);
    if (O.isSome(existingEditor)) {
        console.log('[createFloatingEditor-v2] Editor already exists for node:', nodeId);
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
        console.log('[createFloatingEditor-v2] Editor created by another path during await:', nodeId);
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
    const ui: FloatingWindowUIData = createWindowChrome(cy, editorData, editorId);

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
        }
    );

    // Setup auto-save with modifyNodeContentFromUI
    // Note: onChange only fires for user input (typing, paste, etc.) - NOT for programmatic setValue() calls
    // This is handled by CodeMirrorEditorView using CM6's isUserEvent("input") check
    editor.onChange((newContent: string): void => {
        void (async (): Promise<void> => {
            console.log('[createFloatingEditor-v2] Saving editor content for node:', nodeId);
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

    // Attach fullscreen button handler - only for anchored editors (they have shadow nodes)
    const fullscreenButton: HTMLButtonElement | null = ui.titleBar.querySelector('.cy-floating-window-fullscreen');
    if (fullscreenButton) {
        if (anchoredToNodeId !== undefined) {
            // Anchored editors have shadow nodes - enable fullscreen zoom
            attachFullscreenZoom(
                cy,
                fullscreenButton,
                getShadowNodeId(editorId),
                false  // Disable ESC key for editors (vim mode conflicts)
            );
        } else {
            // Hover editors have no shadow node - hide the button
            fullscreenButton.style.display = 'none';
        }
    }

    // Add to overlay
    const overlay: HTMLElement = getOrCreateOverlay(cy);
    overlay.appendChild(ui.windowElement);

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
// Close Hover Editor
// =============================================================================

/**
 * Close the current hover editor (editor without anchor)
 */
export function closeHoverEditor(cy: Core): void {
    const hoverEditorOption: O.Option<EditorData> = getHoverEditor();
    if (O.isNone(hoverEditorOption)) return;

    // Restore the node's Cytoscape label
    const nodeId: string = hoverEditorOption.value.contentLinkedToNodeId;
    cy.getElementById(nodeId).removeClass('hover-editor-open');

    console.log('[FloatingEditorManager-v2] Closing command-hover editor');
    closeEditor(cy, hoverEditorOption.value);
}

// =============================================================================
// Open Hover Editor
// =============================================================================

/**
 * Open a hover editor at the given position
 */
async function openHoverEditor(
    cy: Core,
    nodeId: NodeIdAndFilePath,
    nodePos: Position
): Promise<void> {
    // Skip if this node already has an editor open (hover or permanent)
    const existingEditor: O.Option<EditorData> = getEditorByNodeId(nodeId);
    if (O.isSome(existingEditor)) {
        console.log('[HoverEditor-v2] EARLY RETURN - node already has editor:', nodeId);
        return;
    }
    console.log('[HoverEditor-v2] No existing editor, will create new one for:', nodeId);

    // Close any existing hover editor
    closeHoverEditor(cy);

    console.log('[FloatingEditorManager-v2] Creating command-hover editor for node:', nodeId);

    try {
        // Create floating editor with anchoredToNodeId: undefined (hover mode, no shadow node)
        const editor: EditorData | undefined = await createFloatingEditor(
            cy,
            nodeId,
            undefined, // Not anchored - hover mode
            true // focusAtEnd - cursor at end of content
        );

        if (!editor || !editor.ui) {
            console.log('[FloatingEditorManager-v2] Failed to create hover editor');
            return;
        }

        // Set position manually (no shadow node to sync with)
        // Position editor below the node, clearing the node circle icon
        // Store graph position in dataset so updateWindowFromZoom can update on zoom changes
        const HOVER_EDITOR_VERTICAL_OFFSET: number = 18;
        const zoom: number = getCachedZoom();
        const graphX: number = nodePos.x;
        const graphY: number = nodePos.y + HOVER_EDITOR_VERTICAL_OFFSET;

        // Store graph position for zoom updates (hover editors have no shadow node)
        editor.ui.windowElement.dataset.graphX = String(graphX);
        editor.ui.windowElement.dataset.graphY = String(graphY);
        editor.ui.windowElement.dataset.transformOrigin = 'top-center';

        // Apply initial position and transform with scale
        editor.ui.windowElement.style.left = `${graphX * zoom}px`;
        editor.ui.windowElement.style.top = `${graphY * zoom}px`;
        editor.ui.windowElement.style.transformOrigin = 'top center';
        editor.ui.windowElement.style.transform = `translateX(-50%) scale(${zoom})`;

        // Hide the node's Cytoscape label (editor title bar shows the name)
        cy.getElementById(nodeId).addClass('hover-editor-open');

        // Close on click outside
        const handleClickOutside: (e: MouseEvent) => void = (e: MouseEvent): void => {
            if (editor.ui && !editor.ui.windowElement.contains(e.target as Node)) {
                console.log('[CommandHover-v2] Click outside detected, closing editor');
                closeHoverEditor(cy);
                document.removeEventListener('mousedown', handleClickOutside);
            }
        };

        // Add listener after a short delay to prevent immediate closure
        setTimeout((): void => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 100);

    } catch (error) {
        console.error('[FloatingEditorManager-v2] Error creating hover editor:', error);
    }
}

// =============================================================================
// Setup Command Hover
// =============================================================================

/**
 * Setup hover mode (hover to show editor)
 */
export function setupCommandHover(cy: Core): void {
    // Listen for node hover
    cy.on('mouseover', 'node', (event: cytoscape.EventObject): void => {
        void (async (): Promise<void> => {
            console.log('[HoverEditor-v2] GraphNode mouseover');

            const node: cytoscape.NodeSingular = event.target;
            const nodeId: string = node.id();

            // Only open hover editor for markdown nodes (nodes with file extensions)
            // Terminal nodes, shadow nodes, etc. don't have file extensions
            const hasFileExtension: boolean = /\.\w+$/.test(nodeId);
            if (!hasFileExtension) {
                console.log('[HoverEditor-v2] Skipping non-markdown node:', nodeId);
                return;
            }

            // Open hover editor
            await openHoverEditor(cy, nodeId, node.position());
        })();
    });
}

// =============================================================================
// Create Anchored Floating Editor
// =============================================================================

/**
 * Create a floating editor window anchored to a node
 * Creates a child shadow node and anchors the editor to it
 *
 * @param cy - Cytoscape instance
 * @param nodeId - ID of the node to edit
 * @param focusAtEnd - If true, focus editor with cursor at end of content (for new nodes)
 * @param isAutoPin - If true, this is an auto-pinned editor (for new nodes) that will be
 *                    auto-closed when the next new node is created
 */
export async function createAnchoredFloatingEditor(
    cy: Core,
    nodeId: NodeIdAndFilePath,
    focusAtEnd: boolean = false,
    isAutoPin: boolean = false
): Promise<void> {
    try {
        // Early exit if editor already exists - don't close previous auto-pin or set new tracking
        if (O.isSome(getEditorByNodeId(nodeId))) {
            return;
        }

        // Create floating editor window with anchoredToNodeId set
        const editor: EditorData | undefined = await createFloatingEditor(
            cy,
            nodeId,
            nodeId, // Anchor to the same node we're editing
            focusAtEnd
        );

        // Return early if editor already exists
        if (!editor) {
            console.log('[FloatingEditorManager-v2] Editor already exists');
            return;
        }

        // TODO: This tracking is no longer used - auto-close was removed to keep all editors open.
        // Can be cleaned up along with setLastAutoPinnedEditor/getLastAutoPinnedEditor in EditorStore.ts
        if (isAutoPin) {
            setLastAutoPinnedEditor(nodeId);
        }

        // Anchor to node using v2 function
        anchorToNode(cy, editor);

        // TODO: Re-enable zoom for UI-initiated editor creation only.
        // Currently disabled because both UI-created nodes and external filesystem nodes
        // flow through the same file watcher path, so we can't distinguish them here.
        // To fix: either track "pending UI nodes" or have UI path call this directly
        // (with early-exit preventing duplicates from file watcher).
        // See: tues/58_Dae_Fix_Prevent_Duplicate_Auto_Pin_Editors_3.md

    } catch (error) {
        console.error('[FloatingEditorManager-v2] Error creating floating editor:', error);
    }
}

// =============================================================================
// Create Floating Editor for UI-Created Node
// =============================================================================

/**
 * Navigate to editor neighborhood - pans if zoom is comfortable, zooms to 1.0 if not
 */
function navigateToEditorNeighborhood(cy: Core, nodeId: NodeIdAndFilePath, editorId: EditorId): void {
    const shadowNodeId: string = getShadowNodeId(editorId);
    const editorShadowNode: cytoscape.CollectionReturnValue = cy.getElementById(shadowNodeId);
    const contextNode: cytoscape.CollectionReturnValue = cy.getElementById(nodeId);
    const nodesToCenter: cytoscape.CollectionReturnValue = contextNode.length > 0
        ? contextNode.closedNeighborhood().nodes().union(editorShadowNode)
        : cy.collection().union(editorShadowNode);
    cySmartCenter(cy, nodesToCenter);
}

/**
 * Create a floating editor for a node created via UI interaction (hotkey/menu).
 * This is separate from the auto-pin path used for external graph deltas.
 *
 * Key differences from createAnchoredFloatingEditor:
 * - ALWAYS steals focus (user just created the node, they want to type)
 * - NO autopin state logic (editor is independent/permanent)
 * - Does not close previous auto-pinned editors
 * - Pans to editor neighborhood after creation (like terminal spawn)
 *
 * @param cy - Cytoscape instance
 * @param nodeId - ID of the newly created node
 */
export async function createFloatingEditorForUICreatedNode(
    cy: Core,
    nodeId: NodeIdAndFilePath
): Promise<void> {
    try {
        // Early exit if editor already exists
        if (O.isSome(getEditorByNodeId(nodeId))) {
            console.log('[FloatingEditorManager-v2] UI-created node editor already exists:', nodeId);
            return;
        }

        console.log('[FloatingEditorManager-v2] Creating editor for UI-created node:', nodeId);

        // Create floating editor window with focus at end (user wants to type immediately)
        const editor: EditorData | undefined = await createFloatingEditor(
            cy,
            nodeId,
            nodeId, // Anchor to the same node we're editing
            true    // Always focus at end for UI-created nodes
        );

        if (!editor) {
            console.log('[FloatingEditorManager-v2] Failed to create editor for UI-created node');
            return;
        }

        // Anchor to node (creates shadow node for positioning)
        anchorToNode(cy, editor);

        // Navigate to editor neighborhood twice with delays to handle IPC race condition
        // (node may not be fully positioned in Cytoscape yet when this runs)
        const editorId: EditorId = getEditorId(editor);
        setTimeout(() => navigateToEditorNeighborhood(cy, nodeId, editorId), 300);
        setTimeout(() => navigateToEditorNeighborhood(cy, nodeId, editorId), 1200);

    } catch (error) {
        console.error('[FloatingEditorManager-v2] Error creating editor for UI-created node:', error);
    }
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
// Update Floating Editors
// =============================================================================

/**
 * Update floating editors based on graph delta
 * For each node upsert, check if there's an open editor and update its content
 * Editor shows content WITHOUT YAML - uses fromNodeToContentWithWikilinks
 */
export function updateFloatingEditors(cy: Core, delta: GraphDelta): void {
    for (const nodeDelta of delta) {
        if (nodeDelta.type === 'UpsertNode') {
            const nodeId: string = nodeDelta.nodeToUpsert.relativeFilePathIsID;
            const newContent: string = fromNodeToContentWithWikilinks(nodeDelta.nodeToUpsert);

            // Check if there's an open editor for this node
            const editorOption: O.Option<EditorData> = getEditorByNodeId(nodeId);

            if (O.isSome(editorOption)) {
                const editor: EditorData = editorOption.value;
                const editorId: EditorId = getEditorId(editor);

                // Get the editor instance from vanillaFloatingWindowInstances
                const editorInstance: { dispose: () => void; focus?: () => void } | undefined =
                    vanillaFloatingWindowInstances.get(editorId);

                if (editorInstance && 'setValue' in editorInstance && 'getValue' in editorInstance) {
                    const cmEditor: CodeMirrorEditorView = editorInstance as CodeMirrorEditorView;
                    const currentEditorContent: string = cmEditor.getValue();

                    // Only update if content has changed to avoid cursor jumps
                    // Note: setValue() won't trigger onChange - CM6 isUserEvent check filters out programmatic changes
                    if (currentEditorContent !== newContent) {
                        // Check if this is an append-only change (e.g., link addition)
                        // If so, append to current editor content to preserve unsaved user edits
                        if (O.isSome(nodeDelta.previousNode)) {
                            const prevContent: string = fromNodeToContentWithWikilinks(nodeDelta.previousNode.value);
                            if (isAppendOnly(prevContent, newContent)) {
                                const suffix: string = getAppendedSuffix(prevContent, newContent);
                                console.log('[FloatingEditorManager-v2] Appending to editor for node:', nodeId, 'suffix:', suffix);
                                cmEditor.setValue(currentEditorContent + suffix);
                                continue;
                            }
                        }
                        // Full replacement for non-append changes
                        console.log('[FloatingEditorManager-v2] Updating editor content for node:', nodeId);
                        cmEditor.setValue(newContent);
                    }
                }
            }
        } else if (nodeDelta.type === 'DeleteNode') {
            // Handle node deletion - close the editor if open
            const nodeId: string = nodeDelta.nodeId;
            const editorOption: O.Option<EditorData> = getEditorByNodeId(nodeId);

            if (O.isSome(editorOption)) {
                console.log('[FloatingEditorManager-v2] Closing editor for deleted node:', nodeId);
                closeEditor(cy, editorOption.value);
            }
        }
    }
}

// =============================================================================
// Handle Add Node At Position
// =============================================================================

/**
 * Handle adding a node at a specific position
 * Used by ContextMenuService callbacks
 */
export async function handleAddNodeAtPosition(cy: Core, position: Position): Promise<void> {
    try {
        // Pass position directly to Electron - it will save it immediately
        // Editor auto-pinning handled by file watcher in VoiceTreeGraphView
        const nodeId: string = await createNewEmptyOrphanNodeFromUI(position, cy);
        console.log('[FloatingEditorManager-v2] Creating node:', nodeId);
    } catch (error) {
        console.error('[FloatingEditorManager-v2] Error creating standalone node:', error);
    }
}

// =============================================================================
// Dispose (Cleanup)
// =============================================================================

/**
 * Cleanup - close hover editor if open
 */
export function disposeEditorManager(cy: Core): void {
    closeHoverEditor(cy);
}

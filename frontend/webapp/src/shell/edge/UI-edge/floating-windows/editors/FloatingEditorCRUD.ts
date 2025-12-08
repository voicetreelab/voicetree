/**
 * FloatingEditorManager V2 - Fully Functional (No Classes)
 *
 * Uses:
 * - EditorData from types.ts (flat type with derived IDs)
 * - createWindowChrome, anchorToNode, disposeFloatingWindow from cytoscape-floating-windows.ts
 * - addEditor, removeEditor, getEditorByNodeId, getHoverEditor from UIAppState.ts
 *
 * Keeps battle-tested save logic:
 * - awaitingUISavedContent pattern for race condition handling
 * - onChange handler feedback loop prevention
 */

import type cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';

import type { GraphDelta, NodeIdAndFilePath, GraphNode } from '@/pure/graph';
import type { Position } from '@/shell/UI/views/IVoiceTreeGraphView';

import {
    createEditorData,
    getEditorId,
    type EditorData,
    type EditorId,
    type FloatingWindowUIData,
} from '@/shell/edge/UI-edge/floating-windows/types';

import {
    createWindowChrome,
    anchorToNode,
    disposeFloatingWindow,
    attachCloseHandler,
    getOrCreateOverlay,
} from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';

import {
    vanillaFloatingWindowInstances,


} from '@/shell/edge/UI-edge/state/UIAppState';

import { CodeMirrorEditorView } from '@/shell/UI/floating-windows/editors/CodeMirrorEditorView';
import { createNewEmptyOrphanNodeFromUI, modifyNodeContentFromUI } from '@/shell/edge/UI-edge/graph/handleUIActions';
import { getNodeFromMainToUI } from '@/shell/edge/UI-edge/graph/getNodeFromMainToUI';
import { fromNodeToContentWithWikilinks } from '@/pure/graph/markdown-writing/node_to_markdown';
import { getNodeTitle } from '@/pure/graph/markdown-parsing';
import {
    addEditor,
    deleteAwaitingContent,
    getAwaitingContent, getEditorByNodeId, getEditors, getHoverEditor,
    setAwaitingUISavedContent
} from "@/shell/edge/UI-edge/state/EditorStore";

// =============================================================================
// Create Floating Editor
// =============================================================================

/**
 * Create a floating editor window using v2 types
 * Returns EditorData with ui populated, or undefined if editor already exists
 *
 * @param cy - Cytoscape instance
 * @param nodeId - ID of the node to edit (used to fetch content and derive editor ID)
 * @param anchoredToNodeId - Optional node to anchor to (set for anchored, undefined for hover)
 */
export async function createFloatingEditor(
    cy: cytoscape.Core,
    nodeId: NodeIdAndFilePath,
    anchoredToNodeId: NodeIdAndFilePath | undefined
): Promise<EditorData | undefined> {
    // Check if editor already exists for this node
    const existingEditor: O.Option<EditorData> = getEditorByNodeId(nodeId);
    if (O.isSome(existingEditor)) {
        console.log('[createFloatingEditor-v2] Editor already exists for node:', nodeId);
        return undefined;
    }

    // Derive title and content from nodeId
    // Editor shows content WITHOUT YAML frontmatter - YAML is managed separately
    const node: GraphNode = await getNodeFromMainToUI(nodeId);
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
        }
    );

    // Setup auto-save with modifyNodeContentFromUI (keep battle-tested save logic)
    editor.onChange((newContent: string): void => {
        void (async (): Promise<void> => {
            // Skip if this onChange was triggered by setValue (not user typing)
            // This happens when updateFloatingEditors updates editor from external/UI changes
            if (getAwaitingContent(nodeId) === newContent) {
                deleteAwaitingContent(nodeId);
                return;
            }
            // IMPORTANT THE TWO PATHS WE ARE TAKING CARE OF HERE ARE
            // 1. external/UI change -> updateFloatingEditors (set awaiting) -> onChange DONT SAVE, clear awaiting
            // 2. our change (from ui editor typing) -> onChange -> set awaiting -> fs -> updateFloatingEditors DONT SET, clear awaiting

            console.log('[createFloatingEditor-v2] Saving editor content for node:', nodeId);
            // Track this content so we can ignore updateFloatingEditors for our own typed content
            setAwaitingUISavedContent(nodeId, newContent);
            await modifyNodeContentFromUI(nodeId, newContent, cy);
        })();
    });

    // Store vanilla instance for getValue/setValue access (legacy pattern, but needed for updateFloatingEditors)
    vanillaFloatingWindowInstances.set(editorId, editor);

    // Attach close handler that will dispose editor and remove from state
    attachCloseHandler(cy, editorWithUI, (): void => {
        // Additional cleanup: dispose CodeMirror instance
        const vanillaInstance: { dispose: () => void } | undefined = vanillaFloatingWindowInstances.get(editorId);
        if (vanillaInstance) {
            vanillaInstance.dispose();
            vanillaFloatingWindowInstances.delete(editorId);
        }
    });

    // Setup fullscreen button handler
    const fullscreenButton: HTMLButtonElement | null = ui.titleBar.querySelector('.cy-floating-window-fullscreen');
    if (fullscreenButton) {
        fullscreenButton.addEventListener('click', (): void => {
            void editor.toggleFullscreen();
        });
    }

    // Add to overlay
    const overlay: HTMLElement = getOrCreateOverlay(cy);
    overlay.appendChild(ui.windowElement);

    // Add to state
    addEditor(editorWithUI);

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
        console.log('[HoverEditor-v2] Skipping - node already has editor:', nodeId);
        return;
    }

    // Close any existing hover editor
    closeHoverEditor(cy);

    console.log('[FloatingEditorManager-v2] Creating command-hover editor for node:', nodeId);

    try {
        // Create floating editor with anchoredToNodeId: undefined (hover mode, no shadow node)
        const editor: EditorData | undefined = await createFloatingEditor(
            cy,
            nodeId,
            undefined // Not anchored - hover mode
        );

        if (!editor || !editor.ui) {
            console.log('[FloatingEditorManager-v2] Failed to create hover editor');
            return;
        }

        // Set position manually (no shadow node to sync with)
        // Position editor below the node, clearing the node circle icon
        // Use translateX(-50%) for proper horizontal centering regardless of actual width
        const HOVER_EDITOR_VERTICAL_OFFSET: number = 18;
        editor.ui.windowElement.style.left = `${nodePos.x}px`;
        editor.ui.windowElement.style.top = `${nodePos.y + HOVER_EDITOR_VERTICAL_OFFSET}px`;
        editor.ui.windowElement.style.transform = 'translateX(-50%)';

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
 */
export async function createAnchoredFloatingEditor(
    cy: Core,
    nodeId: NodeIdAndFilePath
): Promise<void> {
    try {
        // Create floating editor window with anchoredToNodeId set
        const editor: EditorData | undefined = await createFloatingEditor(
            cy,
            nodeId,
            nodeId // Anchor to the same node we're editing
        );

        // Return early if editor already exists
        if (!editor) {
            console.log('[FloatingEditorManager-v2] Editor already exists');
            return;
        }

        // Anchor to node using v2 function
        anchorToNode(cy, editor);

    } catch (error) {
        console.error('[FloatingEditorManager-v2] Error creating floating editor:', error);
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

                // Check if this is our own typed content coming back - skip to avoid cursor jumps
                const awaiting: string | undefined = getAwaitingContent(nodeId);
                if (awaiting === newContent) {
                    // Exact match - this is our own typed content, skip update
                    console.log('[FloatingEditorManager-v2] Skipping update for our own typed content:', nodeId);
                    deleteAwaitingContent(nodeId);
                    continue;
                }
                if (awaiting) {
                    // Content differs (e.g., wikilink added by UI action) - clear stale awaiting
                    // and proceed to update editor with new content
                    deleteAwaitingContent(nodeId);
                }

                // Get the editor instance from vanillaFloatingWindowInstances
                const editorInstance: { dispose: () => void; focus?: () => void } | undefined =
                    vanillaFloatingWindowInstances.get(editorId);

                if (editorInstance && 'setValue' in editorInstance && 'getValue' in editorInstance) {
                    const cmEditor: CodeMirrorEditorView = editorInstance as CodeMirrorEditorView;

                    // Only update if content has changed to avoid cursor jumps
                    if (cmEditor.getValue() !== newContent) {
                        console.log('[FloatingEditorManager-v2] Updating editor content for node:', nodeId);
                        // Register this content so onChange handler knows it came from setValue, not user typing
                        setAwaitingUISavedContent(nodeId, newContent);
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
        const nodeId: string = await createNewEmptyOrphanNodeFromUI(position, cy);
        await createAnchoredFloatingEditor(cy, nodeId);
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

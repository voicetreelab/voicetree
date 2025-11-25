/**
 * FloatingWindowManager - Deep module for floating window management
 *
 * Minimal public API that hides:
 * - Editor and terminal window creation/lifecycle
 * - Command-hover mode state and interactions
 * - Context menu setup and callbacks
 * - Window chrome creation and mounting
 * - Click-outside handlers
 * - GraphNode creation workflows
 *
 * This class owns all floating window state and operations.
 */

import cytoscape, {type Core} from 'cytoscape';
import {
    anchorToNode,
    createWindowChrome,
    getOrCreateOverlay
} from '@/shell/UI/floating-windows/cytoscape-floating-windows.ts';
import type {Position} from '@/shell/UI/views/IVoiceTreeGraphView.ts';
import type {HotkeyManager} from '@/shell/UI/views/HotkeyManager.ts';
import type {Graph, GraphDelta, NodeIdAndFilePath} from '@/pure/graph';
import {CodeMirrorEditorView} from '@/shell/UI/floating-windows/editors/CodeMirrorEditorView.ts';
import {createNewEmptyOrphanNodeFromUI, modifyNodeContentFromUI} from "@/shell/edge/UI-edge/graph/handleUIActions.ts";
import type {FloatingWindowUIHTMLData} from "@/shell/edge/UI-edge/floating-windows/types.ts";
import {getNodeFromMainToUI} from "@/shell/edge/UI-edge/graph/getNodeFromMainToUI.ts";
import {getVanillaInstance, vanillaFloatingWindowInstances} from "@/shell/edge/UI-edge/state/UIAppState.ts";

/**
 * Function type for getting current graph state
 */
type GetGraphState = () => Graph;

/**
 * Create a floating editor window
 * Returns FloatingWindow object that can be anchored or positioned manually
 * Returns undefined if an editor for this node already exists
 *
 * @param cy - Cytoscape instance
 * @param nodeId - ID of the node to edit (used to fetch content and derive editor ID)
 * @param editorRegistry - Map to register editor ID for external content updates
 * @param awaitingUISavedContent - Map to track content being saved from UI-edge to prevent feedback loop
 */
export async function createFloatingEditor(
    cy: cytoscape.Core,
    nodeId: string,
    editorRegistry: Map<string, string>,
    awaitingUISavedContent: Map<NodeIdAndFilePath, string>
): Promise<FloatingWindowUIHTMLData | undefined> {
    // Derive editor ID from node ID
    const id = `${nodeId}-editor`;

    // Check if already exists in registry (prevents duplicate editors)
    if (editorRegistry.has(nodeId)) {
        console.log('[createFloatingEditor] Editor already exists in registry:', nodeId);
        return undefined;
    }

    // Register in editor registry
    editorRegistry.set(nodeId, id);

    // Always resizable
    const resizable = true;

    // Derive title and content from nodeId
    const node = await getNodeFromMainToUI(nodeId);
    let content = "loading..."
    let title = `${nodeId}`; // fallback to nodeId if node not found
    if (node) {
        content = node.contentWithoutYamlOrLinks;
        title = `${node.nodeUIMetadata.title}`;
    }

    // Get overlay
    const overlay = getOrCreateOverlay(cy);

    // Create window chrome (don't pass onClose, we'll handle it in the cleanup wrapper)
    const {windowElement, contentContainer, titleBar} = createWindowChrome(cy, {
        id,
        title,
        component: 'MarkdownEditor',
        resizable,
        initialContent: content
    });

    // Create CodeMirror editor instance
    const editor = new CodeMirrorEditorView(
        contentContainer,
        content,
        {
            autosaveDelay: 300,
            darkMode: document.documentElement.classList.contains('dark')
        }
    );

    // Setup auto-save with modifyNodeContentFromUI
    editor.onChange((newContent): void => {
        void (async () => {
            console.log('[createAnchoredFloatingEditor] Saving editor content for node:', nodeId);
            // Track this content so we can ignore it when it comes back from filesystem
            awaitingUISavedContent.set(nodeId, newContent);
            await modifyNodeContentFromUI(nodeId, newContent, cy);
        })();
    });

    // Store for cleanup
    vanillaFloatingWindowInstances.set(id, editor);

    // Create cleanup wrapper that handles registry and shadow node cleanup
    const floatingWindow: FloatingWindowUIHTMLData = {
        id,
        windowElement,
        contentContainer,
        titleBar,
        cleanup: () => {
            const vanillaInstance = vanillaFloatingWindowInstances.get(id);
            if (vanillaInstance) {
                vanillaInstance.dispose();
                vanillaFloatingWindowInstances.delete(id);
            }
            windowElement.remove();
            // Clean up mapping when editor is closed
            editorRegistry.delete(nodeId);
            // TODO Remove child shadow node (but we need to pass it through, or have it in the map)
            // if (childShadowNode && childShadowNode.inside()) {
            //     childShadowNode.remove();
            // }
        }
    };

    // Update close button to call floatingWindow.cleanup (so anchorToNode can wrap it)
    const closeButton = titleBar.querySelector('.cy-floating-window-close') as HTMLElement;
    if (closeButton) {
        // Remove old handler and add new one
        const newCloseButton = closeButton.cloneNode(true) as HTMLElement;
        closeButton.parentNode?.replaceChild(newCloseButton, closeButton);
        newCloseButton.addEventListener('click', () => floatingWindow.cleanup());
    }

    // Add to overlay
    overlay.appendChild(windowElement);

    return floatingWindow;
}

/**
 * Manages all floating windows (editors, terminals) for the graph
 */
export class FloatingEditorManager {
    private cy: Core;

    // Hover mode state - store full object so cleanup() can be called
    private currentHoverEditor: FloatingWindowUIHTMLData | null = null;

    // Track which editors are open for each node (for external content updates)
    private nodeIdToEditorId = new Map<NodeIdAndFilePath, string>();

    // Track content that we're saving from the UI-edge to prevent feedback loop
    private awaitingUISavedContent = new Map<NodeIdAndFilePath, string>();

    constructor(
        cy: Core,
        _getGraphState: GetGraphState,
        _hotkeyManager: HotkeyManager
    ) {
        this.cy = cy;
    }

    // ============================================================================
    // PUBLIC API
    // ============================================================================

    /**
     * Setup hover mode (hover to show editor)
     */
    setupCommandHover(): void {
        // Listen for node hover
        this.cy.on('mouseover', 'node', (event) => {
            void (async () => {
                console.log('[HoverEditor] GraphNode mouseover');

                const node = event.target;
                const nodeId = node.id();

                // Only open hover editor for markdown nodes (nodes with file extensions)
                // Terminal nodes, shadow nodes, etc. don't have file extensions
                const hasFileExtension = /\.\w+$/.test(nodeId);
                if (!hasFileExtension) {
                    console.log('[HoverEditor] Skipping non-markdown node:', nodeId);
                    return;
                }

                // Open hover editor
                await this.openHoverEditor(nodeId, node.position());
            })();
        });
    }

    /**
     * Create a floating editor window
     * Creates a child shadow node and anchors the editor to it
     */
    async createAnchoredFloatingEditor(
        nodeId: NodeIdAndFilePath
    ): Promise<void> {
        try {
            // Create floating editor window with parent node and editor registry
            // This will automatically create shadow node, anchor, and handle cleanup
            const floatingWindow = await createFloatingEditor(
                this.cy,
                nodeId,
                this.nodeIdToEditorId,
                this.awaitingUISavedContent
            ); // todo, we can early position the editor and the anchor node with positionChild logic

            // Return early if editor already exists
            if (!floatingWindow) {
                console.log('[FloatingWindowManager] Editor already exists');
                return;
            }

            anchorToNode(this.cy, floatingWindow, nodeId, {
                isFloatingWindow: true,
                isShadowNode: true,
                laidOut: false
            });


        } catch (error) {
            console.error('[FloatingWindowManager] Error creating floating editor:', error);
        }
    }


    /**
     * Close all open floating editors
     * Called when graph is cleared
     */
    closeAllEditors(): void {
        this.nodeIdToEditorId.clear();
    }

    /**
     * Update floating editors based on graph delta
     * For each node upsert, check if there's an open editor and update its content
     */
    updateFloatingEditors(delta: GraphDelta): void {
        for (const nodeDelta of delta) {
            if (nodeDelta.type === 'UpsertNode') {
                const nodeId = nodeDelta.nodeToUpsert.relativeFilePathIsID;
                const newContent = nodeDelta.nodeToUpsert.contentWithoutYamlOrLinks;
                const editorId = this.nodeIdToEditorId.get(nodeId);

                if (editorId) {
                    // Check if this is our own save coming back from the filesystem
                    const awaiting = this.awaitingUISavedContent.get(nodeId);
                    if (awaiting === newContent) {
                        console.log('[FloatingWindowManager] Ignoring our own save for node:', nodeId);
                        this.awaitingUISavedContent.delete(nodeId);
                        // TODO
                        //    Edge Case to Be Aware Of
                        //
                        //   1. Very Slow Filesystem (>600ms latency)
                        //   If filesystem takes longer than the debounce interval, you could get:
                        //   - Save "A" → store "A"
                        //   - Save "AB" → store "AB" (overwrites)
                        //   - FS event "A" arrives late → doesn't match "AB" → might update
                        //   incorrectly
                        continue;
                    }

                    // Get the editor instance from vanillaFloatingWindowInstances
                    const editorInstance = getVanillaInstance(editorId);

                    if (editorInstance && 'setValue' in editorInstance && 'getValue' in editorInstance) {
                        const editor = editorInstance as CodeMirrorEditorView;

                        // Only update if content has changed to avoid cursor jumps
                        if (editor.getValue() !== newContent) {
                            console.log('[FloatingWindowManager] Updating editor content for node:', nodeId);
                            editor.setValue(newContent);
                            // Clean up the map entry when applying external changes
                            this.awaitingUISavedContent.delete(nodeId);
                        }
                    }
                }
            } else if (nodeDelta.type === 'DeleteNode') {
                // Handle node deletion - close the editor if open
                const nodeId = nodeDelta.nodeId;
                const editorId = this.nodeIdToEditorId.get(nodeId);

                if (editorId) {
                    console.log('[FloatingWindowManager] Closing editor for deleted node:', nodeId);
                    // Close the editor by removing its shadow node
                    const shadowNode = this.cy.$(`#${editorId}`);
                    if (shadowNode.length > 0) {
                        shadowNode.remove();
                    }
                    this.nodeIdToEditorId.delete(nodeId);
                }
            }
        }
    }

    /**
     * Cleanup
     */
    dispose(): void {
        // Close hover editor if open
        this.closeHoverEditor();
        // Note: HotkeyManager disposal is handled by VoiceTreeGraphView
    }

    // ============================================================================
    // PRIVATE HELPERS
    // ============================================================================

    private async openHoverEditor(
        nodeId: string,
        nodePos: Position
    ): Promise<void> {
        // Skip if this node already has an editor open (hover or permanent)
        if (this.nodeIdToEditorId.has(nodeId)) {
            console.log('[HoverEditor] Skipping - node already has editor:', nodeId);
            return;
        }

        // Close any existing hover editor
        this.closeHoverEditor();

        console.log('[FloatingWindowManager] Creating command-hover editor for node:', nodeId);

        try {
            // Create floating editor (same ID whether hover or anchored - mutually exclusive)
            const floatingWindow = await createFloatingEditor(
                this.cy,
                nodeId,
                this.nodeIdToEditorId,
                this.awaitingUISavedContent
            );

            if (!floatingWindow) {
                console.log('[FloatingWindowManager] Failed to create hover editor');
                return;
            }

            // Set position manually (no shadow node to sync with)
            floatingWindow.windowElement.style.left = `${nodePos.x + 50}px`;
            floatingWindow.windowElement.style.top = `${nodePos.y}px`;

            // Close on click outside
            const handleClickOutside = (e: MouseEvent) => {
                if (!floatingWindow.windowElement.contains(e.target as Node)) {
                    console.log('[CommandHover] Click outside detected, closing editor');
                    this.closeHoverEditor();
                    document.removeEventListener('mousedown', handleClickOutside);
                }
            };

            // Add listener after a short delay to prevent immediate closure
            setTimeout(() => {
                document.addEventListener('mousedown', handleClickOutside);
            }, 100);

            // Store reference
            this.currentHoverEditor = floatingWindow;
        } catch (error) {
            console.error('[FloatingWindowManager] Error creating hover editor:', error);
        }
    }

    private closeHoverEditor(): void {
        if (!this.currentHoverEditor) return;

        console.log('[FloatingWindowManager] Closing command-hover editor');
        this.currentHoverEditor.cleanup();
        this.currentHoverEditor = null;
    }

    /**
     * Handle adding a node at a specific position
     * Made public for use by ContextMenuService callbacks
     */
    async handleAddNodeAtPosition(position: Position): Promise<void> {
        try {
            // Pass position directly to Electron - it will save it immediately
            const nodeId = await createNewEmptyOrphanNodeFromUI(position, this.cy);
            await this.createAnchoredFloatingEditor(nodeId);
            console.log('[FloatingWindowManager] Creating node:', nodeId);
        } catch (error) {
            console.error('[FloatingWindowManager] Error creating standalone node:', error);
        }
    }

    // ============================================================================
    // HELPER METHODS - Data access from functional graph
    // ============================================================================

    /**
     * Get absolute file path for a node ID
     * Constructs path from vaultPath + nodeId.md
     */

}


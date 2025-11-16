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

import {type Core} from 'cytoscape';
import {
    createFloatingEditor,
    createFloatingTerminal,
    anchorToNode,
    getVanillaInstance,
    createWindowChrome,
    getOrCreateOverlay
} from '@/shell/UI/cytoscape-graph-ui/extensions/cytoscape-floating-windows';
import type {Position} from './IVoiceTreeGraphView.ts';
import type {HotkeyManager} from './HotkeyManager.ts';
import type {Graph, GraphDelta, NodeId} from '@/pure/graph';
import {nodeIdToFilePathWithExtension} from '@/pure/graph/markdown-parsing';
import type {CodeMirrorEditorView} from '@/shell/UI/floating-windows/CodeMirrorEditorView.ts';
import {createNewEmptyOrphanNodeFromUI} from "@/shell/edge/UI-edge/graph/handleUIActions.ts";
import type {Settings} from '@/pure/settings/types.ts';

/**
 * Function type for getting current graph state
 */
type GetGraphState = () => Graph;

/**
 * Manages all floating windows (editors, terminals) for the graph
 */
export class FloatingWindowManager {
    private cy: Core;
    private hotkeyManager: HotkeyManager;

    // Command-hover mode state
    private commandKeyHeld = false;
    private currentHoverEditor: HTMLElement | null = null;

    // Track which editors are open for each node (for external content updates)
    private nodeIdToEditorId = new Map<NodeId, string>();

    // Track content that we're saving from the UI-edge to prevent feedback loop
    private awaitingUISavedContent = new Map<NodeId, string>();

    constructor(
        cy: Core,
        _getGraphState: GetGraphState,
        hotkeyManager: HotkeyManager
    ) {
        this.cy = cy;
        this.hotkeyManager = hotkeyManager;

        // Setup settings editor listener
        window.addEventListener('openSettings', () => {
            void this.createSettingsEditor();
        });
    }

    // ============================================================================
    // PUBLIC API
    // ============================================================================

    /**
     * Setup command-hover mode (Cmd+hover to show editor)
     */
    setupCommandHover(): void {
        // Track Command/Ctrl key state via HotkeyManager
        this.hotkeyManager.onModifierChange('Meta', (held: boolean) => {
            console.log('[CommandHover] Meta key', held ? 'pressed' : 'released');
            this.commandKeyHeld = held;
        });

        this.hotkeyManager.onModifierChange('Control', (held: boolean) => {
            console.log('[CommandHover] Control key', held ? 'pressed' : 'released');
            this.commandKeyHeld = held;
        });

        // Listen for node hover when command is held
        this.cy.on('mouseover', 'node', (event) => {
            void (async () => {
                console.log('[CommandHover] GraphNode mouseover, commandKeyHeld:', this.commandKeyHeld);
                if (!this.commandKeyHeld) return;

                const node = event.target;
                const nodeId = node.id();

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
        nodeId: NodeId
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

            anchorToNode(floatingWindow, nodeId, {
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
                const newContent = nodeDelta.nodeToUpsert.content;
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

                    // Get the editor instance from vanillaInstances
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
     * Create a floating terminal window
     */
    createFloatingTerminal(
        nodeId: string,
        nodeMetadata: { id: string; name: string; filePath?: string },
        nodePos: Position
    ): void {
        const terminalId = `terminal-${nodeId}`;
        console.log('[FloatingWindowManager] Creating floating terminal:', terminalId);

        // Check if already exists
        const existing = this.cy.nodes(`#${terminalId}`);
        if (existing && existing.length > 0) {
            console.log('[FloatingWindowManager] Terminal already exists');
            return;
        }

        // Check if parent node exists
        const parentNode = this.cy.getElementById(nodeId);
        const parentNodeExists = parentNode.length > 0;

        try {
            // Create floating terminal window
            const floatingWindow = createFloatingTerminal(this.cy, {
                id: terminalId,
                title: `Terminal: ${nodeId}`, //todo parent node.data.title
                nodeMetadata: nodeMetadata,
                resizable: true
            });

            if (parentNodeExists) {
                // Anchor to parent node
                anchorToNode(floatingWindow, nodeId, {
                    isFloatingWindow: true,
                    isShadowNode: true,
                    windowType: 'terminal',
                    laidOut: false
                });
            } else {
                // Manual positioning if no parent
                floatingWindow.windowElement.style.left = `${nodePos.x + 100}px`;
                floatingWindow.windowElement.style.top = `${nodePos.y}px`;
            }
        } catch (error) {
            console.error('[FloatingWindowManager] Error creating floating terminal:', error);
        }
    }

    /**
     * Create a floating settings editor window
     * Loads settings from IPC and allows editing them as JSON
     */
    async createSettingsEditor(): Promise<void> {
        const settingsId = 'settings-editor';

        try {
            // Check if already exists
            const existing = document.getElementById(`window-${settingsId}`);
            if (existing) {
                console.log('[FloatingWindowManager] Settings editor already exists');
                return;
            }

            // Check if electronAPI is available
            if (!window.electronAPI) {
                console.error('[FloatingWindowManager] electronAPI not available');
                return;
            }

            // Load current settings from IPC
            const settings = await window.electronAPI.main.loadSettings() as Settings;
            const settingsJson = JSON.stringify(settings, null, 2);

            // Get overlay
            const overlay = getOrCreateOverlay(this.cy);

            // Create window chrome with CodeMirror editor
            const {windowElement, contentContainer} = createWindowChrome(this.cy, {
                id: settingsId,
                title: 'Types',
                component: 'MarkdownEditor',
                resizable: true,
                initialContent: settingsJson
            });

            // Create CodeMirror editor instance for JSON editing
            const {CodeMirrorEditorView} = await import('@/shell/UI/floating-windows/CodeMirrorEditorView.ts');
            const editor = new CodeMirrorEditorView(
                contentContainer,
                settingsJson,
                {
                    autosaveDelay: 300
                }
            );

            // Setup auto-save with validation
            editor.onChange((newContent: string) => {
                void (async () => {
                    try {
                        // Parse JSON to validate
                        const parsedSettings = JSON.parse(newContent) as Settings;

                        // Save to IPC
                        if (window.electronAPI) {
                            await window.electronAPI.main.saveSettings(parsedSettings);
                            console.log('[FloatingWindowManager] Settings saved successfully');
                        }
                    } catch (error) {
                        // Show error to user for invalid JSON
                        console.error('[FloatingWindowManager] Invalid JSON in settings:', error);
                        // Could add visual error indicator here
                    }
                })();
            });

            // Store editor instance for cleanup
            const vanillaInstances = new Map<string, { dispose: () => void }>();
            vanillaInstances.set(settingsId, editor);

            // Position window in center of current viewport (same as backup terminal)
            const cy = this.cy;
            const pan = cy.pan();
            const zoom = cy.zoom();
            const centerX = (cy.width() / 2 - pan.x) / zoom;
            const centerY = (cy.height() / 2 - pan.y) / zoom;

            const windowWidth = 600;
            const windowHeight = 400;
            windowElement.style.left = `${centerX - windowWidth / 2}px`;
            windowElement.style.top = `${centerY - windowHeight / 2}px`;
            windowElement.style.width = `${windowWidth}px`;
            windowElement.style.height = `${windowHeight}px`;

            // Add to overlay
            overlay.appendChild(windowElement);

            // Setup close button cleanup
            const closeButton = windowElement.querySelector('.cy-floating-window-close') as HTMLElement;
            if (closeButton) {
                closeButton.addEventListener('click', () => {
                    editor.dispose();
                    vanillaInstances.delete(settingsId);
                    windowElement.remove();
                });
            }

            console.log('[FloatingWindowManager] Types editor created successfully');
        } catch (error) {
            console.error('[FloatingWindowManager] Failed to create settings editor:', error);
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
            this.currentHoverEditor = floatingWindow.windowElement;
        } catch (error) {
            console.error('[FloatingWindowManager] Error creating hover editor:', error);
        }
    }

    private closeHoverEditor(): void {
        if (!this.currentHoverEditor) return;

        console.log('[FloatingWindowManager] Closing command-hover editor');
        this.currentHoverEditor.remove();
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
    async getFilePathForNode(nodeId: NodeId): Promise<string | undefined> {
        const status = await window.electronAPI?.main.getWatchStatus();
        const vaultPath = status?.directory;
        if (!vaultPath) {
            console.warn('[FloatingWindowManager] No vault path available');
            return undefined;
        }

        const filename = nodeIdToFilePathWithExtension(nodeId);
        return `${vaultPath}/${filename}`;
    }
}

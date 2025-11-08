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

import type {Core, NodeSingular} from 'cytoscape';
import {
    addFloatingWindow,
    createWindowChrome,
    getOrCreateOverlay,
    getVanillaInstance,
    mountComponent
} from '@/graph-core/extensions/cytoscape-floating-windows';
import type {Position} from './IVoiceTreeGraphView';
import type {HotkeyManager} from './HotkeyManager';
import type {Graph, GraphDelta, NodeId} from '@/functional_graph/pure/types';
import {nodeIdToFilePathWithExtension} from '@/functional_graph/pure/markdown_parsing/filename-utils';
import {modifyNodeContentFromUI} from "@/functional_graph/shell/UI/handleUIActions.ts";
import {getNodeFromUI} from "@/functional_graph/shell/UI/getNodeFromUI.ts";
import type {CodeMirrorEditorView} from '@/floating-windows/CodeMirrorEditorView';

/**
 * Function type for getting current graph state
 */
type GetGraphState = () => Graph;

/**
 * Function type for getting vault path
 */
type GetVaultPath = () => string | undefined;

/**
 * Manages all floating windows (editors, terminals) for the graph
 */
export class FloatingWindowManager {
  private cy: Core;
  private getGraphState: GetGraphState;
  private getVaultPath: GetVaultPath;
  private hotkeyManager: HotkeyManager;

  // Command-hover mode state
  private commandKeyHeld = false;
  private currentHoverEditor: HTMLElement | null = null;

  // Store positions for newly created nodes (before they're in the graph)
  private pendingPositions = new Map<string, Position>();

  // Track which editors are open for each node (for external content updates)
  private nodeIdToEditorId = new Map<NodeId, string>();

  constructor(
    cy: Core,
    getGraphState: GetGraphState,
    getVaultPath: GetVaultPath,
    hotkeyManager: HotkeyManager
  ) {
    this.cy = cy;
    this.getGraphState = getGraphState;
    this.getVaultPath = getVaultPath;
    this.hotkeyManager = hotkeyManager;
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
      console.log('[CommandHover] GraphNode mouseover, commandKeyHeld:', this.commandKeyHeld);
      if (!this.commandKeyHeld) return;

      const node = event.target;
      const nodeId = node.id();

      // Get node content and file path
      const content = this.getContentForNode(nodeId);
      const filePath = this.getFilePathForNode(nodeId);

      console.log('[CommandHover] content:', !!content, 'filePath:', filePath);

      if (!content || !filePath) return;

      // Open hover editor
      this.openHoverEditor(nodeId, filePath, content, node.position());
    });
  }

  /**
   * Create a floating editor window
   */
  async createFloatingEditor(
      cyNode: NodeSingular,
  ): Promise<void> {
      const nodeId = cyNode.id();
      const node = await getNodeFromUI(nodeId);
      const content = node.content;
      const nodePos = cyNode.position(); // todo, floatingWindow node should use same node creation logic ?

    const editorId = `editor-${nodeId}`;
    console.log('[FloatingWindowManager] Creating floating editor:', editorId);

    // Check if already exists
    const existing = this.cy.nodes(`#${editorId}`);
    if (existing && existing.length > 0) {
      console.log('[FloatingWindowManager] Editor already exists');
      return;
    }

    // Register mapping from node ID to editor ID for content updates
    this.nodeIdToEditorId.set(nodeId, editorId);

    try {
      addFloatingWindow(this.cy, {
        id: editorId,
        component: 'MarkdownEditor',
        title: `Editor: ${nodeId}`,
        position: {
          x: nodePos.x,
          y: nodePos.y + 50
        },
        nodeData: {
          isFloatingWindow: true,
          isShadowNode: true,
          parentNodeId: nodeId,
          laidOut: false
        },
        resizable: true,
        initialContent: content,
        onSave: async (newContent: string) => {
          console.log('[FloatingWindowManager] Saving editor content');
          await modifyNodeContentFromUI(nodeId, newContent);
        },
        onClose: () => {
          // Clean up mapping when editor is closed
          this.nodeIdToEditorId.delete(nodeId);
        }
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
          // Get the editor instance from vanillaInstances
          const editorInstance = getVanillaInstance(editorId);

          if (editorInstance && 'setValue' in editorInstance && 'getValue' in editorInstance) {
            const editor = editorInstance as CodeMirrorEditorView;

            // Only update if content has changed to avoid cursor jumps
            if (editor.getValue() !== newContent) {
              console.log('[FloatingWindowManager] Updating editor content for node:', nodeId);
              editor.setValue(newContent);
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
    const parentNodeExists = this.cy.getElementById(nodeId).length > 0;

    const nodeData: Record<string, unknown> = {
      isFloatingWindow: true,
      isShadowNode: true,
      laidOut: false
    };

    if (parentNodeExists) {
      nodeData.parentNodeId = nodeId;
    }

    try {
      addFloatingWindow(this.cy, {
        id: terminalId,
        component: 'Terminal',
        title: `Terminal: ${nodeId}`,
        position: {
          x: nodePos.x + 100,
          y: nodePos.y
        },
        nodeData,
        resizable: true,
        nodeMetadata: nodeMetadata
      });
    } catch (error) {
      console.error('[FloatingWindowManager] Error creating floating terminal:', error);
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

  private openHoverEditor(
    nodeId: string,
    filePath: string,
    content: string,
    nodePos: Position
  ): void {
    // Close any existing hover editor
    this.closeHoverEditor();

    const hoverId = `hover-${nodeId}`;
    console.log('[FloatingWindowManager] Creating command-hover editor:', hoverId);

    try {
      // Get overlay
      const overlay = getOrCreateOverlay(this.cy);

      // Create window chrome WITHOUT shadow node
      const { windowElement, contentContainer } = createWindowChrome(
        this.cy,
        {
          id: hoverId,
          component: 'MarkdownEditor',
          title: `Hover: ${nodeId}`,
          position: {
            x: nodePos.x + 50,
            y: nodePos.y
          },
          initialContent: content,
          onSave: async (newContent: string) => {
            console.log('[FloatingWindowManager] Saving hover editor content');
            if (window.electronAPI?.saveFileContent) {
              const result = await window.electronAPI.saveFileContent(filePath, newContent);
              if (!result.success) {
                throw new Error(result.error || 'Failed to save file');
              }
            } else {
              throw new Error('Save functionality not available');
            }
          }
        },
        undefined  // No shadow node!
      );

      // Add to overlay
      overlay.appendChild(windowElement);

      // Set position manually (no shadow node to sync with)
      windowElement.style.left = `${nodePos.x + 50}px`;
      windowElement.style.top = `${nodePos.y}px`;

      // Mount the component
      mountComponent(contentContainer, 'MarkdownEditor', hoverId, {
        id: hoverId,
        component: 'MarkdownEditor',
        title: `Hover: ${nodeId}`,
        initialContent: content,
        onSave: async (newContent: string) => {
          if (window.electronAPI?.saveFileContent) {
            await window.electronAPI.saveFileContent(filePath, newContent);
          }
        }
      });

      // Close on click outside
      const handleClickOutside = (e: MouseEvent) => {
        if (!windowElement.contains(e.target as Node)) {
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
      this.currentHoverEditor = windowElement;
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
      if (!window.electronAPI?.createStandaloneNode) {
        console.error('[FloatingWindowManager] Electron API not available');
        return;
      }

      // Pass position directly to Electron - it will save it immediately
      const result = await window.electronAPI.createStandaloneNode(position);
      if (result.success && result.nodeId && result.filePath) {
        console.log('[FloatingWindowManager] Successfully created standalone node:', result.nodeId);

        // Store position for when node appears in graph
        this.storePosition(result.filePath, position);

        // Extract node ID from file path (basename without .md)
        const newNodeId = this.extractNodeIdFromPath(result.filePath);

        // Wait for node to be added by file watcher to functional graph
        const waitForNode = (attempts = 0, maxAttempts = 100): void => {
          if (!this.cy) return;

          const cy = this.cy;
          const node = cy.getElementById(newNodeId);

          if (node.length > 0) {
            // GraphNode found, open editor
            this.createFloatingEditor(node);
          } else if (attempts < maxAttempts) {
            setTimeout(() => waitForNode(attempts + 1, maxAttempts), 100);
          } else {
            console.error('[FloatingWindowManager] Timeout waiting for node');
          }
        };

        waitForNode();
      } else {
        console.error('[FloatingWindowManager] Failed to create standalone node:', result.error);
      }
    } catch (error) {
      console.error('[FloatingWindowManager] Error creating standalone node:', error);
    }
  }

  // ============================================================================
  // HELPER METHODS - Data access from functional graph
  // ============================================================================

  /**
   * Get markdown content for a node ID from functional graph
   */
  getContentForNode(nodeId: NodeId): string | undefined {
    const graph = this.getGraphState();
    const node = graph.nodes[nodeId];
    return node?.content;
  }

  /**
   * Get absolute file path for a node ID
   * Constructs path from vaultPath + nodeId.md
   */
  getFilePathForNode(nodeId: NodeId): string | undefined {
    const vaultPath = this.getVaultPath();
    if (!vaultPath) {
      console.warn('[FloatingWindowManager] No vault path available');
      return undefined;
    }

    const filename = nodeIdToFilePathWithExtension(nodeId);
    return `${vaultPath}/${filename}`;
  }

  /**
   * Store a position for a file (used when creating nodes at specific positions)
   */
  private storePosition(filePath: string, position: Position): void {
    const filename = filePath.split('/').pop() || filePath;
    this.pendingPositions.set(filename, position);
  }

  /**
   * Extract node ID from file path (basename without .md)
   *
   * todo: This uses basename-only which is inconsistent with the functional graph's
   * path-preserving approach. This should be refactored to handle relative paths.
   * For now keeping basename to avoid breaking existing behavior until full refactor.
   */
  private extractNodeIdFromPath(filePath: string): NodeId {
    let id = filePath.replace(/\.md$/i, '');
    const lastSlash = id.lastIndexOf('/');
    if (lastSlash >= 0) {
      id = id.substring(lastSlash + 1);
    }
    return id;
  }
}

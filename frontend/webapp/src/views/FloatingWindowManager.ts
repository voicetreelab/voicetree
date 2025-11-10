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
    createFloatingEditor,
    createFloatingTerminal,
    anchorToNode,
    getVanillaInstance
} from '@/graph-core/extensions/cytoscape-floating-windows';
import type {Position} from './IVoiceTreeGraphView';
import type {HotkeyManager} from './HotkeyManager';
import type {Graph, GraphDelta, NodeId} from '@/functional_graph/pure/types';
import {nodeIdToFilePathWithExtension} from '@/functional_graph/pure/markdown_parsing/filename-utils';
import {getNodeFromUI} from "@/functional_graph/shell/UI/getNodeFromUI.ts";
import type {CodeMirrorEditorView} from '@/floating-windows/CodeMirrorEditorView';

/**
 * Function type for getting current graph state
 */
type GetGraphState = () => Graph;

/**
 * Manages all floating windows (editors, terminals) for the graph
 */
export class FloatingWindowManager {
  private cy: Core;
  private getGraphState: GetGraphState;
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
    hotkeyManager: HotkeyManager
  ) {
    this.cy = cy;
    this.getGraphState = getGraphState;
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
    this.cy.on('mouseover', 'node', async (event) => {
      console.log('[CommandHover] GraphNode mouseover, commandKeyHeld:', this.commandKeyHeld);
      if (!this.commandKeyHeld) return;

      const node = event.target;
      const nodeId = node.id();

      // Get node content
      const content = this.getContentForNode(nodeId);

      console.log('[CommandHover] content:', !!content);

      if (!content) return;

      // Open hover editor
      this.openHoverEditor(nodeId, content, node.position());
    });
  }

  /**
   * Create a floating editor window
   */
  async createAnchoredFloatingEditor(
      cyNode: NodeSingular,
  ): Promise<void> {
      const nodeId = cyNode.id();
      const node = await getNodeFromUI(nodeId);
      const content = node.content;

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
      // Create floating editor window
      const floatingWindow = createFloatingEditor(this.cy, {
        id: editorId,
        title: `Editor: ${nodeId}`,
        content: content,
        nodeId: nodeId,
        onClose: () => {
          // Clean up mapping when editor is closed
          this.nodeIdToEditorId.delete(nodeId);
        },
        resizable: true
      });

      // Anchor to parent node
      anchorToNode(floatingWindow, cyNode, {
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
    const parentNode = this.cy.getElementById(nodeId);
    const parentNodeExists = parentNode.length > 0;

    try {
      // Create floating terminal window
      const floatingWindow = createFloatingTerminal(this.cy, {
        id: terminalId,
        title: `Terminal: ${nodeId}`,
        nodeMetadata: nodeMetadata,
        resizable: true
      });

      if (parentNodeExists) {
        // Anchor to parent node
        anchorToNode(floatingWindow, parentNode, {
          isFloatingWindow: true,
          isShadowNode: true,
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
    content: string,
    nodePos: Position
  ): void {
    // Close any existing hover editor
    this.closeHoverEditor();

    const hoverId = `hover-${nodeId}`;
    console.log('[FloatingWindowManager] Creating command-hover editor:', hoverId);

    try {
      // Create floating editor (no anchoring)
      const floatingWindow = createFloatingEditor(this.cy, {
        id: hoverId,
        title: `Hover: ${nodeId}`,
        content: content, // derivable from nodeId
        nodeId: nodeId
      });

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
            this.createAnchoredFloatingEditor(node);
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
  async getFilePathForNode(nodeId: NodeId): Promise<string | undefined> {
    const status = await window.electronAPI?.getWatchStatus();
    const vaultPath = status?.directory;
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

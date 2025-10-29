/**
 * FloatingWindowManager - Deep module for floating window management
 *
 * Minimal public API that hides:
 * - Editor and terminal window creation/lifecycle
 * - Command-hover mode state and interactions
 * - Context menu setup and callbacks
 * - Window chrome creation and mounting
 * - Click-outside handlers
 * - Node creation workflows
 *
 * This class owns all floating window state and operations.
 */

import type { CytoscapeCore } from '@/graph-core';
import type { NodeSingular } from 'cytoscape';
import { createWindowChrome, getOrCreateOverlay, mountComponent } from '@/graph-core/extensions/cytoscape-floating-windows';
import type { Position } from './IVoiceTreeGraphView';
import type { FileEventManager } from './FileEventManager';

// Helper function to normalize file ID
// 'concepts/introduction.md' -> 'introduction'
function normalizeFileId(filename: string): string {
  let id = filename.replace(/\.md$/i, '');
  const lastSlash = id.lastIndexOf('/');
  if (lastSlash >= 0) {
    id = id.substring(lastSlash + 1);
  }
  return id;
}

/**
 * Manages all floating windows (editors, terminals) for the graph
 */
export class FloatingWindowManager {
  private cy: CytoscapeCore;
  private fileEventManager: FileEventManager;

  // Command-hover mode state
  private commandKeyHeld = false;
  private currentHoverEditor: HTMLElement | null = null;

  // Terminal navigation state
  private currentTerminalIndex = 0;

  // Bound event handlers for cleanup
  private keyDownHandler?: (e: KeyboardEvent) => void;
  private keyUpHandler?: (e: KeyboardEvent) => void;

  constructor(cy: CytoscapeCore, fileEventManager: FileEventManager) {
    this.cy = cy;
    this.fileEventManager = fileEventManager;
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Setup context menu for node interactions
   */
  setupContextMenu(): void {
    this.cy.enableContextMenu({
      onOpenEditor: (nodeId: string) => {
        const content = this.fileEventManager.getContentForNode(nodeId);
        const filePath = this.fileEventManager.getFilePathForNode(nodeId);

        if (content && filePath) {
          const node = this.cy.getCore().getElementById(nodeId);
          if (node.length > 0) {
            const pos = node.position();
            this.createFloatingEditor(nodeId, filePath, content, pos);
          }
        }
      },
      onExpandNode: (node: NodeSingular) => {
        const nodeId = node.id();
        console.log('[FloatingWindowManager] Expanding node:', nodeId);
        this.createNewChildNode(nodeId);
      },
      onDeleteNode: async (node: NodeSingular) => {
        const nodeId = node.id();
        const filePath = this.fileEventManager.getFilePathForNode(nodeId);

        if (filePath && (window as any).electronAPI?.deleteFile) {
          if (!confirm(`Are you sure you want to delete "${nodeId}"? This will move the file to trash.`)) {
            return;
          }

          try {
            const result = await (window as any).electronAPI.deleteFile(filePath);
            if (result.success) {
              // FileEventManager will handle the delete event from the file watcher
              this.cy.hideNode(node);
            } else {
              console.error('[FloatingWindowManager] Failed to delete file:', result.error);
              alert(`Failed to delete file: ${result.error}`);
            }
          } catch (error) {
            console.error('[FloatingWindowManager] Error deleting file:', error);
            alert(`Error deleting file: ${error}`);
          }
        }
      },
      onOpenTerminal: (nodeId: string) => {
        const filePath = this.fileEventManager.getFilePathForNode(nodeId);
        const nodeMetadata = {
          id: nodeId,
          name: nodeId.replace(/_/g, ' '),
          filePath: filePath
        };

        const node = this.cy.getCore().getElementById(nodeId);
        if (node.length > 0) {
          const nodePos = node.position();
          this.createFloatingTerminal(nodeId, nodeMetadata, nodePos);
        }
      },
      onCopyNodeName: (nodeId: string) => {
        const absolutePath = this.fileEventManager.getFilePathForNode(nodeId);
        navigator.clipboard.writeText(absolutePath || nodeId);
      },
      onAddNodeAtPosition: async (position: Position) => {
        console.log('[FloatingWindowManager] Creating node at position:', position);
        await this.handleAddNodeAtPosition(position);
      }
    });
  }

  /**
   * Setup command-hover mode (Cmd+hover to show editor)
   */
  setupCommandHover(): void {
    // Track command key state
    this.keyDownHandler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        console.log('[CommandHover] Command key pressed');
        this.commandKeyHeld = true;
      }
    };

    this.keyUpHandler = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) {
        console.log('[CommandHover] Command key released');
        this.commandKeyHeld = false;
        // Don't close editor - let it stay open until user clicks outside
      }
    };

    document.addEventListener('keydown', this.keyDownHandler);
    document.addEventListener('keyup', this.keyUpHandler);

    // Listen for node hover when command is held
    this.cy.getCore().on('mouseover', 'node', (event) => {
      console.log('[CommandHover] Node mouseover, commandKeyHeld:', this.commandKeyHeld);
      if (!this.commandKeyHeld) return;

      const node = event.target;
      const nodeId = node.id();

      // Get node content and file path
      const content = this.fileEventManager.getContentForNode(nodeId);
      const filePath = this.fileEventManager.getFilePathForNode(nodeId);

      console.log('[CommandHover] content:', !!content, 'filePath:', filePath);

      if (!content || !filePath) return;

      // Open hover editor
      this.openHoverEditor(nodeId, filePath, content, node.position());
    });
  }

  /**
   * Create a floating editor window
   */
  createFloatingEditor(
    nodeId: string,
    filePath: string,
    content: string,
    nodePos: Position
  ): void {
    const editorId = `editor-${nodeId}`;
    console.log('[FloatingWindowManager] Creating floating editor:', editorId);

    // Check if already exists
    const existing = this.cy.getCore().nodes(`#${editorId}`);
    if (existing && existing.length > 0) {
      console.log('[FloatingWindowManager] Editor already exists');
      return;
    }

    try {
      this.cy.addFloatingWindow({
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
          if ((window as any).electronAPI?.saveFileContent) {
            const result = await (window as any).electronAPI.saveFileContent(filePath, newContent);
            if (!result.success) {
              throw new Error(result.error || 'Failed to save file');
            }
          } else {
            throw new Error('Save functionality not available');
          }
        }
      });
    } catch (error) {
      console.error('[FloatingWindowManager] Error creating floating editor:', error);
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
    const existing = this.cy.getCore().nodes(`#${terminalId}`);
    if (existing && existing.length > 0) {
      console.log('[FloatingWindowManager] Terminal already exists');
      return;
    }

    // Check if parent node exists
    const parentNodeExists = this.cy.getCore().getElementById(nodeId).length > 0;

    const nodeData: Record<string, unknown> = {
      isFloatingWindow: true,
      isShadowNode: true,
      laidOut: false
    };

    if (parentNodeExists) {
      nodeData.parentNodeId = nodeId;
    }

    try {
      this.cy.addFloatingWindow({
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
   * Get current terminal index (for keyboard navigation)
   */
  getCurrentTerminalIndex(): number {
    return this.currentTerminalIndex;
  }

  /**
   * Set current terminal index (for keyboard navigation)
   */
  setCurrentTerminalIndex(index: number): void {
    this.currentTerminalIndex = index;
  }

  /**
   * Cleanup
   */
  dispose(): void {
    // Remove event listeners
    if (this.keyDownHandler) {
      document.removeEventListener('keydown', this.keyDownHandler);
    }
    if (this.keyUpHandler) {
      document.removeEventListener('keyup', this.keyUpHandler);
    }

    // Close hover editor if open
    this.closeHoverEditor();
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
      const overlay = getOrCreateOverlay(this.cy.getCore());

      // Create window chrome WITHOUT shadow node
      const { windowElement, contentContainer } = createWindowChrome(
        this.cy.getCore(),
        {
          id: hoverId,
          component: 'MarkdownEditor',
          position: {
            x: nodePos.x + 50,
            y: nodePos.y
          },
          initialContent: content,
          onSave: async (newContent: string) => {
            console.log('[FloatingWindowManager] Saving hover editor content');
            if ((window as any).electronAPI?.saveFileContent) {
              const result = await (window as any).electronAPI.saveFileContent(filePath, newContent);
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
        initialContent: content,
        onSave: async (newContent: string) => {
          if ((window as any).electronAPI?.saveFileContent) {
            await (window as any).electronAPI.saveFileContent(filePath, newContent);
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

  private async createNewChildNode(parentNodeId: string): Promise<void> {
    try {
      if (!(window as any).electronAPI?.createChildNode) {
        console.error('[FloatingWindowManager] Electron API not available');
        return;
      }

      const result = await (window as any).electronAPI.createChildNode(parentNodeId);
      if (result.success && result.nodeId && result.filePath) {
        console.log('[FloatingWindowManager] Successfully created child node:', result.nodeId);

        // Get parent node position to place editor nearby
        const parentNode = this.cy.getCore().getElementById(parentNodeId);
        const parentPos = parentNode.length > 0 ? parentNode.position() : { x: 0, y: 0 };
        const editorPosition = {
          x: parentPos.x + 100,
          y: parentPos.y + 100
        };

        const newNodeId = normalizeFileId(result.filePath);

        // Wait for node to be added by file watcher
        const waitForNode = (attempts = 0, maxAttempts = 100): void => {
          if (!this.cy) return;

          const cy = this.cy.getCore();
          const node = cy.getElementById(newNodeId);

          if (node.length > 0) {
            // Node found, get its content and open editor
            const content = this.fileEventManager.getContentForNode(newNodeId);
            if (content) {
              this.createFloatingEditor(newNodeId, result.filePath!, content, editorPosition);
            } else {
              console.warn('[FloatingWindowManager] No content found for new child node');
            }
          } else if (attempts < maxAttempts) {
            setTimeout(() => waitForNode(attempts + 1, maxAttempts), 100);
          } else {
            console.error('[FloatingWindowManager] Timeout waiting for child node');
          }
        };

        waitForNode();
      } else {
        console.error('[FloatingWindowManager] Failed to create child node:', result.error);
      }
    } catch (error) {
      console.error('[FloatingWindowManager] Error creating child node:', error);
    }
  }

  private async handleAddNodeAtPosition(position: Position): Promise<void> {
    try {
      if (!(window as any).electronAPI?.createStandaloneNode) {
        console.error('[FloatingWindowManager] Electron API not available');
        return;
      }

      // Pass position directly to Electron - it will save it immediately
      const result = await (window as any).electronAPI.createStandaloneNode(position);
      if (result.success && result.nodeId && result.filePath) {
        console.log('[FloatingWindowManager] Successfully created standalone node:', result.nodeId);

        // Store position in FileEventManager so handleFileAdded can use it
        this.fileEventManager.storePosition(result.filePath, position);

        const newNodeId = normalizeFileId(result.filePath);

        // Wait for node to be added by file watcher
        const waitForNode = (attempts = 0, maxAttempts = 100): void => {
          if (!this.cy) return;

          const cy = this.cy.getCore();
          const node = cy.getElementById(newNodeId);

          if (node.length > 0) {
            // Node found, open editor
            const content = `---
node_id: ${result.nodeId}
title: New Node (${result.nodeId})
---
### New Node

Edit this node to add content.
`;
            this.createFloatingEditor(newNodeId, result.filePath!, content, position);
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
}

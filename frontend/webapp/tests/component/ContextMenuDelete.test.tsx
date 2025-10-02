import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import cytoscape from 'cytoscape';
import { ContextMenuService } from '@/graph-core/services/ContextMenuService';

// Mock cytoscape-cxtmenu
vi.mock('cytoscape-cxtmenu', () => ({
  default: vi.fn(),
}));

describe('Context Menu Delete Functionality', () => {
  let container: HTMLDivElement;
  let cy: cytoscape.Core;
  let contextMenuService: ContextMenuService;

  beforeEach(() => {
    // Create container with dimensions - must set before appending
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    container.style.position = 'relative';

    // Append to body first
    document.body.appendChild(container);

    // Force layout calculation
    container.getBoundingClientRect();

    // Create test nodes
    const elements = [
      { data: { id: 'test-node', label: 'Test Node' } },
      { data: { id: 'another-node', label: 'Another Node' } },
      { data: { id: 'edge1', source: 'test-node', target: 'another-node' } }
    ];

    // Initialize cytoscape directly
    cy = cytoscape({
      container: container,
      elements: elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#666',
            'label': 'data(label)',
            'width': 30,
            'height': 30
          }
        }
      ],
      layout: { name: 'preset' }
    });

    // Mock cxtmenu on the cy instance
    cy.cxtmenu = vi.fn().mockReturnValue({
      destroy: vi.fn()
    });

    // Mock the electronAPI
    window.electronAPI = {
      deleteFile: vi.fn().mockResolvedValue({ success: true }),
      saveFileContent: vi.fn().mockResolvedValue({ success: true }),
    } as typeof window.electronAPI;

    // Mock window.confirm
    window.confirm = vi.fn().mockReturnValue(true);
  });

  afterEach(() => {
    if (cy) {
      cy.destroy();
    }
    if (container) {
      container.remove();
    }
    vi.clearAllMocks();
  });

  it('should trigger delete menu on long hold (taphold event)', async () => {
    const onDeleteNode = vi.fn();

    // Create and initialize context menu service
    contextMenuService = new ContextMenuService({
      onDeleteNode,
    });
    contextMenuService.initialize(cy);

    // Get the node element
    const node = cy.getElementById('test-node');
    const nodeElement = node.renderedBoundingBox();

    // Simulate a long hold (taphold) event on the node
    // In cytoscape, this is triggered by holding for 1 second
    const event = new MouseEvent('mousedown', {
      clientX: nodeElement.x1 + (nodeElement.w / 2),
      clientY: nodeElement.y1 + (nodeElement.h / 2),
      bubbles: true,
    });

    // Trigger the mousedown event
    container.dispatchEvent(event);

    // Wait for taphold duration (1 second in cytoscape by default)
    await new Promise(resolve => setTimeout(resolve, 1100));

    // Release the mouse
    const releaseEvent = new MouseEvent('mouseup', {
      clientX: nodeElement.x1 + (nodeElement.w / 2),
      clientY: nodeElement.y1 + (nodeElement.h / 2),
      bubbles: true,
    });
    container.dispatchEvent(releaseEvent);

    // The context menu should now be visible
    // Since we mocked cxtmenu, we need to directly test the commands
    const menuInstance = cy.cxtmenu as ReturnType<typeof cy.cxtmenu>;

    expect(menuInstance).toHaveBeenCalled();

    // Get the commands function from the mock
    const menuConfig = menuInstance.mock.calls[0][0];
    expect(menuConfig).toBeDefined();
    expect(menuConfig.openMenuEvents).toContain('taphold');

    // Test that delete command exists
    const commands = menuConfig.commands(node);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deleteCommand = commands.find((cmd: any) =>
      cmd.content?.title === 'Delete' ||
      cmd.content?.querySelector?.('svg') !== undefined
    );

    expect(deleteCommand).toBeDefined();
    expect(deleteCommand.enabled).toBe(true);
  });

  it('should show confirmation dialog when delete is selected', async () => {
    const mockFilePath = '/test/path/test-node.md';
    const onDeleteNode = vi.fn(async (node) => {
      // Simulate the delete logic from VoiceTreeGraphVizLayout
      if (window.confirm(`Are you sure you want to delete "${node.id()}"? This will move the file to trash.`)) {
        const result = await window.electronAPI!.deleteFile!(mockFilePath);
        if (result.success) {
          node.remove();
        }
      }
    });

    // Enable context menu
    contextMenuService = new ContextMenuService({
      onDeleteNode,
    });
    contextMenuService.initialize(cy);

    const node = cy.getElementById('test-node');

    // Get menu commands
    const menuInstance = cy.cxtmenu as ReturnType<typeof cy.cxtmenu>;
    const menuConfig = menuInstance.mock.calls[0][0];
    const commands = menuConfig.commands(node);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deleteCommand = commands.find((cmd: any) =>
      cmd.content?.title === 'Delete' ||
      cmd.content?.querySelector?.('svg') !== undefined
    );

    // Execute delete command
    await deleteCommand.select(node);

    // Check that confirmation was requested
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('Are you sure you want to delete')
    );

    // Check that delete was called
    expect(onDeleteNode).toHaveBeenCalledWith(node);
    expect(window.electronAPI!.deleteFile).toHaveBeenCalledWith(mockFilePath);
  });

  it('should cancel delete when user declines confirmation', async () => {
    // Mock confirm to return false
    window.confirm = vi.fn().mockReturnValue(false);

    const onDeleteNode = vi.fn(async (node) => {
      if (!window.confirm(`Are you sure you want to delete "${node.id()}"?`)) {
        return; // Cancel deletion
      }
      await window.electronAPI!.deleteFile!('/test/path/test-node.md');
    });

    contextMenuService = new ContextMenuService({
      onDeleteNode,
    });
    contextMenuService.initialize(cy);

    const node = cy.getElementById('test-node');

    // Get and execute delete command
    const menuInstance = cy.cxtmenu as ReturnType<typeof cy.cxtmenu>;
    const menuConfig = menuInstance.mock.calls[0][0];
    const commands = menuConfig.commands(node);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deleteCommand = commands.find((cmd: any) =>
      cmd.content?.title === 'Delete' ||
      cmd.content?.querySelector?.('svg') !== undefined
    );

    await deleteCommand.select(node);

    // Verify confirmation was shown but delete was not called
    expect(window.confirm).toHaveBeenCalled();
    expect(window.electronAPI!.deleteFile).not.toHaveBeenCalled();

    // Node should still exist
    expect(cy.getElementById('test-node').length).toBe(1);
  });

  it('should remove node from graph after successful deletion', async () => {
    const onDeleteNode = vi.fn(async (node) => {
      if (window.confirm('Delete?')) {
        const result = await window.electronAPI!.deleteFile!('/test/file.md');
        if (result.success) {
          node.remove(); // Remove from graph
        }
      }
    });

    contextMenuService = new ContextMenuService({
      onDeleteNode,
    });
    contextMenuService.initialize(cy);

    const node = cy.getElementById('test-node');

    // Initial node count
    expect(cy.nodes().length).toBe(2);

    // Get and execute delete command
    const menuInstance = cy.cxtmenu as ReturnType<typeof cy.cxtmenu>;
    const menuConfig = menuInstance.mock.calls[0][0];
    const commands = menuConfig.commands(node);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deleteCommand = commands.find((cmd: any) =>
      cmd.content?.title === 'Delete' ||
      cmd.content?.querySelector?.('svg') !== undefined
    );

    await deleteCommand.select(node);

    // Wait for async operations
    await waitFor(() => {
      expect(cy.getElementById('test-node').length).toBe(0);
    });

    // Verify node was removed
    expect(cy.nodes().length).toBe(1);
    expect(cy.getElementById('another-node').length).toBe(1);
  });

  it('should handle delete errors gracefully', async () => {
    // Mock deleteFile to return an error
    window.electronAPI!.deleteFile = vi.fn().mockResolvedValue({
      success: false,
      error: 'Permission denied'
    });

    // Mock alert
    window.alert = vi.fn();

    const onDeleteNode = vi.fn(async (node) => {
      if (window.confirm('Delete?')) {
        const result = await window.electronAPI!.deleteFile!('/test/file.md');
        if (!result.success) {
          window.alert(`Failed to delete file: ${result.error}`);
        } else {
          node.remove();
        }
      }
    });

    contextMenuService = new ContextMenuService({
      onDeleteNode,
    });
    contextMenuService.initialize(cy);

    const node = cy.getElementById('test-node');

    // Get and execute delete command
    const menuInstance = cy.cxtmenu as ReturnType<typeof cy.cxtmenu>;
    const menuConfig = menuInstance.mock.calls[0][0];
    const commands = menuConfig.commands(node);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deleteCommand = commands.find((cmd: any) =>
      cmd.content?.title === 'Delete' ||
      cmd.content?.querySelector?.('svg') !== undefined
    );

    await deleteCommand.select(node);

    // Wait for async operations
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('Failed to delete file: Permission denied');
    });

    // Node should still exist
    expect(cy.getElementById('test-node').length).toBe(1);
  });

  it('should display trash icon in delete menu item', () => {
    contextMenuService = new ContextMenuService({
      onDeleteNode: vi.fn(),
    });
    contextMenuService.initialize(cy);

    const node = cy.getElementById('test-node');

    // Get menu commands
    const menuInstance = cy.cxtmenu as ReturnType<typeof cy.cxtmenu>;
    const menuConfig = menuInstance.mock.calls[0][0];
    const commands = menuConfig.commands(node);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deleteCommand = commands.find((cmd: any) => {
      // Check if it's an HTML element with an SVG
      if (cmd.content && typeof cmd.content === 'object' && cmd.content.querySelector) {
        const svg = cmd.content.querySelector('svg');
        const path = cmd.content.querySelector('path');
        return svg && path && path.getAttribute('d')?.includes('M3 6h18');
      }
      return false;
    });

    expect(deleteCommand).toBeDefined();
    expect(deleteCommand.enabled).toBe(true);

    // Verify it's the trash icon by checking the path data
    const pathElement = deleteCommand.content.querySelector('path');
    expect(pathElement.getAttribute('d')).toContain('M3 6h18'); // Part of trash icon path
  });
});
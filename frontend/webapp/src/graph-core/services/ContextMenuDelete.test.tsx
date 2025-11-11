import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import { ContextMenuService, type ContextMenuDependencies } from '@/graph-core/services/ContextMenuService.ts';

// Mock cytoscape-cxtmenu
vi.mock('cytoscape-cxtmenu', () => ({
  default: vi.fn(),
}));

// Helper type for mocked cytoscape with cxtmenu
type MockedCore = Core & {
  cxtmenu: ReturnType<typeof vi.fn>;
};

// TODO. WE DONT USE REACT ANYMORE?
describe('Context Menu Delete Functionality', () => {
  let container: HTMLDivElement;
  let cy: MockedCore;
  let contextMenuService: ContextMenuService;
  let mockDeps: ContextMenuDependencies;

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
      { data: { id: 'test-node', label: 'Test GraphNode' } },
      { data: { id: 'another-node', label: 'Another GraphNode' } },
      { data: { id: 'edge1', source: 'test-node', target: 'another-node' } }
    ];

    // Initialize cytoscape directly
    const coreInstance = cytoscape({
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
    const mockCxtmenu = vi.fn().mockReturnValue({
      destroy: vi.fn()
    });
    (coreInstance as MockedCore).cxtmenu = mockCxtmenu;
    cy = coreInstance as MockedCore;

    // Mock the electronAPI
    window.electronAPI = {
      deleteFile: vi.fn().mockResolvedValue({ success: true }),
      saveFileContent: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as typeof window.electronAPI;

    // Mock window.confirm
    window.confirm = vi.fn().mockReturnValue(true);

    // Create mock dependencies
    mockDeps = {
      getFilePathForNode: vi.fn().mockResolvedValue('/test/path/test-node.md'),
      createAnchoredFloatingEditor: vi.fn().mockResolvedValue(undefined),
      createFloatingTerminal: vi.fn(),
      handleAddNodeAtPosition: vi.fn().mockResolvedValue(undefined),
    };
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
    // Create and initialize context menu service
    contextMenuService = new ContextMenuService();
    contextMenuService.initialize(cy, mockDeps);

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
    const menuInstance = cy.cxtmenu;

    expect(menuInstance).toHaveBeenCalled();

    // Get the commands function from the mock
    const menuConfig = menuInstance.mock.calls[0]?.[0];
    expect(menuConfig).toBeDefined();
    expect(menuConfig?.openMenuEvents).toContain('taphold');

    // Test that delete command exists
    const commands = menuConfig?.commands(node);
    const deleteCommand = commands?.find((cmd: { content: HTMLElement | string }) => {
      // Check if it's an HTML element with an SVG
      if (cmd.content && typeof cmd.content === 'object' && 'querySelector' in cmd.content) {
        const svg = cmd.content.querySelector('svg');
        const path = cmd.content.querySelector('path');
        return svg && path && path.getAttribute('d')?.includes('M3 6h18');
      }
      return false;
    });

    expect(deleteCommand).toBeDefined();
    expect(deleteCommand?.enabled).toBe(true);
  });

  it('should show confirmation dialog when delete is selected', async () => {
    const mockFilePath = '/test/path/test-node.md';

    // Override the getFilePathForNode mock for this test
    mockDeps.getFilePathForNode = vi.fn().mockResolvedValue(mockFilePath);

    contextMenuService = new ContextMenuService();
    contextMenuService.initialize(cy, mockDeps);

    const node = cy.getElementById('test-node');

    // Get menu commands
    const menuInstance = cy.cxtmenu;
    const menuConfig = menuInstance.mock.calls[0]?.[0];
    const commands = menuConfig?.commands(node);
    const deleteCommand = commands?.find((cmd: { content: HTMLElement | string }) => {
      if (cmd.content && typeof cmd.content === 'object' && 'querySelector' in cmd.content) {
        const svg = cmd.content.querySelector('svg');
        const path = cmd.content.querySelector('path');
        return svg && path && path.getAttribute('d')?.includes('M3 6h18');
      }
      return false;
    });

    // Execute delete command
    await deleteCommand?.select(node);

    // Check that confirmation was requested
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('Are you sure you want to delete')
    );
  });

  it('should cancel delete when user declines confirmation', async () => {
    // Mock confirm to return false
    window.confirm = vi.fn().mockReturnValue(false);

    contextMenuService = new ContextMenuService();
    contextMenuService.initialize(cy, mockDeps);

    const node = cy.getElementById('test-node');

    // Get and execute delete command
    const menuInstance = cy.cxtmenu;
    const menuConfig = menuInstance.mock.calls[0]?.[0];
    const commands = menuConfig?.commands(node);
    const deleteCommand = commands?.find((cmd: { content: HTMLElement | string }) => {
      if (cmd.content && typeof cmd.content === 'object' && 'querySelector' in cmd.content) {
        const path = cmd.content.querySelector('path');
        return path && path.getAttribute('d')?.includes('M3 6h18');
      }
      return false;
    });

    await deleteCommand?.select(node);

    // Verify confirmation was shown but delete was not called
    expect(window.confirm).toHaveBeenCalled();
    expect(window.electronAPI?.deleteFile).not.toHaveBeenCalled();

    // GraphNode should still exist
    expect(cy.getElementById('test-node').length).toBe(1);
  });

  it('should remove node from graph after successful deletion', async () => {
    contextMenuService = new ContextMenuService();
    contextMenuService.initialize(cy, mockDeps);

    const node = cy.getElementById('test-node');

    // Initial node count
    expect(cy.nodes().length).toBe(2);

    // Get and execute delete command
    const menuInstance = cy.cxtmenu;
    const menuConfig = menuInstance.mock.calls[0]?.[0];
    const commands = menuConfig?.commands(node);
    const deleteCommand = commands?.find((cmd: { content: HTMLElement | string }) => {
      if (cmd.content && typeof cmd.content === 'object' && 'querySelector' in cmd.content) {
        const path = cmd.content.querySelector('path');
        return path && path.getAttribute('d')?.includes('M3 6h18');
      }
      return false;
    });

    await deleteCommand?.select(node);

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
    window.electronAPI = {
      ...window.electronAPI,
      deleteFile: vi.fn().mockResolvedValue({
        success: false,
        error: 'Permission denied'
      }),
    } as unknown as typeof window.electronAPI;

    // Mock alert
    window.alert = vi.fn();

    contextMenuService = new ContextMenuService();
    contextMenuService.initialize(cy, mockDeps);

    const node = cy.getElementById('test-node');

    // Get and execute delete command
    const menuInstance = cy.cxtmenu;
    const menuConfig = menuInstance.mock.calls[0]?.[0];
    const commands = menuConfig?.commands(node);
    const deleteCommand = commands?.find((cmd: { content: HTMLElement | string }) => {
      if (cmd.content && typeof cmd.content === 'object' && 'querySelector' in cmd.content) {
        const path = cmd.content.querySelector('path');
        return path && path.getAttribute('d')?.includes('M3 6h18');
      }
      return false;
    });

    await deleteCommand?.select(node);

    // Wait for async operations
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalled();
    }, { timeout: 3000 });

    // GraphNode should still exist
    expect(cy.getElementById('test-node').length).toBe(1);
  });

  it('should display trash icon in delete menu item', () => {
    contextMenuService = new ContextMenuService();
    contextMenuService.initialize(cy, mockDeps);

    const node = cy.getElementById('test-node');

    // Get menu commands
    const menuInstance = cy.cxtmenu;
    const menuConfig = menuInstance.mock.calls[0]?.[0];
    const commands = menuConfig?.commands(node);
    const deleteCommand = commands?.find((cmd: { content: HTMLElement | string }) => {
      // Check if it's an HTML element with an SVG
      if (cmd.content && typeof cmd.content === 'object' && 'querySelector' in cmd.content) {
        const svg = cmd.content.querySelector('svg');
        const path = cmd.content.querySelector('path');
        return svg && path && path.getAttribute('d')?.includes('M3 6h18');
      }
      return false;
    });

    expect(deleteCommand).toBeDefined();
    expect(deleteCommand?.enabled).toBe(true);

    // Verify it's the trash icon by checking the path data
    if (deleteCommand?.content && typeof deleteCommand.content === 'object' && 'querySelector' in deleteCommand.content) {
      const pathElement = deleteCommand.content.querySelector('path');
      expect(pathElement?.getAttribute('d')).toContain('M3 6h18'); // Part of trash icon path
    }
  });
});

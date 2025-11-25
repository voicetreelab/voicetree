import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import { ContextMenuService, type ContextMenuDependencies } from '@/shell/UI/cytoscape-graph-ui/services/ContextMenuService.ts';
import type { CxtMenuInstance } from '@/utils/types/cytoscape-cxtmenu';

// Mock cytoscape-cxtmenu
vi.mock('cytoscape-cxtmenu', () => ({
  default: vi.fn(),
}));

// Helper type for mocked cytoscape with cxtmenu
type MockedCore = Core & {
  cxtmenu: ReturnType<typeof vi.fn>;
};

describe('ContextMenuService', () => {
  let cy: MockedCore;
  let container: HTMLDivElement;
  let service: ContextMenuService;
  let mockDeps: ContextMenuDependencies;

  beforeEach(() => {
    // Create container with dimensions
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);

    // Initialize cytoscape
    const coreInstance = cytoscape({
      container: container,
      elements: [
        { data: { id: 'node1', label: 'GraphNode 1' } },
        { data: { id: 'node2', label: 'GraphNode 2' } },
        { data: { id: 'edge1', source: 'node1', target: 'node2' } },
      ],
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#666',
            'label': 'data(label)',
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 3,
            'line-color': '#ccc',
          },
        },
      ],
      layout: { name: 'preset' },
    });

    // Add mocked cxtmenu method
    const mockCxtmenu = vi.fn().mockReturnValue({
      destroy: vi.fn(),
    });
    (coreInstance as MockedCore).cxtmenu = mockCxtmenu;
    cy = coreInstance as MockedCore;

    // Create mock dependencies
    mockDeps = {
      getFilePathForNode: vi.fn().mockResolvedValue('/path/to/node.md'),
      createAnchoredFloatingEditor: vi.fn().mockResolvedValue(undefined),
      handleAddNodeAtPosition: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    if (service) {
      service.destroy();
    }
    if (cy) {
      cy.destroy();
    }
    if (container) {
      container.remove();
    }
  });

  describe('initialization', () => {
    it('should initialize context menu on cytoscape instance', () => {
      service = new ContextMenuService();
      service.initialize(cy, mockDeps);

      expect(cy.cxtmenu).toHaveBeenCalledWith(
        expect.objectContaining({
          selector: 'node',
          menuRadius: 75,
          openMenuEvents: 'cxttapstart taphold',
        })
      );
    });

    it('should use theme colors from CSS variables', () => {
      // Save original implementation
      const originalGetComputedStyle = globalThis.getComputedStyle;

      try {
        // Mock getComputedStyle to return our custom values
        const mockGetPropertyValue = vi.fn((prop: string) => {
          const props: Record<string, string> = {
            '--text-selection': '#custom-select',
            '--background-secondary': '#custom-bg',
            '--text-normal': '#custom-text',
          };
          return props[prop] || '';
        });

        vi.stubGlobal('getComputedStyle', vi.fn().mockReturnValue({
          getPropertyValue: mockGetPropertyValue,
        } as unknown as CSSStyleDeclaration));

        service = new ContextMenuService();
        service.initialize(cy, mockDeps);

        expect(cy.cxtmenu).toHaveBeenCalledWith(
          expect.objectContaining({
            fillColor: '#custom-bg',
            activeFillColor: '#custom-select',
            itemColor: '#custom-text',
          })
        );
      } finally {
        // Always restore original implementation
        vi.unstubAllGlobals();
        globalThis.getComputedStyle = originalGetComputedStyle;
      }
    });

    it('should use dark mode defaults when class is present', () => {
      document.documentElement.classList.add('dark');
      document.documentElement.style.removeProperty('--text-selection');

      service = new ContextMenuService();
      service.initialize(cy, mockDeps);

      expect(cy.cxtmenu).toHaveBeenCalledWith(
        expect.objectContaining({
          activeFillColor: '#3b82f6', // Dark mode default
        })
      );

      document.documentElement.classList.remove('dark');
    });
  });

  describe('menu commands', () => {
    it('should generate correct commands', () => {
      service = new ContextMenuService();
      service.initialize(cy, mockDeps);

      // Get the commands function from the mock call (first call is for nodes)
      const menuOptions = cy.cxtmenu.mock.calls[0]?.[0];
      expect(menuOptions).toBeDefined();
      const commandsFunc = menuOptions!.commands;

      // Test with node
      const node1 = cy.getElementById('node1');
      const commands = commandsFunc(node1);

      // Edit, Create Child, Terminal, Delete, Copy
      expect(commands).toHaveLength(5);
      expect(commands[0]?.enabled).toBe(true);
    });

    it('should execute callbacks when menu items are selected', async () => {
      service = new ContextMenuService();
      service.initialize(cy, mockDeps);

      const menuOptions = cy.cxtmenu.mock.calls[0]?.[0];
      expect(menuOptions).toBeDefined();
      const commandsFunc = menuOptions!.commands;

      const node = cy.getElementById('node1');
      const commands = commandsFunc(node);

      // Execute the Edit command
      await commands[0]?.select();
      expect(mockDeps.createAnchoredFloatingEditor).toHaveBeenCalledWith('node1');
    });
  });

  describe('destruction', () => {
    it('should destroy menu instance and clear references', () => {
      service = new ContextMenuService();
      service.initialize(cy, mockDeps);

      const menuInstance = cy.cxtmenu.mock.results[0]?.value as CxtMenuInstance | undefined;
      expect(menuInstance).toBeDefined();

      service.destroy();

      expect(menuInstance?.destroy).toHaveBeenCalled();
    });

    it('should handle destruction when no menu instance exists', () => {
      service = new ContextMenuService();
      // Don't initialize

      expect(() => service.destroy()).not.toThrow();
    });
  });


  describe('canvas context menu', () => {
    it('should register canvas context menu with cxtmenu', () => {
      service = new ContextMenuService();
      service.initialize(cy, mockDeps);

      // Verify that cxtmenu was called twice: once for nodes, once for canvas
      expect(cy.cxtmenu).toHaveBeenCalledTimes(2);

      // Check that the second call is for canvas (selector: 'core')
      const secondCall = cy.cxtmenu.mock.calls[1];
      expect(secondCall).toBeDefined();
      const canvasMenuOptions = secondCall?.[0];
      expect(canvasMenuOptions).toBeDefined();
      expect(canvasMenuOptions?.selector).toBe('core');
      expect(canvasMenuOptions?.commands).toBeInstanceOf(Function);
    });

    it('should store canvas click position and create menu command', async () => {
      service = new ContextMenuService();
      service.initialize(cy, mockDeps);

      // Simulate a canvas click event to store position
      const position = { x: 100, y: 200 };

      // Directly access the service's private method by casting to any
      // This is a test-only workaround to simulate the event properly
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).lastCanvasClickPosition = position;

      // Get the canvas menu commands function
      const canvasMenuCall = cy.cxtmenu.mock.calls.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (call: any) => call[0]?.selector === 'core'
      );
      expect(canvasMenuCall).toBeDefined();
      const commandsFunction = canvasMenuCall?.[0]?.commands;
      expect(commandsFunction).toBeDefined();

      // Get commands after position is stored
      const commands = commandsFunction!();

      // Verify we have an "Add GraphNode Here" command
      expect(commands).toHaveLength(1);
      expect(commands[0]?.enabled).toBe(true);

      // Simulate selecting the command
      await commands[0]?.select();

      // The handler should be called with the stored position
      expect(mockDeps.handleAddNodeAtPosition).toHaveBeenCalledWith(position);
    });

    it('should not store position for node clicks', () => {
      service = new ContextMenuService();
      service.initialize(cy, mockDeps);

      // Simulate a node click event (not canvas)
      const node = cy.getElementById('node1');
      const position = { x: 100, y: 200 };
      const mockEvent = {
        target: node,
        position,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (cy as any).emit('cxttapstart', mockEvent);

      // Get the commands function from canvas menu
      const canvasMenuCall = cy.cxtmenu.mock.calls.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (call: any) => call[0]?.selector === 'core'
      );
      expect(canvasMenuCall).toBeDefined();
      const commandsFunction = canvasMenuCall?.[0]?.commands;
      expect(commandsFunction).toBeDefined();

      // Get commands after node click (position should not be stored)
      const commands = commandsFunction!();

      // Commands should be empty since position wasn't stored (node click, not canvas)
      expect(commands).toHaveLength(0);
    });
  });
});

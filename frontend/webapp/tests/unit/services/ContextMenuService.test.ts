import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import cytoscape from 'cytoscape';
import { ContextMenuService } from '@/graph-core/services/ContextMenuService';
import { CLASS_EXPANDED } from '@/graph-core/constants';

// Mock cytoscape-cxtmenu
vi.mock('cytoscape-cxtmenu', () => ({
  default: vi.fn(),
}));

describe('ContextMenuService', () => {
  let cy: cytoscape.Core;
  let container: HTMLDivElement;
  let service: ContextMenuService;

  beforeEach(() => {
    // Create container with dimensions
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);

    // Initialize cytoscape
    cy = cytoscape({
      container: container,
      elements: [
        { data: { id: 'node1', label: 'Node 1' } },
        { data: { id: 'node2', label: 'Node 2' } },
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

    // Mock cxtmenu method on cytoscape instance
    cy.cxtmenu = vi.fn().mockReturnValue({
      destroy: vi.fn(),
    });
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
      const config = {
        onOpenEditor: vi.fn(),
      };

      service = new ContextMenuService(config);
      service.initialize(cy);

      expect(cy.cxtmenu).toHaveBeenCalledWith(
        expect.objectContaining({
          selector: 'node',
          menuRadius: 75,
          openMenuEvents: 'cxttapstart taphold',
        })
      );
    });

    it('should use theme colors from CSS variables', () => {
      // Mock getComputedStyle to return our custom values
      const originalGetComputedStyle = window.getComputedStyle;
      window.getComputedStyle = vi.fn().mockReturnValue({
        getPropertyValue: (prop: string) => {
          const props: Record<string, string> = {
            '--text-selection': '#custom-select',
            '--background-secondary': '#custom-bg',
            '--text-normal': '#custom-text',
          };
          return props[prop] || '';
        },
      } as CSSStyleDeclaration);

      service = new ContextMenuService({});
      service.initialize(cy);

      expect(cy.cxtmenu).toHaveBeenCalledWith(
        expect.objectContaining({
          fillColor: '#custom-bg',
          activeFillColor: '#custom-select',
          itemColor: '#custom-text',
        })
      );

      // Restore original
      window.getComputedStyle = originalGetComputedStyle;
    });

    it('should use dark mode defaults when class is present', () => {
      document.documentElement.classList.add('dark');
      document.documentElement.style.removeProperty('--text-selection');

      service = new ContextMenuService({});
      service.initialize(cy);

      expect(cy.cxtmenu).toHaveBeenCalledWith(
        expect.objectContaining({
          activeFillColor: '#3b82f6', // Dark mode default
        })
      );

      document.documentElement.classList.remove('dark');
    });
  });

  describe('menu commands', () => {
    it('should generate correct commands based on node state', () => {
      const config = {
        onOpenEditor: vi.fn(),
        onExpandNode: vi.fn(),
        onCollapseNode: vi.fn(),
        onOpenTerminal: vi.fn(),
        onDeleteNode: vi.fn(),
        onCopyNodeName: vi.fn(),
      };

      service = new ContextMenuService(config);
      service.initialize(cy);

      // Get the commands function from the mock call
      const menuOptions = (cy.cxtmenu as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const commandsFunc = menuOptions.commands;

      // Test with normal node
      const node1 = cy.getElementById('node1');
      const commands1 = commandsFunc(node1);

      expect(commands1).toHaveLength(5); // Edit, Expand, Terminal, Delete, Copy
      expect(commands1[0].enabled).toBe(true);

      // Test with expanded node
      node1.addClass(CLASS_EXPANDED);
      const commands2 = commandsFunc(node1);
      expect(commands2).toHaveLength(5); // Edit, Collapse (instead of Expand), Terminal, Delete, Copy
    });

    it('should execute callbacks when menu items are selected', () => {
      const onOpenEditor = vi.fn();
      const onExpandNode = vi.fn();

      const config = {
        onOpenEditor,
        onExpandNode,
      };

      service = new ContextMenuService(config);
      service.initialize(cy);

      const menuOptions = (cy.cxtmenu as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const commandsFunc = menuOptions.commands;

      const node = cy.getElementById('node1');
      const commands = commandsFunc(node);

      // Execute the Edit command
      commands[0].select();
      expect(onOpenEditor).toHaveBeenCalledWith('node1');

      // Execute the Expand command
      commands[1].select();
      expect(onExpandNode).toHaveBeenCalledWith(node);
    });
  });

  describe('configuration updates', () => {
    it('should update configuration and reinitialize menu', () => {
      const initialConfig = {
        onOpenEditor: vi.fn(),
      };

      service = new ContextMenuService(initialConfig);
      service.initialize(cy);

      // Now cxtmenu is called twice: once for nodes, once for canvas
      expect(cy.cxtmenu).toHaveBeenCalledTimes(2);

      // Get the mock menu instance (for nodes)
      const menuInstance = (cy.cxtmenu as ReturnType<typeof vi.fn>).mock.results[0].value;

      // Update config
      const newOnOpenEditor = vi.fn();
      service.updateConfig({
        onOpenEditor: newOnOpenEditor,
      });

      // Should have destroyed the old menu
      expect(menuInstance.destroy).toHaveBeenCalled();

      // Should have created a new node menu (but not a new canvas menu)
      // Total: 2 initial + 1 new node menu = 3 calls
      expect(cy.cxtmenu).toHaveBeenCalledTimes(3);
    });

    it('should not reinitialize if cy is not set', () => {
      const config = {
        onOpenEditor: vi.fn(),
      };

      service = new ContextMenuService(config);
      // Don't initialize

      service.updateConfig({ onOpenEditor: vi.fn() });

      expect(cy.cxtmenu).not.toHaveBeenCalled();
    });
  });

  describe('destruction', () => {
    it('should destroy menu instance and clear references', () => {
      service = new ContextMenuService({});
      service.initialize(cy);

      const menuInstance = (cy.cxtmenu as ReturnType<typeof vi.fn>).mock.results[0].value;

      service.destroy();

      expect(menuInstance.destroy).toHaveBeenCalled();
    });

    it('should handle destruction when no menu instance exists', () => {
      service = new ContextMenuService({});
      // Don't initialize

      expect(() => service.destroy()).not.toThrow();
    });
  });

  describe('SVG icon creation', () => {
    it('should create proper SVG elements for menu icons', () => {
      service = new ContextMenuService({
        onOpenEditor: vi.fn(),
      });
      service.initialize(cy);

      const menuOptions = (cy.cxtmenu as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const commandsFunc = menuOptions.commands;

      const node = cy.getElementById('node1');
      const commands = commandsFunc(node);

      // Check that content is an HTML element with SVG
      const iconElement = commands[0].content as HTMLElement;
      expect(iconElement.tagName).toBe('DIV');
      expect(iconElement.querySelector('svg')).not.toBeNull();
      expect(iconElement.querySelector('path')).not.toBeNull();
    });
  });

  describe('canvas context menu', () => {
    it('should register canvas context menu with cxtmenu', () => {
      const onAddNodeAtPosition = vi.fn();
      const config = {
        onAddNodeAtPosition,
      };

      // Spy on cy.cxtmenu before initialization
      const cxtmenuSpy = vi.spyOn(cy, 'cxtmenu');

      service = new ContextMenuService(config);
      service.initialize(cy);

      // Verify that cxtmenu was called twice: once for nodes, once for canvas
      expect(cxtmenuSpy).toHaveBeenCalledTimes(2);

      // Check that the second call is for canvas (selector: 'core')
      const secondCall = cxtmenuSpy.mock.calls[1];
      expect(secondCall).toBeDefined();
      const canvasMenuOptions = secondCall[0];
      expect(canvasMenuOptions.selector).toBe('core');
      expect(canvasMenuOptions.commands).toBeInstanceOf(Function);
    });

    it('should store canvas click position and create menu command', () => {
      const onAddNodeAtPosition = vi.fn();
      const config = {
        onAddNodeAtPosition,
      };

      // Spy on cy.cxtmenu before initialization
      const cxtmenuSpy = vi.spyOn(cy, 'cxtmenu');

      service = new ContextMenuService(config);
      service.initialize(cy);

      // Get the canvas menu setup (second call to cxtmenu)
      const canvasMenuCall = cxtmenuSpy.mock.calls.find(
        call => call[0]?.selector === 'core'
      );
      expect(canvasMenuCall).toBeDefined();
      const commandsFunction = canvasMenuCall![0].commands;

      // Spy on the cy.on method to get the cxttapstart handler
      const onSpy = vi.spyOn(cy, 'on');

      // Re-initialize to capture the event handler spy
      service.destroy();
      service = new ContextMenuService(config);
      service.initialize(cy);

      // Verify that cxttapstart listener was registered for storing position
      expect(onSpy).toHaveBeenCalledWith('cxttapstart', expect.any(Function));

      // Get the registered handler
      const cxttapstartCall = onSpy.mock.calls.find(call => call[0] === 'cxttapstart');
      expect(cxttapstartCall).toBeDefined();
      const handler = cxttapstartCall![1] as Function;

      // Simulate a canvas click event to store position
      const position = { x: 100, y: 200 };
      const mockEvent = {
        target: cy,
        position,
      };

      handler(mockEvent);

      // Get the commands function from the new service instance
      const newCanvasMenuCall = cxtmenuSpy.mock.calls.filter(
        call => call[0]?.selector === 'core'
      )[1]; // Get second canvas menu call (after re-initialization)
      expect(newCanvasMenuCall).toBeDefined();
      const newCommandsFunction = newCanvasMenuCall[0].commands;

      // Get commands after position is stored
      const commands = newCommandsFunction();

      // Verify we have an "Add Node Here" command
      expect(commands).toHaveLength(1);
      expect(commands[0].enabled).toBe(true);

      // Simulate selecting the command
      commands[0].select();

      // The handler should be called with the stored position
      expect(onAddNodeAtPosition).toHaveBeenCalledWith(position);
    });

    it('should not store position for node clicks', () => {
      const onAddNodeAtPosition = vi.fn();
      const config = {
        onAddNodeAtPosition,
      };

      // Spy on cy.cxtmenu and cy.on before initialization
      const cxtmenuSpy = vi.spyOn(cy, 'cxtmenu');
      const onSpy = vi.spyOn(cy, 'on');

      service = new ContextMenuService(config);
      service.initialize(cy);

      // Get the registered cxttapstart handler
      const cxttapstartCall = onSpy.mock.calls.find(call => call[0] === 'cxttapstart');
      expect(cxttapstartCall).toBeDefined();
      const handler = cxttapstartCall![1] as Function;

      // Simulate a node click event (not canvas)
      const node = cy.getElementById('node1');
      const position = { x: 100, y: 200 };
      const mockEvent = {
        target: node,
        position,
      };

      handler(mockEvent);

      // Get the commands function from canvas menu
      const canvasMenuCall = cxtmenuSpy.mock.calls.find(
        call => call[0]?.selector === 'core'
      );
      expect(canvasMenuCall).toBeDefined();
      const commandsFunction = canvasMenuCall![0].commands;

      // Get commands after node click (position should not be stored)
      const commands = commandsFunction();

      // Commands should be empty since position wasn't stored (node click, not canvas)
      expect(commands).toHaveLength(0);
    });
  });

  describe('createNewChildNodeFromUI', () => {
    it('should create optimistic UI update and dispatch action to backend', async () => {
      // Mock window.electronAPI
      const mockGraphUpdate = vi.fn().mockResolvedValue({ success: true });
      (global as any).window = {
        electronAPI: {
          graph: {
            update: mockGraphUpdate
          }
        }
      };

      // Create mock cytoscape instance
      const mockCyAdd = vi.fn();
      const mockCyBatch = vi.fn((fn) => fn());
      const mockCy = {
        getCore: () => ({
          add: mockCyAdd,
          batch: mockCyBatch
        })
      };

      // Create mock graph with parent node
      const mockGraph = {
        nodes: {
          'parent_node': {
            id: 'parent_node',
            content: '# Parent Node',
            outgoingEdges: [],
            nodeUIMetadata: {
              color: { _tag: 'None' },
              position: { x: 100, y: 100 }
            }
          }
        }
      };

      // Create dependencies
      const deps = {
        cy: mockCy,
        getGraph: () => mockGraph,
        getContentForNode: vi.fn(),
        createFloatingEditor: vi.fn(),
        extractNodeIdFromPath: vi.fn(),
        getVaultPath: () => '/test/vault'
      };

      // Call createNewChildNodeFromUI
      await ContextMenuService.createNewChildNode('parent_node', deps as any);

      // Verify cytoscape batch was called for optimistic update
      expect(mockCyBatch).toHaveBeenCalled();

      // Verify node was added to cytoscape
      expect(mockCyAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          group: 'nodes',
          data: expect.objectContaining({
            id: 'parent_node_0',
            content: '# New Node'
          })
        })
      );

      // Verify edge was added to cytoscape
      expect(mockCyAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          group: 'edges',
          data: expect.objectContaining({
            source: 'parent_node',
            target: 'parent_node_0'
          })
        })
      );

      // Verify graph update was called
      expect(mockGraphUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeToCreate: expect.objectContaining({
            id: 'parent_node_0',
            content: '# New Node'
          }),
          createsIncomingEdges: ['parent_node']
        })
      );

      // Cleanup
      delete (global as any).window;
    });

    it('should handle missing parent node gracefully', async () => {
      // Mock window.electronAPI
      const mockGraphUpdate = vi.fn().mockResolvedValue({ success: true });
      (global as any).window = {
        electronAPI: {
          graph: {
            update: mockGraphUpdate
          }
        }
      };

      // Create mock with empty graph
      const mockCy = {
        getCore: () => ({
          add: vi.fn(),
          batch: vi.fn()
        })
      };

      const mockGraph = {
        nodes: {}
      };

      const deps = {
        cy: mockCy,
        getGraph: () => mockGraph,
        getContentForNode: vi.fn(),
        createFloatingEditor: vi.fn(),
        extractNodeIdFromPath: vi.fn(),
        getVaultPath: () => '/test/vault'
      };

      // Spy on console.error
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Call createNewChildNodeFromUI with non-existent parent
      await ContextMenuService.createNewChildNode('nonexistent', deps as any);

      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[ContextMenuService] Parent node not found:',
        'nonexistent'
      );

      // Verify graph update was NOT called
      expect(mockGraphUpdate).not.toHaveBeenCalled();

      // Cleanup
      consoleErrorSpy.mockRestore();
      delete (global as any).window;
    });

    it('should handle missing electronAPI gracefully', async () => {
      // Don't set window.electronAPI
      (global as any).window = {};

      const mockCy = {
        getCore: () => ({
          add: vi.fn(),
          batch: vi.fn()
        })
      };

      const mockGraph = {
        nodes: {
          'parent_node': {
            id: 'parent_node',
            content: '# Parent Node',
            outgoingEdges: [],
            nodeUIMetadata: {
              color: { _tag: 'None' },
              position: { x: 100, y: 100 }
            }
          }
        }
      };

      const deps = {
        cy: mockCy,
        getGraph: () => mockGraph,
        getContentForNode: vi.fn(),
        createFloatingEditor: vi.fn(),
        extractNodeIdFromPath: vi.fn(),
        getVaultPath: () => '/test/vault'
      };

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Call createNewChildNodeFromUI
      await ContextMenuService.createNewChildNode('parent_node', deps as any);

      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[ContextMenuService] Functional graph API not available'
      );

      // Cleanup
      consoleErrorSpy.mockRestore();
      delete (global as any).window;
    });
  });
});
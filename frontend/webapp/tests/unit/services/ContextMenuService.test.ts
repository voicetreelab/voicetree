import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import cytoscape from 'cytoscape';
import { ContextMenuService } from '@/graph-core/services/ContextMenuService';
import { CLASS_EXPANDED, CLASS_PINNED } from '@/graph-core/constants';

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
      } as any);

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
      const menuOptions = (cy.cxtmenu as any).mock.calls[0][0];
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

      const menuOptions = (cy.cxtmenu as any).mock.calls[0][0];
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

      expect(cy.cxtmenu).toHaveBeenCalledTimes(1);

      // Get the mock menu instance
      const menuInstance = (cy.cxtmenu as any).mock.results[0].value;

      // Update config
      const newOnOpenEditor = vi.fn();
      service.updateConfig({
        onOpenEditor: newOnOpenEditor,
      });

      // Should have destroyed the old menu
      expect(menuInstance.destroy).toHaveBeenCalled();

      // Should have created a new menu
      expect(cy.cxtmenu).toHaveBeenCalledTimes(2);
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

      const menuInstance = (cy.cxtmenu as any).mock.results[0].value;

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

      const menuOptions = (cy.cxtmenu as any).mock.calls[0][0];
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
});
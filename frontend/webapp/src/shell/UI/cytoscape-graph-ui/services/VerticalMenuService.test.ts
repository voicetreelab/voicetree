import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import { VerticalMenuService, type VerticalMenuDependencies } from '@/shell/UI/cytoscape-graph-ui/services/VerticalMenuService.ts';
import type { MenuItem } from '@/shell/UI/lib/ctxmenu.d.ts';

// Mock ctxmenu
vi.mock('@/shell/UI/lib/ctxmenu.js', () => ({
  default: {
    show: vi.fn(),
    hide: vi.fn(),
  },
}));

// Mock deleteNodeFromUI
vi.mock('@/shell/edge/UI-edge/graph/handleUIActions.ts', () => ({
  deleteNodeFromUI: vi.fn().mockResolvedValue(undefined),
}));

// Import mocked modules to access their mocks
import ctxmenu from '@/shell/UI/lib/ctxmenu.js';
import { deleteNodeFromUI } from '@/shell/edge/UI-edge/graph/handleUIActions.ts';

const mockCtxmenuShow = vi.mocked(ctxmenu.show);
const mockDeleteNodeFromUI = vi.mocked(deleteNodeFromUI);

describe('VerticalMenuService', () => {
  let cy: Core;
  let container: HTMLDivElement;
  let service: VerticalMenuService;
  let mockDeps: VerticalMenuDependencies;

  beforeEach(() => {
    mockCtxmenuShow.mockClear();
    mockDeleteNodeFromUI.mockClear();

    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);

    cy = cytoscape({
      container: container,
      elements: [
        { data: { id: 'node1', label: 'Node 1' }, position: { x: 100, y: 100 } },
        { data: { id: 'node2', label: 'Node 2' }, position: { x: 200, y: 200 } },
        { data: { id: 'edge1', source: 'node1', target: 'node2' } },
      ],
      style: [
        { selector: 'node', style: { 'background-color': '#666', 'label': 'data(label)' } },
        { selector: 'edge', style: { 'width': 3, 'line-color': '#ccc' } },
      ],
      layout: { name: 'preset' },
    });

    mockDeps = {
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
    it('should set up event listeners on cytoscape instance', () => {
      service = new VerticalMenuService();
      service.initialize(cy, mockDeps);
      expect(service).toBeDefined();
    });
  });

  describe('canvas context menu', () => {
    it('should show context menu when right-clicking on canvas', () => {
      service = new VerticalMenuService();
      service.initialize(cy, mockDeps);
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      cy.emit('cxttap', { target: cy, position: { x: 300, y: 300 }, renderedPosition: { x: 300, y: 300 } } as any);
      expect(mockCtxmenuShow).toHaveBeenCalledTimes(1);
    });

    it('should include Add Node Here option', () => {
      service = new VerticalMenuService();
      service.initialize(cy, mockDeps);
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      cy.emit('cxttap', { target: cy, position: { x: 300, y: 300 }, renderedPosition: { x: 300, y: 300 } } as any);
      const menuItems = mockCtxmenuShow.mock.calls[0]?.[0] as MenuItem[];
      const addNodeItem = menuItems.find((item) => 'text' in item && item.text === 'Add Node Here');
      expect(addNodeItem).toBeDefined();
    });

    it('should include Delete Selected option when nodes are selected', () => {
      service = new VerticalMenuService();
      service.initialize(cy, mockDeps);
      // Select a node
      cy.getElementById('node1').select();
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      cy.emit('cxttap', { target: cy, position: { x: 300, y: 300 }, renderedPosition: { x: 300, y: 300 } } as any);
      const menuItems = mockCtxmenuShow.mock.calls[0]?.[0] as MenuItem[];
      const deleteItem = menuItems.find((item) => {
        if (!('text' in item)) return false;
        const text = typeof item.text === 'function' ? item.text() : item.text;
        return text.startsWith('Delete Selected');
      });
      expect(deleteItem).toBeDefined();
    });

    it('should not include Delete Selected option when no nodes are selected', () => {
      service = new VerticalMenuService();
      service.initialize(cy, mockDeps);
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      cy.emit('cxttap', { target: cy, position: { x: 300, y: 300 }, renderedPosition: { x: 300, y: 300 } } as any);
      const menuItems = mockCtxmenuShow.mock.calls[0]?.[0] as MenuItem[];
      const deleteItem = menuItems.find((item) => {
        if (!('text' in item)) return false;
        const text = typeof item.text === 'function' ? item.text() : item.text;
        return text.startsWith('Delete Selected');
      });
      expect(deleteItem).toBeUndefined();
    });
  });

});

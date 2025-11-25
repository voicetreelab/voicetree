import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import { VerticalMenuService, type VerticalMenuDependencies } from '@/shell/UI/cytoscape-graph-ui/services/VerticalMenuService.ts';
import type { MenuItem } from '@/shell/UI/lib/ctxmenu.d.ts';

// Mock ctxmenu
const mockCtxmenuShow = vi.fn();
const mockCtxmenuHide = vi.fn();
vi.mock('@/shell/UI/lib/ctxmenu.js', () => ({
  default: {
    show: (...args: unknown[]) => mockCtxmenuShow(...args),
    hide: () => mockCtxmenuHide(),
  },
}));

// Mock deleteNodeFromUI
const mockDeleteNodeFromUI = vi.fn().mockResolvedValue(undefined);
vi.mock('@/shell/edge/UI-edge/graph/handleUIActions.ts', () => ({
  createNewChildNodeFromUI: vi.fn().mockResolvedValue('new-child-id'),
  deleteNodeFromUI: (...args: unknown[]) => mockDeleteNodeFromUI(...args),
}));

// Mock getFilePathForNode
vi.mock('@/shell/edge/UI-edge/graph/getNodeFromMainToUI.ts', () => ({
  getFilePathForNode: vi.fn().mockResolvedValue('/path/to/node'),
}));

describe('VerticalMenuService', () => {
  let cy: Core;
  let container: HTMLDivElement;
  let service: VerticalMenuService;
  let mockDeps: VerticalMenuDependencies;

  beforeEach(() => {
    mockCtxmenuShow.mockClear();
    mockCtxmenuHide.mockClear();
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
    it('should set up event listeners on cytoscape instance', () => {
      service = new VerticalMenuService();
      service.initialize(cy, mockDeps);
      expect(service).toBeDefined();
    });

    it('should skip setup in headless mode', () => {
      const headlessCy = cytoscape({ headless: true });
      service = new VerticalMenuService();
      service.initialize(headlessCy, mockDeps);
      expect(service).toBeDefined();
      headlessCy.destroy();
    });
  });

  describe('node context menu', () => {
    it('should show context menu when right-clicking a node', () => {
      service = new VerticalMenuService();
      service.initialize(cy, mockDeps);
      const node = cy.getElementById('node1');
      // Emit from cy with node as target (how cytoscape actually triggers selector-based handlers)
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      (cy as any).emit({ type: 'cxttap', target: node, position: { x: 100, y: 100 }, renderedPosition: { x: 100, y: 100 } });
      expect(mockCtxmenuShow).toHaveBeenCalledTimes(1);
      const menuItems = mockCtxmenuShow.mock.calls[0]?.[0] as MenuItem[];
      expect(menuItems).toBeDefined();
      expect(menuItems.length).toBeGreaterThan(0);
    });

    it('should include all menu options', () => {
      service = new VerticalMenuService();
      service.initialize(cy, mockDeps);
      const node = cy.getElementById('node1');
      // Emit from cy with node as target (how cytoscape actually triggers selector-based handlers)
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      (cy as any).emit({ type: 'cxttap', target: node, position: { x: 100, y: 100 }, renderedPosition: { x: 100, y: 100 } });
      const menuItems = mockCtxmenuShow.mock.calls[0]?.[0] as MenuItem[];
      expect(menuItems).toHaveLength(5);
      const texts = menuItems.map((item) => 'text' in item ? item.text : '');
      expect(texts).toContain('Edit');
      expect(texts).toContain('Create Child');
      expect(texts).toContain('Terminal');
      expect(texts).toContain('Delete');
      expect(texts).toContain('Copy Path');
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
  });

  describe('destruction', () => {
    it('should hide menu and remove event listeners', () => {
      service = new VerticalMenuService();
      service.initialize(cy, mockDeps);
      service.destroy();
      expect(mockCtxmenuHide).toHaveBeenCalledTimes(1);
    });

    it('should not throw when destroying uninitialized service', () => {
      service = new VerticalMenuService();
      expect(() => service.destroy()).not.toThrow();
    });
  });
});

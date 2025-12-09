import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MockedFunction } from 'vitest';
import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import { VerticalMenuService, type VerticalMenuDependencies } from '@/shell/UI/cytoscape-graph-ui/services/VerticalMenuService';
import type { MenuItem } from '@/shell/UI/lib/ctxmenu.d';
import type { MenuConfig } from '@/shell/UI/lib/ctxmenu';

// Mock ctxmenu
vi.mock('@/shell/UI/lib/ctxmenu.js', () => ({
  default: {
    show: vi.fn(),
    hide: vi.fn(),
  },
}));

// Import mocked modules to access their mocks
import ctxmenu from '@/shell/UI/lib/ctxmenu.js';

const mockCtxmenuShow: MockedFunction<(menuItems: MenuItem[], eventOrElement: MouseEvent | Element, config?: MenuConfig) => void> = vi.mocked(ctxmenu.show);

describe('VerticalMenuService', () => {
  let cy: Core;
  let container: HTMLDivElement;
  let service: VerticalMenuService;
  let mockDeps: VerticalMenuDependencies;

  beforeEach(() => {
    mockCtxmenuShow.mockClear();

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

  describe('canvas context menu', () => {
    it('should show context menu with 3 items when right-clicking on canvas', () => {
      service = new VerticalMenuService();
      service.initialize(cy, mockDeps);
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      cy.emit('cxttap', { target: cy, position: { x: 300, y: 300 }, renderedPosition: { x: 300, y: 300 } } as any);

      expect(mockCtxmenuShow).toHaveBeenCalledTimes(1);
      const menuItems: MenuItem[] = mockCtxmenuShow.mock.calls[0]?.[0] as MenuItem[];
      expect(menuItems).toHaveLength(3);
    });

    it('should have Delete disabled when no nodes selected, enabled when nodes selected', () => {
      service = new VerticalMenuService();
      service.initialize(cy, mockDeps);

      // No selection - Delete should be disabled
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      cy.emit('cxttap', { target: cy, position: { x: 300, y: 300 }, renderedPosition: { x: 300, y: 300 } } as any);
      let menuItems: MenuItem[] = mockCtxmenuShow.mock.calls[0]?.[0] as MenuItem[];
      const deleteItem1: MenuItem | undefined = menuItems[1];
      expect(deleteItem1 && 'disabled' in deleteItem1 && deleteItem1.disabled).toBe(true);

      // With selection - Delete should be enabled
      mockCtxmenuShow.mockClear();
      cy.getElementById('node1').select();
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      cy.emit('cxttap', { target: cy, position: { x: 300, y: 300 }, renderedPosition: { x: 300, y: 300 } } as any);
      menuItems = mockCtxmenuShow.mock.calls[0]?.[0] as MenuItem[];
      const deleteItem2: MenuItem | undefined = menuItems[1];
      expect(deleteItem2 && 'disabled' in deleteItem2 && deleteItem2.disabled).toBeFalsy();
    });

    it('should have Merge disabled when <2 nodes selected, enabled when 2+ nodes selected', () => {
      service = new VerticalMenuService();
      service.initialize(cy, mockDeps);

      // No selection - Merge should be disabled
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      cy.emit('cxttap', { target: cy, position: { x: 300, y: 300 }, renderedPosition: { x: 300, y: 300 } } as any);
      let menuItems: MenuItem[] = mockCtxmenuShow.mock.calls[0]?.[0] as MenuItem[];
      const mergeItem1: MenuItem | undefined = menuItems[2];
      expect(mergeItem1 && 'disabled' in mergeItem1 && mergeItem1.disabled).toBe(true);

      // 1 node selected - Merge should be disabled
      mockCtxmenuShow.mockClear();
      cy.getElementById('node1').select();
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      cy.emit('cxttap', { target: cy, position: { x: 300, y: 300 }, renderedPosition: { x: 300, y: 300 } } as any);
      menuItems = mockCtxmenuShow.mock.calls[0]?.[0] as MenuItem[];
      const mergeItem2: MenuItem | undefined = menuItems[2];
      expect(mergeItem2 && 'disabled' in mergeItem2 && mergeItem2.disabled).toBe(true);

      // 2 nodes selected - Merge should be enabled
      mockCtxmenuShow.mockClear();
      cy.getElementById('node2').select();
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      cy.emit('cxttap', { target: cy, position: { x: 300, y: 300 }, renderedPosition: { x: 300, y: 300 } } as any);
      menuItems = mockCtxmenuShow.mock.calls[0]?.[0] as MenuItem[];
      const mergeItem3: MenuItem | undefined = menuItems[2];
      expect(mergeItem3 && 'disabled' in mergeItem3 && mergeItem3.disabled).toBeFalsy();
    });
  });

});

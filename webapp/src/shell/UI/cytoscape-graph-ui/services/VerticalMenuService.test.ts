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
    it('should show context menu with 5 items when right-clicking on canvas', () => {
      service = new VerticalMenuService();
      service.initialize(cy, mockDeps);
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      cy.emit('cxttap', { target: cy, position: { x: 300, y: 300 }, renderedPosition: { x: 300, y: 300 } } as any);

      expect(mockCtxmenuShow).toHaveBeenCalledTimes(1);
      const menuItems: MenuItem[] = mockCtxmenuShow.mock.calls[0]?.[0] as MenuItem[];
      expect(menuItems).toHaveLength(5);
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

    it('should have Run Agent on Selected enabled when nodes selected, disabled when no nodes selected', () => {
      service = new VerticalMenuService();
      service.initialize(cy, mockDeps);

      // No selection - Run Agent should be disabled with "(0 nodes selected)" text
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      cy.emit('cxttap', { target: cy, position: { x: 300, y: 300 }, renderedPosition: { x: 300, y: 300 } } as any);
      let menuItems: MenuItem[] = mockCtxmenuShow.mock.calls[0]?.[0] as MenuItem[];
      const runAgentItem1: MenuItem | undefined = menuItems[3];
      expect(runAgentItem1).toBeDefined();
      expect(runAgentItem1 && 'disabled' in runAgentItem1 && runAgentItem1.disabled).toBe(true);
      expect(runAgentItem1 && 'text' in runAgentItem1 && runAgentItem1.text).toContain('0 nodes selected');

      // With 1 node selected - Run Agent should be enabled with count in text
      mockCtxmenuShow.mockClear();
      cy.getElementById('node1').select();
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      cy.emit('cxttap', { target: cy, position: { x: 300, y: 300 }, renderedPosition: { x: 300, y: 300 } } as any);
      menuItems = mockCtxmenuShow.mock.calls[0]?.[0] as MenuItem[];
      const runAgentItem2: MenuItem | undefined = menuItems[3];
      expect(runAgentItem2).toBeDefined();
      expect(runAgentItem2 && 'disabled' in runAgentItem2 && runAgentItem2.disabled).toBeFalsy();
      expect(runAgentItem2 && 'text' in runAgentItem2 && runAgentItem2.text).toContain('Run Agent on Selected (1)');

      // With 2 nodes selected - Run Agent should be enabled with count 2
      mockCtxmenuShow.mockClear();
      cy.getElementById('node2').select();
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      cy.emit('cxttap', { target: cy, position: { x: 300, y: 300 }, renderedPosition: { x: 300, y: 300 } } as any);
      menuItems = mockCtxmenuShow.mock.calls[0]?.[0] as MenuItem[];
      const runAgentItem3: MenuItem | undefined = menuItems[3];
      expect(runAgentItem3).toBeDefined();
      expect(runAgentItem3 && 'disabled' in runAgentItem3 && runAgentItem3.disabled).toBeFalsy();
      expect(runAgentItem3 && 'text' in runAgentItem3 && runAgentItem3.text).toContain('Run Agent on Selected (2)');
    });

    it('should prefer the deepest folder with REAL compound nodes (not mocked collections)', () => {
      // This test uses a real cytoscape headless instance with compound (parent) nodes
      // to verify the z-index fix works against real cytoscape node collections.
      const headlessCy: Core = cytoscape({
        headless: true,
        elements: [
          // Outer folder (compound parent) — large bounding box
          {
            data: {
              id: 'outer-folder',
              isFolderNode: true,
              collapsed: false,
              folderLabel: 'Outer Folder',
            },
            position: { x: 200, y: 200 },
          },
          // Inner folder (compound child of outer) — smaller bounding box
          {
            data: {
              id: 'inner-folder',
              parent: 'outer-folder',
              isFolderNode: true,
              collapsed: false,
              folderLabel: 'Inner Folder',
            },
            position: { x: 200, y: 200 },
          },
          // A leaf node inside the inner folder so inner-folder has actual bounds
          {
            data: {
              id: 'leaf-node',
              parent: 'inner-folder',
              label: 'Leaf',
            },
            position: { x: 200, y: 200 },
          },
        ],
      });

      // Access getCanvasVerticalMenuItems directly via the service instance
      const localService: {
        cy: Core;
        deps: VerticalMenuDependencies;
        getCanvasVerticalMenuItems: (position: { x: number; y: number }) => MenuItem[];
      } = new VerticalMenuService() as unknown as {
        cy: Core;
        deps: VerticalMenuDependencies;
        getCanvasVerticalMenuItems: (position: { x: number; y: number }) => MenuItem[];
      };
      localService.cy = headlessCy;
      localService.deps = mockDeps;

      // Compute a click position that's inside both bounding boxes
      const outerBB: ReturnType<ReturnType<Core['getElementById']>['boundingBox']> = headlessCy.getElementById('outer-folder').boundingBox();
      const innerBB: ReturnType<ReturnType<Core['getElementById']>['boundingBox']> = headlessCy.getElementById('inner-folder').boundingBox();
      // Use center of the inner (smaller) bounding box — guaranteed to be inside both
      const clickX: number = (innerBB.x1 + innerBB.x2) / 2;
      const clickY: number = (innerBB.y1 + innerBB.y2) / 2;

      expect(clickX >= outerBB.x1 && clickX <= outerBB.x2 && clickY >= outerBB.y1 && clickY <= outerBB.y2).toBe(true);
      expect(clickX >= innerBB.x1 && clickX <= innerBB.x2 && clickY >= innerBB.y1 && clickY <= innerBB.y2).toBe(true);

      // Verify inner-folder has more ancestors than outer-folder (the sorting criterion)
      const outerAncestors: number = headlessCy.getElementById('outer-folder').ancestors().length;
      const innerAncestors: number = headlessCy.getElementById('inner-folder').ancestors().length;
      expect(innerAncestors).toBeGreaterThan(outerAncestors);

      // Now call the actual method — it should pick the inner (deepest) folder
      const menuItems: MenuItem[] = localService.getCanvasVerticalMenuItems({ x: clickX, y: clickY });

      // First menu item should be collapse for the INNER folder, not the outer
      expect(menuItems[0]?.text).toBe('Collapse "Inner Folder"');

      headlessCy.destroy();
    });

    it('should prefer the deepest folder when nested folder bounds overlap at the click position', () => {
      type FolderNodeLike = {
        length: number;
        boundingBox: () => { x1: number; x2: number; y1: number; y2: number };
        ancestors: () => { length: number };
        data: (key: string) => unknown;
        id: () => string;
      };

      type FolderCollectionLike = {
        filter: (predicate: (node: FolderNodeLike) => boolean) => FolderCollectionLike;
        sort: (compare: (a: FolderNodeLike, b: FolderNodeLike) => number) => FolderCollectionLike;
        first: () => FolderNodeLike;
      };

      const createFolderNode: (
        id: string,
        folderLabel: string,
        depth: number,
        bounds: { x1: number; x2: number; y1: number; y2: number },
      ) => FolderNodeLike = (
        id: string,
        folderLabel: string,
        depth: number,
        bounds: { x1: number; x2: number; y1: number; y2: number },
      ): FolderNodeLike => ({
        length: 1,
        boundingBox: () => bounds,
        ancestors: () => ({ length: depth }),
        data: (key: string) => ({ collapsed: false, folderLabel }[key]),
        id: () => id,
      });

      const createFolderCollection: (nodes: FolderNodeLike[]) => FolderCollectionLike = (nodes: FolderNodeLike[]): FolderCollectionLike => ({
        filter: (predicate) => createFolderCollection(nodes.filter(predicate)),
        sort: (compare) => createFolderCollection([...nodes].sort(compare)),
        first: () => nodes[0] ?? { length: 0 } as FolderNodeLike,
      });

      const parentFolder: FolderNodeLike = createFolderNode('parent-folder', 'Parent Folder', 0, {
        x1: 0,
        x2: 400,
        y1: 0,
        y2: 400,
      });
      const childFolder: FolderNodeLike = createFolderNode('child-folder', 'Child Folder', 1, {
        x1: 100,
        x2: 300,
        y1: 100,
        y2: 300,
      });

      const localService: {
        cy: Core;
        deps: VerticalMenuDependencies;
        getCanvasVerticalMenuItems: (position: { x: number; y: number }) => MenuItem[];
      } = new VerticalMenuService() as unknown as {
        cy: Core;
        deps: VerticalMenuDependencies;
        getCanvasVerticalMenuItems: (position: { x: number; y: number }) => MenuItem[];
      };
      localService.cy = {
        nodes: vi.fn().mockReturnValue(createFolderCollection([parentFolder, childFolder])),
        $: vi.fn().mockReturnValue({
          nodes: () => ({ size: () => 0 }),
        }),
      } as unknown as Core;
      localService.deps = mockDeps;

      const menuItems: MenuItem[] = localService.getCanvasVerticalMenuItems({ x: 200, y: 200 });

      expect(menuItems[0]?.text).toBe('Collapse "Child Folder"');
    });
  });

});

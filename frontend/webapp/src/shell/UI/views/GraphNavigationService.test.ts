import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { GraphNavigationService } from '@/shell/UI/views/GraphNavigationService';
import cytoscape, { type Core, type Collection } from 'cytoscape';
import '@/shell/UI/cytoscape-graph-ui'; // Import to trigger extension registration
import { vanillaFloatingWindowInstances } from '@/shell/edge/UI-edge/state/UIAppState';

describe('GraphNavigationService', () => {
  let service: GraphNavigationService;
  let cy: Core;
  let container: HTMLElement;

  beforeEach(() => {
    // Create cytoscape Core instance with test nodes
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);

    cy = cytoscape({
      container,
      elements: [
        { data: { id: 'node1', label: 'GraphNode 1' }, position: { x: 100, y: 100 } },
        { data: { id: 'node2', label: 'GraphNode 2' }, position: { x: 200, y: 200 } },
        { data: { id: 'node3', label: 'GraphNode 3' }, position: { x: 300, y: 300 } },
      ],
      headless: true
    });

    service = new GraphNavigationService(cy);
  });

  afterEach(() => {
    cy.destroy();
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  describe('fitToLastNode', () => {
    it('should fit viewport to last created node when one is set', () => {
      const fitSpy: MockInstance<(eles?: cytoscape.CollectionArgument | cytoscape.Selector, padding?: number) => cytoscape.Core> = vi.spyOn(cy, 'fit');

      service.setLastCreatedNodeId('node2');
      service.fitToLastNode();

      // Should have called fit with the node
      expect(fitSpy).toHaveBeenCalled();
      const callArgs: [eles?: string | cytoscape.CollectionArgument | undefined, padding?: number | undefined] = fitSpy.mock.calls[0];
      expect(((callArgs?.[0] as Collection).first()?.id() ?? "")).toBe('node2');
      // Should have padding argument (number, even if 0 in headless mode)
      expect(typeof callArgs[1]).toBe('number');
    });

    it('should do nothing when no last node is set', () => {
      const fitSpy: MockInstance<(eles?: cytoscape.CollectionArgument | cytoscape.Selector, padding?: number) => cytoscape.Core> = vi.spyOn(cy, 'fit');

      service.fitToLastNode();

      expect(fitSpy).not.toHaveBeenCalled();
    });

    it('should handle non-existent node gracefully', () => {
      const fitSpy: MockInstance<(eles?: cytoscape.CollectionArgument | cytoscape.Selector, padding?: number) => cytoscape.Core> = vi.spyOn(cy, 'fit');

      service.setLastCreatedNodeId('nonexistent-node');
      service.fitToLastNode();

      // Should not call fit for non-existent nodes
      expect(fitSpy).not.toHaveBeenCalled();
    });

    it('should update to new node when setLastCreatedNodeId is called multiple times', () => {
      const fitSpy: MockInstance<(eles?: cytoscape.CollectionArgument | cytoscape.Selector, padding?: number) => cytoscape.Core> = vi.spyOn(cy, 'fit');

      service.setLastCreatedNodeId('node1');
      service.fitToLastNode();

      expect(((fitSpy.mock.calls[0]?.[0] as Collection).first()?.id() ?? "")).toBe('node1');

      service.setLastCreatedNodeId('node3');
      service.fitToLastNode();

      expect(((fitSpy.mock.calls[1]?.[0] as Collection).first()?.id() ?? "")).toBe('node3');
    });
  });

  describe('cycleTerminal', () => {
    const mockFocus: MockInstance<() => void> = vi.fn();

    beforeEach(() => {
      // Use cy directly
      // Add terminal nodes (shadow nodes with windowType: 'Terminal')
      cy.add([
        {
          data: {
            id: 'terminal-node1',
            windowType: 'Terminal',
            isShadowNode: true,
            label: 'Terminal 1'
          },
          position: { x: 400, y: 100 }
        },
        {
          data: {
            id: 'terminal-node2',
            windowType: 'Terminal',
            isShadowNode: true,
            label: 'Terminal 2'
          },
          position: { x: 400, y: 200 }
        },
        {
          data: {
            id: 'terminal-node3',
            windowType: 'Terminal',
            isShadowNode: true,
            label: 'Terminal 3'
          },
          position: { x: 400, y: 300 }
        }
      ]);

      // Register mock terminal instance with focus
      mockFocus.mockClear();
      vanillaFloatingWindowInstances.set('terminal-node2', { dispose: vi.fn(), focus: mockFocus as unknown as () => void });
    });

    afterEach(() => {
      vanillaFloatingWindowInstances.delete('terminal-node2');
    });

    it('should cycle to next terminal in forward direction', () => {
      // Use cy directly
      const fitSpy: MockInstance<(eles?: cytoscape.CollectionArgument | cytoscape.Selector, padding?: number) => cytoscape.Core> = vi.spyOn(cy, 'fit');

      service.cycleTerminal(1);

      // Increments from 0 to 1, fits to terminal at index 1
      expect(fitSpy).toHaveBeenCalled();
      const fittedNode: cytoscape.Collection<cytoscape.SingularElementReturnValue, cytoscape.SingularElementArgument> = fitSpy.mock.calls[0]?.[0] as Collection;
      expect(fittedNode.first()?.id()).toBe('terminal-node2');
      expect(mockFocus).toHaveBeenCalled(); // Auto-focus on cycled terminal
    });

    it('should cycle through all terminals in forward direction', () => {
      // Use cy directly
      const fitSpy: MockInstance<(eles?: cytoscape.CollectionArgument | cytoscape.Selector, padding?: number) => cytoscape.Core> = vi.spyOn(cy, 'fit');

      service.cycleTerminal(1);
      expect(((fitSpy.mock.calls[0]?.[0] as Collection).first()?.id() ?? "")).toBe('terminal-node2'); // index 0->1

      service.cycleTerminal(1);
      expect(((fitSpy.mock.calls[1]?.[0] as Collection).first()?.id() ?? "")).toBe('terminal-node3'); // index 1->2

      service.cycleTerminal(1);
      expect(((fitSpy.mock.calls[2]?.[0] as Collection).first()?.id() ?? "")).toBe('terminal-node1'); // index 2->0 (wrap)
    });

    it('should wrap around to first terminal after last one in forward direction', () => {
      // Use cy directly
      const fitSpy: MockInstance<(eles?: cytoscape.CollectionArgument | cytoscape.Selector, padding?: number) => cytoscape.Core> = vi.spyOn(cy, 'fit');

      // Cycle through all terminals
      service.cycleTerminal(1); // 0->1: terminal-node2
      service.cycleTerminal(1); // 1->2: terminal-node3
      service.cycleTerminal(1); // 2->0: terminal-node1
      expect(((fitSpy.mock.calls[2]?.[0] as Collection).first()?.id() ?? "")).toBe('terminal-node1');

      // Next cycle should wrap to second terminal
      service.cycleTerminal(1); // 0->1: terminal-node2
      expect(((fitSpy.mock.calls[3]?.[0] as Collection).first()?.id() ?? "")).toBe('terminal-node2');
    });

    it('should cycle to previous terminal in backward direction', () => {
      // Use cy directly
      const fitSpy: MockInstance<(eles?: cytoscape.CollectionArgument | cytoscape.Selector, padding?: number) => cytoscape.Core> = vi.spyOn(cy, 'fit');

      // Backward from initial position (0) wraps to last terminal
      service.cycleTerminal(-1);

      expect(fitSpy).toHaveBeenCalled();
      const fittedNode: cytoscape.Collection<cytoscape.SingularElementReturnValue, cytoscape.SingularElementArgument> = (fitSpy.mock.calls[0]?.[0] as Collection);
      expect(fittedNode.first()?.id()).toBe('terminal-node3');
    });

    it('should cycle through all terminals in backward direction', () => {
      // Use cy directly
      const fitSpy: MockInstance<(eles?: cytoscape.CollectionArgument | cytoscape.Selector, padding?: number) => cytoscape.Core> = vi.spyOn(cy, 'fit');

      service.cycleTerminal(-1);
      expect(((fitSpy.mock.calls[0]?.[0] as Collection).first()?.id() ?? "")).toBe('terminal-node3');

      service.cycleTerminal(-1);
      expect(((fitSpy.mock.calls[1]?.[0] as Collection).first()?.id() ?? "")).toBe('terminal-node2');

      service.cycleTerminal(-1);
      expect(((fitSpy.mock.calls[2]?.[0] as Collection).first()?.id() ?? "")).toBe('terminal-node1');
    });

    it('should wrap around to last terminal after first one in backward direction', () => {
      // Use cy directly
      const fitSpy: MockInstance<(eles?: cytoscape.CollectionArgument | cytoscape.Selector, padding?: number) => cytoscape.Core> = vi.spyOn(cy, 'fit');

      // Cycle backward to wrap to last
      service.cycleTerminal(-1);
      expect(((fitSpy.mock.calls[0]?.[0] as Collection).first()?.id() ?? "")).toBe('terminal-node3');

      // Continue backward through all
      service.cycleTerminal(-1);
      service.cycleTerminal(-1);
      expect(((fitSpy.mock.calls[2]?.[0] as Collection).first()?.id() ?? "")).toBe('terminal-node1');

      // Wrap around again
      service.cycleTerminal(-1);
      expect(((fitSpy.mock.calls[3]?.[0] as Collection).first()?.id() ?? "")).toBe('terminal-node3');
    });

    it('should do nothing when no terminal nodes exist', () => {
      // Use cy directly
      // Remove all terminal nodes
      cy.remove('node[windowType = "Terminal"]');

      const fitSpy: MockInstance<(eles?: cytoscape.CollectionArgument | cytoscape.Selector, padding?: number) => cytoscape.Core> = vi.spyOn(cy, 'fit');

      service.cycleTerminal(1);

      expect(fitSpy).not.toHaveBeenCalled();
    });

    it('should only cycle through nodes with windowType=Terminal and isShadowNode=true', () => {
      // Use cy directly
      // Add a node with windowType Terminal but not a shadow node
      cy.add({
        data: {
          id: 'terminal-fake',
          windowType: 'Terminal',
          isShadowNode: false,
          label: 'Not a real terminal'
        },
        position: { x: 500, y: 100 }
      });

      // Add a shadow node without windowType Terminal
      cy.add({
        data: {
          id: 'shadow-other',
          isShadowNode: true,
          label: 'Other shadow'
        },
        position: { x: 500, y: 200 }
      });

      const fitSpy: MockInstance<(eles?: cytoscape.CollectionArgument | cytoscape.Selector, padding?: number) => cytoscape.Core> = vi.spyOn(cy, 'fit');

      // Cycle through - should only hit the 3 real terminals
      // Starting from index 0, cycling forward hits indices 1, 2, 0
      service.cycleTerminal(1); // 0->1: terminal-node2
      service.cycleTerminal(1); // 1->2: terminal-node3
      service.cycleTerminal(1); // 2->0: terminal-node1

      const fittedIds: string[] = fitSpy.mock.calls.map((call => (call?.[0] as Collection).first()?.id() ?? ""));
      expect(fittedIds).toEqual(['terminal-node2', 'terminal-node3', 'terminal-node1']);
    });

    it('should handle single terminal node correctly', () => {
      // Use cy directly
      // Remove all terminals except one
      cy.remove('#terminal-node2, #terminal-node3');

      const fitSpy: MockInstance<(eles?: cytoscape.CollectionArgument | cytoscape.Selector, padding?: number) => cytoscape.Core> = vi.spyOn(cy, 'fit');

      service.cycleTerminal(1);
      expect(((fitSpy.mock.calls[0]?.[0] as Collection).first()?.id() ?? "")).toBe('terminal-node1');

      service.cycleTerminal(1);
      expect(((fitSpy.mock.calls[1]?.[0] as Collection).first()?.id() ?? "")).toBe('terminal-node1');

      service.cycleTerminal(-1);
      expect(((fitSpy.mock.calls[2]?.[0] as Collection).first()?.id() ?? "")).toBe('terminal-node1');
    });
  });

  describe('handleSearchSelect', () => {
    it('should fit viewport to selected node', () => {
      // Use cy directly
      const fitSpy: MockInstance<(eles?: cytoscape.CollectionArgument | cytoscape.Selector, padding?: number) => cytoscape.Core> = vi.spyOn(cy, 'fit');

      service.handleSearchSelect('node2');

      expect(fitSpy).toHaveBeenCalled();
      expect(((fitSpy.mock.calls[0]?.[0] as Collection).first()?.id() ?? "")).toBe('node2');
    });

    it('should highlight selected node by adding highlighted class', () => {
      // Use cy directly
      const node: cytoscape.CollectionReturnValue = cy.getElementById('node2');
      const addClassSpy: MockInstance<(classes: cytoscape.ClassNames) => cytoscape.CollectionReturnValue> = vi.spyOn(node, 'addClass');

      service.handleSearchSelect('node2');

      expect(addClassSpy).toHaveBeenCalledWith('highlighted');
    });

    it('should remove highlight after timeout', () => {
      vi.useFakeTimers();

      // Use cy directly
      const node: cytoscape.CollectionReturnValue = cy.getElementById('node2');
      const removeClassSpy: MockInstance<(classes: cytoscape.ClassNames) => cytoscape.CollectionReturnValue> = vi.spyOn(node, 'removeClass');

      service.handleSearchSelect('node2');

      // Should not be removed immediately
      expect(removeClassSpy).not.toHaveBeenCalled();

      // Should be removed after 1000ms
      vi.advanceTimersByTime(1000);
      expect(removeClassSpy).toHaveBeenCalledWith('highlighted');

      vi.useRealTimers();
    });

    it('should handle non-existent node gracefully without throwing', () => {
      // Use cy directly
      const fitSpy: MockInstance<(eles?: cytoscape.CollectionArgument | cytoscape.Selector, padding?: number) => cytoscape.Core> = vi.spyOn(cy, 'fit');

      expect(() => {
        service.handleSearchSelect('nonexistent-node');
      }).not.toThrow();

      // Should not call fit for non-existent nodes
      expect(fitSpy).not.toHaveBeenCalled();
    });

    it('should use appropriate padding for search results', () => {
      // Use cy directly
      const fitSpy: MockInstance<(eles?: cytoscape.CollectionArgument | cytoscape.Selector, padding?: number) => cytoscape.Core> = vi.spyOn(cy, 'fit');

      service.handleSearchSelect('node1');

      // Second argument should be padding (number, even if 0 in headless mode)
      expect(typeof fitSpy.mock.calls[0][1]).toBe('number');
    });
  });

  describe('navigation integration', () => {
    it('should maintain independent state for different navigation actions', () => {
      // Use cy directly
      // Add terminals
      cy.add([
        { data: { id: 'terminal-a', windowType: 'Terminal', isShadowNode: true }, position: { x: 400, y: 100 } },
        { data: { id: 'terminal-b', windowType: 'Terminal', isShadowNode: true }, position: { x: 400, y: 200 } }
      ]);

      const fitSpy: MockInstance<(eles?: cytoscape.CollectionArgument | cytoscape.Selector, padding?: number) => cytoscape.Core> = vi.spyOn(cy, 'fit');

      // Set last node and fit to it
      service.setLastCreatedNodeId('node1');
      service.fitToLastNode();
      expect(((fitSpy.mock.calls[0]?.[0] as Collection).first()?.id() ?? "")).toBe('node1');

      // Cycle terminal - should not affect last node
      // Starting from index 0, increments to 1 (terminal-b)
      service.cycleTerminal(1); // 0->1: terminal-b
      expect(((fitSpy.mock.calls[1]?.[0] as Collection).first()?.id() ?? "")).toBe('terminal-b');

      // Fit to last node again - should still be node1
      service.fitToLastNode();
      expect(((fitSpy.mock.calls[2]?.[0] as Collection).first()?.id() ?? "")).toBe('node1');

      // Handle search select - should not affect either
      service.handleSearchSelect('node2');
      expect(((fitSpy.mock.calls[3]?.[0] as Collection).first()?.id() ?? "")).toBe('node2');

      // Last node and terminal cycling should still work independently
      service.fitToLastNode();
      expect(((fitSpy.mock.calls[4]?.[0] as Collection).first()?.id() ?? "")).toBe('node1');

      service.cycleTerminal(1); // 1->0: terminal-a
      expect(((fitSpy.mock.calls[5]?.[0] as Collection).first()?.id() ?? "")).toBe('terminal-a');
    });
  });
});

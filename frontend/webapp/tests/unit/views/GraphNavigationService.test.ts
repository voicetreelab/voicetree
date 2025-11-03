import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GraphNavigationService } from '@/views/GraphNavigationService';
import { CytoscapeCore } from '@/graph-core';

describe('GraphNavigationService', () => {
  let service: GraphNavigationService;
  let cy: CytoscapeCore;
  let container: HTMLElement;

  beforeEach(() => {
    // Create CytoscapeCore instance with test nodes
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);

    cy = new CytoscapeCore(container, [
      { data: { id: 'node1', label: 'Node 1' }, position: { x: 100, y: 100 } },
      { data: { id: 'node2', label: 'Node 2' }, position: { x: 200, y: 200 } },
      { data: { id: 'node3', label: 'Node 3' }, position: { x: 300, y: 300 } },
    ], true);

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
      const coreInstance = cy.getCore();
      const fitSpy = vi.spyOn(coreInstance, 'fit');

      service.setLastCreatedNodeId('node2');
      service.fitToLastNode();

      // Should have called fit with the node
      expect(fitSpy).toHaveBeenCalled();
      const callArgs = fitSpy.mock.calls[0];
      expect(callArgs[0].id()).toBe('node2');
      // Should have padding argument (number, even if 0 in headless mode)
      expect(typeof callArgs[1]).toBe('number');
    });

    it('should do nothing when no last node is set', () => {
      const coreInstance = cy.getCore();
      const fitSpy = vi.spyOn(coreInstance, 'fit');

      service.fitToLastNode();

      expect(fitSpy).not.toHaveBeenCalled();
    });

    it('should handle non-existent node gracefully', () => {
      const coreInstance = cy.getCore();
      const fitSpy = vi.spyOn(coreInstance, 'fit');

      service.setLastCreatedNodeId('nonexistent-node');
      service.fitToLastNode();

      // Should not call fit for non-existent nodes
      expect(fitSpy).not.toHaveBeenCalled();
    });

    it('should update to new node when setLastCreatedNodeId is called multiple times', () => {
      const coreInstance = cy.getCore();
      const fitSpy = vi.spyOn(coreInstance, 'fit');

      service.setLastCreatedNodeId('node1');
      service.fitToLastNode();

      expect(fitSpy.mock.calls[0][0].id()).toBe('node1');

      service.setLastCreatedNodeId('node3');
      service.fitToLastNode();

      expect(fitSpy.mock.calls[1][0].id()).toBe('node3');
    });
  });

  describe('cycleTerminal', () => {
    beforeEach(() => {
      const coreInstance = cy.getCore();
      // Add terminal nodes (shadow nodes with terminal- prefix)
      coreInstance.add([
        {
          data: {
            id: 'terminal-node1',
            isShadowNode: true,
            label: 'Terminal 1'
          },
          position: { x: 400, y: 100 }
        },
        {
          data: {
            id: 'terminal-node2',
            isShadowNode: true,
            label: 'Terminal 2'
          },
          position: { x: 400, y: 200 }
        },
        {
          data: {
            id: 'terminal-node3',
            isShadowNode: true,
            label: 'Terminal 3'
          },
          position: { x: 400, y: 300 }
        }
      ]);
    });

    it('should cycle to next terminal in forward direction', () => {
      const coreInstance = cy.getCore();
      const fitSpy = vi.spyOn(coreInstance, 'fit');

      service.cycleTerminal(1);

      // Increments from 0 to 1, fits to terminal at index 1
      expect(fitSpy).toHaveBeenCalled();
      const fittedNode = fitSpy.mock.calls[0][0];
      expect(fittedNode.id()).toBe('terminal-node2');
    });

    it('should cycle through all terminals in forward direction', () => {
      const coreInstance = cy.getCore();
      const fitSpy = vi.spyOn(coreInstance, 'fit');

      service.cycleTerminal(1);
      expect(fitSpy.mock.calls[0][0].id()).toBe('terminal-node2'); // index 0->1

      service.cycleTerminal(1);
      expect(fitSpy.mock.calls[1][0].id()).toBe('terminal-node3'); // index 1->2

      service.cycleTerminal(1);
      expect(fitSpy.mock.calls[2][0].id()).toBe('terminal-node1'); // index 2->0 (wrap)
    });

    it('should wrap around to first terminal after last one in forward direction', () => {
      const coreInstance = cy.getCore();
      const fitSpy = vi.spyOn(coreInstance, 'fit');

      // Cycle through all terminals
      service.cycleTerminal(1); // 0->1: terminal-node2
      service.cycleTerminal(1); // 1->2: terminal-node3
      service.cycleTerminal(1); // 2->0: terminal-node1
      expect(fitSpy.mock.calls[2][0].id()).toBe('terminal-node1');

      // Next cycle should wrap to second terminal
      service.cycleTerminal(1); // 0->1: terminal-node2
      expect(fitSpy.mock.calls[3][0].id()).toBe('terminal-node2');
    });

    it('should cycle to previous terminal in backward direction', () => {
      const coreInstance = cy.getCore();
      const fitSpy = vi.spyOn(coreInstance, 'fit');

      // Backward from initial position (0) wraps to last terminal
      service.cycleTerminal(-1);

      expect(fitSpy).toHaveBeenCalled();
      const fittedNode = fitSpy.mock.calls[0][0];
      expect(fittedNode.id()).toBe('terminal-node3');
    });

    it('should cycle through all terminals in backward direction', () => {
      const coreInstance = cy.getCore();
      const fitSpy = vi.spyOn(coreInstance, 'fit');

      service.cycleTerminal(-1);
      expect(fitSpy.mock.calls[0][0].id()).toBe('terminal-node3');

      service.cycleTerminal(-1);
      expect(fitSpy.mock.calls[1][0].id()).toBe('terminal-node2');

      service.cycleTerminal(-1);
      expect(fitSpy.mock.calls[2][0].id()).toBe('terminal-node1');
    });

    it('should wrap around to last terminal after first one in backward direction', () => {
      const coreInstance = cy.getCore();
      const fitSpy = vi.spyOn(coreInstance, 'fit');

      // Cycle backward to wrap to last
      service.cycleTerminal(-1);
      expect(fitSpy.mock.calls[0][0].id()).toBe('terminal-node3');

      // Continue backward through all
      service.cycleTerminal(-1);
      service.cycleTerminal(-1);
      expect(fitSpy.mock.calls[2][0].id()).toBe('terminal-node1');

      // Wrap around again
      service.cycleTerminal(-1);
      expect(fitSpy.mock.calls[3][0].id()).toBe('terminal-node3');
    });

    it('should do nothing when no terminal nodes exist', () => {
      const coreInstance = cy.getCore();
      // Remove all terminal nodes
      coreInstance.remove('node[id ^= "terminal-"]');

      const fitSpy = vi.spyOn(coreInstance, 'fit');

      service.cycleTerminal(1);

      expect(fitSpy).not.toHaveBeenCalled();
    });

    it('should only cycle through nodes with terminal- prefix and isShadowNode=true', () => {
      const coreInstance = cy.getCore();
      // Add a node with terminal prefix but not a shadow node
      coreInstance.add({
        data: {
          id: 'terminal-fake',
          isShadowNode: false,
          label: 'Not a real terminal'
        },
        position: { x: 500, y: 100 }
      });

      // Add a shadow node without terminal prefix
      coreInstance.add({
        data: {
          id: 'shadow-other',
          isShadowNode: true,
          label: 'Other shadow'
        },
        position: { x: 500, y: 200 }
      });

      const fitSpy = vi.spyOn(coreInstance, 'fit');

      // Cycle through - should only hit the 3 real terminals
      // Starting from index 0, cycling forward hits indices 1, 2, 0
      service.cycleTerminal(1); // 0->1: terminal-node2
      service.cycleTerminal(1); // 1->2: terminal-node3
      service.cycleTerminal(1); // 2->0: terminal-node1

      const fittedIds = fitSpy.mock.calls.map(call => call[0].id());
      expect(fittedIds).toEqual(['terminal-node2', 'terminal-node3', 'terminal-node1']);
    });

    it('should handle single terminal node correctly', () => {
      const coreInstance = cy.getCore();
      // Remove all terminals except one
      coreInstance.remove('#terminal-node2, #terminal-node3');

      const fitSpy = vi.spyOn(coreInstance, 'fit');

      service.cycleTerminal(1);
      expect(fitSpy.mock.calls[0][0].id()).toBe('terminal-node1');

      service.cycleTerminal(1);
      expect(fitSpy.mock.calls[1][0].id()).toBe('terminal-node1');

      service.cycleTerminal(-1);
      expect(fitSpy.mock.calls[2][0].id()).toBe('terminal-node1');
    });
  });

  describe('handleSearchSelect', () => {
    it('should fit viewport to selected node', () => {
      const coreInstance = cy.getCore();
      const fitSpy = vi.spyOn(coreInstance, 'fit');

      service.handleSearchSelect('node2');

      expect(fitSpy).toHaveBeenCalled();
      expect(fitSpy.mock.calls[0][0].id()).toBe('node2');
    });

    it('should highlight selected node by adding highlighted class', () => {
      const coreInstance = cy.getCore();
      const node = coreInstance.getElementById('node2');
      const addClassSpy = vi.spyOn(node, 'addClass');

      service.handleSearchSelect('node2');

      expect(addClassSpy).toHaveBeenCalledWith('highlighted');
    });

    it('should remove highlight after timeout', () => {
      vi.useFakeTimers();

      const coreInstance = cy.getCore();
      const node = coreInstance.getElementById('node2');
      const removeClassSpy = vi.spyOn(node, 'removeClass');

      service.handleSearchSelect('node2');

      // Should not be removed immediately
      expect(removeClassSpy).not.toHaveBeenCalled();

      // Should be removed after 1000ms
      vi.advanceTimersByTime(1000);
      expect(removeClassSpy).toHaveBeenCalledWith('highlighted');

      vi.useRealTimers();
    });

    it('should handle non-existent node gracefully without throwing', () => {
      const coreInstance = cy.getCore();
      const fitSpy = vi.spyOn(coreInstance, 'fit');

      expect(() => {
        service.handleSearchSelect('nonexistent-node');
      }).not.toThrow();

      // Should not call fit for non-existent nodes
      expect(fitSpy).not.toHaveBeenCalled();
    });

    it('should use appropriate padding for search results', () => {
      const coreInstance = cy.getCore();
      const fitSpy = vi.spyOn(coreInstance, 'fit');

      service.handleSearchSelect('node1');

      // Second argument should be padding (number, even if 0 in headless mode)
      expect(typeof fitSpy.mock.calls[0][1]).toBe('number');
    });
  });

  describe('navigation integration', () => {
    it('should maintain independent state for different navigation actions', () => {
      const coreInstance = cy.getCore();
      // Add terminals
      coreInstance.add([
        { data: { id: 'terminal-a', isShadowNode: true }, position: { x: 400, y: 100 } },
        { data: { id: 'terminal-b', isShadowNode: true }, position: { x: 400, y: 200 } }
      ]);

      const fitSpy = vi.spyOn(coreInstance, 'fit');

      // Set last node and fit to it
      service.setLastCreatedNodeId('node1');
      service.fitToLastNode();
      expect(fitSpy.mock.calls[0][0].id()).toBe('node1');

      // Cycle terminal - should not affect last node
      // Starting from index 0, increments to 1 (terminal-b)
      service.cycleTerminal(1); // 0->1: terminal-b
      expect(fitSpy.mock.calls[1][0].id()).toBe('terminal-b');

      // Fit to last node again - should still be node1
      service.fitToLastNode();
      expect(fitSpy.mock.calls[2][0].id()).toBe('node1');

      // Handle search select - should not affect either
      service.handleSearchSelect('node2');
      expect(fitSpy.mock.calls[3][0].id()).toBe('node2');

      // Last node and terminal cycling should still work independently
      service.fitToLastNode();
      expect(fitSpy.mock.calls[4][0].id()).toBe('node1');

      service.cycleTerminal(1); // 1->0: terminal-a
      expect(fitSpy.mock.calls[5][0].id()).toBe('terminal-a');
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { GraphNavigationService } from '@/shell/edge/UI-edge/graph/navigation/GraphNavigationService';
import cytoscape, { type Core, type Collection } from 'cytoscape';
import '@/shell/UI/cytoscape-graph-ui'; // Import to trigger extension registration
import { vanillaFloatingWindowInstances } from '@/shell/edge/UI-edge/state/UIAppState';
import { addTerminal, clearTerminals } from '@/shell/edge/UI-edge/state/TerminalStore';
import { createTerminalData, getShadowNodeId, getTerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import type { NodeIdAndFilePath } from '@/pure/graph';

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
    it('should animate viewport to last created node when one is set', () => {
      const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

      service.setLastCreatedNodeId('node2');
      service.fitToLastNode();

      // Should have called animate with center on the node
      expect(animateSpy).toHaveBeenCalled();
      const animateArgs: { center: { eles: Collection }, zoom?: number, duration?: number } = animateSpy.mock.calls[0][0] as { center: { eles: Collection }, zoom: number, duration: number };
      expect((animateArgs.center.eles.first()?.id() ?? "")).toBe('node2');
      expect(typeof animateArgs.zoom).toBe('number');
      expect(typeof animateArgs.duration).toBe('number');
    });

    it('should do nothing when no last node is set', () => {
      const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

      service.fitToLastNode();

      expect(animateSpy).not.toHaveBeenCalled();
    });

    it('should handle non-existent node gracefully', () => {
      const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

      service.setLastCreatedNodeId('nonexistent-node');
      service.fitToLastNode();

      // Should not call animate for non-existent nodes
      expect(animateSpy).not.toHaveBeenCalled();
    });

    it('should update to new node when setLastCreatedNodeId is called multiple times', () => {
      const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

      service.setLastCreatedNodeId('node1');
      service.fitToLastNode();

      const firstCall: { center: { eles: Collection } } = animateSpy.mock.calls[0][0] as { center: { eles: Collection } };
      expect((firstCall.center.eles.first()?.id() ?? "")).toBe('node1');

      service.setLastCreatedNodeId('node3');
      service.fitToLastNode();

      const secondCall: { center: { eles: Collection } } = animateSpy.mock.calls[1][0] as { center: { eles: Collection } };
      expect((secondCall.center.eles.first()?.id() ?? "")).toBe('node3');
    });
  });

  describe('cycleTerminal', () => {
    const mockFocus: MockInstance<() => void> = vi.fn();

    // Helper to create and register a terminal
    function createTestTerminal(attachedToNodeId: string, terminalCount: number): { terminalData: ReturnType<typeof createTerminalData>, shadowNodeId: string } {
      const terminalData: ReturnType<typeof createTerminalData> = createTerminalData({
        attachedToNodeId: attachedToNodeId as NodeIdAndFilePath,
        terminalCount,
        title: `Terminal ${terminalCount}`
      });
      addTerminal(terminalData);
      const shadowNodeId: string = getShadowNodeId(getTerminalId(terminalData));
      return { terminalData, shadowNodeId };
    }

    beforeEach(() => {
      // Clear any existing terminals
      clearTerminals();

      // Create terminals in TerminalStore and add shadow nodes to cy
      const terminal1: { terminalData: ReturnType<typeof createTerminalData>, shadowNodeId: string } = createTestTerminal('node1', 0);
      const terminal2: { terminalData: ReturnType<typeof createTerminalData>, shadowNodeId: string } = createTestTerminal('node2', 0);
      const terminal3: { terminalData: ReturnType<typeof createTerminalData>, shadowNodeId: string } = createTestTerminal('node3', 0);

      // Add shadow nodes to cytoscape (mimics what the UI does)
      cy.add([
        {
          data: {
            id: terminal1.shadowNodeId,
            windowType: 'Terminal',
            isShadowNode: true,
            parentNodeId: 'node1',
            label: 'Terminal 1'
          },
          position: { x: 400, y: 100 }
        },
        {
          data: {
            id: terminal2.shadowNodeId,
            windowType: 'Terminal',
            isShadowNode: true,
            parentNodeId: 'node2',
            label: 'Terminal 2'
          },
          position: { x: 400, y: 200 }
        },
        {
          data: {
            id: terminal3.shadowNodeId,
            windowType: 'Terminal',
            isShadowNode: true,
            parentNodeId: 'node3',
            label: 'Terminal 3'
          },
          position: { x: 400, y: 300 }
        }
      ]);

      // Add edges between regular nodes to create neighborhood
      // node1 -> node2 (so node2's neighborhood includes node1 and node3)
      // node2 -> node3
      cy.add([
        { data: { id: 'edge-1-2', source: 'node1', target: 'node2' } },
        { data: { id: 'edge-2-3', source: 'node2', target: 'node3' } }
      ]);

      // Register mock terminal instance with focus (use terminalId, not shadowNodeId)
      mockFocus.mockClear();
      vanillaFloatingWindowInstances.set(getTerminalId(terminal2.terminalData), { dispose: vi.fn(), focus: mockFocus as unknown as () => void });
    });

    afterEach(() => {
      clearTerminals();
      // Clear all registered vanilla instances
      vanillaFloatingWindowInstances.clear();
    });

    // Helper to get expected shadow node ID for a context node
    const getShadowNodeIdForContext: (contextNodeId: string) => string = (contextNodeId: string): string => {
      return `${contextNodeId}-terminal-0-anchor-shadowNode`;
    };

    it('should cycle to next terminal in forward direction', () => {
      const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

      service.cycleTerminal(1);

      // Increments from 0 to 1, sorted alphabetically by terminal ID
      // node1-terminal-0 < node2-terminal-0 < node3-terminal-0, so index 1 = node2
      expect(animateSpy).toHaveBeenCalled();
      const animateArgs: { center: { eles: Collection }, zoom?: number, duration?: number } = animateSpy.mock.calls[0][0] as { center: { eles: Collection } };
      const fittedIds: string[] = animateArgs.center.eles.map((n) => n.id());
      // Should include terminal shadow node and its context node's neighborhood (node2's neighbors: node1, node3)
      expect(fittedIds).toContain(getShadowNodeIdForContext('node2'));
      expect(fittedIds).toContain('node2'); // context node
      expect(fittedIds).toContain('node1'); // neighbor of node2
      expect(fittedIds).toContain('node3'); // neighbor of node2
      expect(mockFocus).toHaveBeenCalled(); // Auto-focus on cycled terminal
    });

    it('should cycle through all terminals in forward direction', () => {
      const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

      // Helper to check if collection includes terminal shadow node
      const getAnimatedEles: (callIndex: number) => Collection = (callIndex: number): Collection =>
        (animateSpy.mock.calls[callIndex][0] as { center: { eles: Collection } }).center.eles;
      const collectionIncludesTerminal: (collection: Collection, shadowNodeId: string) => boolean = (collection: Collection, shadowNodeId: string): boolean =>
        collection.map((n) => n.id()).includes(shadowNodeId);

      // Terminals sorted alphabetically: node1-terminal-0 < node2-terminal-0 < node3-terminal-0
      service.cycleTerminal(1); // 0->1: node2
      expect(collectionIncludesTerminal(getAnimatedEles(0), getShadowNodeIdForContext('node2'))).toBe(true);

      service.cycleTerminal(1); // 1->2: node3
      expect(collectionIncludesTerminal(getAnimatedEles(1), getShadowNodeIdForContext('node3'))).toBe(true);

      service.cycleTerminal(1); // 2->0: node1 (wrap)
      expect(collectionIncludesTerminal(getAnimatedEles(2), getShadowNodeIdForContext('node1'))).toBe(true);
    });

    it('should wrap around to first terminal after last one in forward direction', () => {
      const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

      const getAnimatedEles: (callIndex: number) => Collection = (callIndex: number): Collection =>
        (animateSpy.mock.calls[callIndex][0] as { center: { eles: Collection } }).center.eles;
      const collectionIncludesTerminal: (collection: Collection, shadowNodeId: string) => boolean = (collection: Collection, shadowNodeId: string): boolean =>
        collection.map((n) => n.id()).includes(shadowNodeId);

      // Cycle through all terminals
      service.cycleTerminal(1); // 0->1: node2
      service.cycleTerminal(1); // 1->2: node3
      service.cycleTerminal(1); // 2->0: node1
      expect(collectionIncludesTerminal(getAnimatedEles(2), getShadowNodeIdForContext('node1'))).toBe(true);

      // Next cycle should wrap to second terminal
      service.cycleTerminal(1); // 0->1: node2
      expect(collectionIncludesTerminal(getAnimatedEles(3), getShadowNodeIdForContext('node2'))).toBe(true);
    });

    it('should cycle to previous terminal in backward direction', () => {
      const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

      // Backward from initial position (0) wraps to last terminal (node3)
      service.cycleTerminal(-1);

      expect(animateSpy).toHaveBeenCalled();
      const animateArgs: { center: { eles: Collection }, zoom?: number, duration?: number } = animateSpy.mock.calls[0][0] as { center: { eles: Collection } };
      const fittedIds: string[] = animateArgs.center.eles.map((n) => n.id());
      expect(fittedIds).toContain(getShadowNodeIdForContext('node3'));
    });

    it('should cycle through all terminals in backward direction', () => {
      const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

      const getAnimatedEles: (callIndex: number) => Collection = (callIndex: number): Collection =>
        (animateSpy.mock.calls[callIndex][0] as { center: { eles: Collection } }).center.eles;
      const collectionIncludesTerminal: (collection: Collection, shadowNodeId: string) => boolean = (collection: Collection, shadowNodeId: string): boolean =>
        collection.map((n) => n.id()).includes(shadowNodeId);

      service.cycleTerminal(-1); // 0->2: node3
      expect(collectionIncludesTerminal(getAnimatedEles(0), getShadowNodeIdForContext('node3'))).toBe(true);

      service.cycleTerminal(-1); // 2->1: node2
      expect(collectionIncludesTerminal(getAnimatedEles(1), getShadowNodeIdForContext('node2'))).toBe(true);

      service.cycleTerminal(-1); // 1->0: node1
      expect(collectionIncludesTerminal(getAnimatedEles(2), getShadowNodeIdForContext('node1'))).toBe(true);
    });

    it('should wrap around to last terminal after first one in backward direction', () => {
      const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

      const getAnimatedEles: (callIndex: number) => Collection = (callIndex: number): Collection =>
        (animateSpy.mock.calls[callIndex][0] as { center: { eles: Collection } }).center.eles;
      const collectionIncludesTerminal: (collection: Collection, shadowNodeId: string) => boolean = (collection: Collection, shadowNodeId: string): boolean =>
        collection.map((n) => n.id()).includes(shadowNodeId);

      // Cycle backward to wrap to last
      service.cycleTerminal(-1); // 0->2: node3
      expect(collectionIncludesTerminal(getAnimatedEles(0), getShadowNodeIdForContext('node3'))).toBe(true);

      // Continue backward through all
      service.cycleTerminal(-1); // 2->1: node2
      service.cycleTerminal(-1); // 1->0: node1
      expect(collectionIncludesTerminal(getAnimatedEles(2), getShadowNodeIdForContext('node1'))).toBe(true);

      // Wrap around again
      service.cycleTerminal(-1); // 0->2: node3
      expect(collectionIncludesTerminal(getAnimatedEles(3), getShadowNodeIdForContext('node3'))).toBe(true);
    });

    it('should do nothing when no terminals exist in TerminalStore', () => {
      // Clear TerminalStore to simulate no terminals
      clearTerminals();

      const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

      service.cycleTerminal(1);

      expect(animateSpy).not.toHaveBeenCalled();
    });

    it('should only cycle through terminals registered in TerminalStore', () => {
      // Add spurious nodes to cy that look like terminals but aren't in TerminalStore
      cy.add({
        data: {
          id: 'fake-terminal-shadow',
          windowType: 'Terminal',
          isShadowNode: true,
          parentNodeId: 'node1',
          label: 'Fake Terminal'
        },
        position: { x: 500, y: 100 }
      });

      const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

      const getAnimatedEles: (callIndex: number) => Collection = (callIndex: number): Collection =>
        (animateSpy.mock.calls[callIndex][0] as { center: { eles: Collection } }).center.eles;
      const collectionIncludesTerminal: (collection: Collection, shadowNodeId: string) => boolean = (collection: Collection, shadowNodeId: string): boolean =>
        collection.map((n) => n.id()).includes(shadowNodeId);

      // Cycle through - should only hit the 3 terminals from TerminalStore
      service.cycleTerminal(1); // 0->1: node2
      service.cycleTerminal(1); // 1->2: node3
      service.cycleTerminal(1); // 2->0: node1

      expect(collectionIncludesTerminal(getAnimatedEles(0), getShadowNodeIdForContext('node2'))).toBe(true);
      expect(collectionIncludesTerminal(getAnimatedEles(1), getShadowNodeIdForContext('node3'))).toBe(true);
      expect(collectionIncludesTerminal(getAnimatedEles(2), getShadowNodeIdForContext('node1'))).toBe(true);

      // Fake terminal should never be cycled to
      for (const call of animateSpy.mock.calls) {
        const ids: string[] = (call[0] as { center: { eles: Collection } }).center.eles.map((n) => n.id());
        expect(ids).not.toContain('fake-terminal-shadow');
      }
    });

    it('should exclude floating editor shadow nodes from viewport fit', () => {
      // Add a floating editor shadow node anchored to node2 (same as terminal's context node)
      const editorShadowNodeId: string = 'node2-editor-anchor-shadowNode';
      cy.add({
        data: {
          id: editorShadowNodeId,
          windowType: 'Editor',
          isShadowNode: true,
          parentNodeId: 'node2',
          label: 'Editor Shadow'
        },
        position: { x: 450, y: 200 }
      });
      // Add edge from context node to editor shadow node
      cy.add({ data: { id: 'edge-node2-editor', source: 'node2', target: editorShadowNodeId } });

      const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

      // Cycle to terminal on node2
      service.cycleTerminal(1); // 0->1: node2

      const animateArgs: { center: { eles: Collection } } = animateSpy.mock.calls[0][0] as { center: { eles: Collection } };
      const fittedIds: string[] = animateArgs.center.eles.map((n) => n.id());

      // Should include terminal's own shadow node and regular graph nodes
      expect(fittedIds).toContain(getShadowNodeIdForContext('node2')); // terminal shadow node
      expect(fittedIds).toContain('node2'); // context node
      expect(fittedIds).toContain('node1'); // neighbor
      expect(fittedIds).toContain('node3'); // neighbor

      // Should NOT include the editor shadow node
      expect(fittedIds).not.toContain(editorShadowNodeId);
    });

    it('should handle single terminal correctly', () => {
      // Clear and add only one terminal
      clearTerminals();
      const terminal: { terminalData: ReturnType<typeof createTerminalData>, shadowNodeId: string } = createTestTerminal('node1', 0);
      // Keep only the shadow node for this terminal in cy
      cy.remove(`#${getShadowNodeIdForContext('node2')}, #${getShadowNodeIdForContext('node3')}`);

      const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

      const getAnimatedEles: (callIndex: number) => Collection = (callIndex: number): Collection =>
        (animateSpy.mock.calls[callIndex][0] as { center: { eles: Collection } }).center.eles;
      const collectionIncludesTerminal: (collection: Collection, shadowNodeId: string) => boolean = (collection: Collection, shadowNodeId: string): boolean =>
        collection.map((n) => n.id()).includes(shadowNodeId);

      service.cycleTerminal(1);
      expect(collectionIncludesTerminal(getAnimatedEles(0), terminal.shadowNodeId)).toBe(true);

      service.cycleTerminal(1);
      expect(collectionIncludesTerminal(getAnimatedEles(1), terminal.shadowNodeId)).toBe(true);

      service.cycleTerminal(-1);
      expect(collectionIncludesTerminal(getAnimatedEles(2), terminal.shadowNodeId)).toBe(true);
    });
  });

  describe('handleSearchSelect', () => {
    it('should animate viewport to selected node', () => {
      const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

      service.handleSearchSelect('node2');

      expect(animateSpy).toHaveBeenCalled();
      const animateArgs: { center: { eles: Collection }, zoom?: number, duration?: number } = animateSpy.mock.calls[0][0] as { center: { eles: Collection } };
      expect((animateArgs.center.eles.first()?.id() ?? "")).toBe('node2');
    });

    it('should highlight selected node by adding highlighted class', () => {
      const node: cytoscape.CollectionReturnValue = cy.getElementById('node2');
      const addClassSpy: MockInstance<(classes: cytoscape.ClassNames) => cytoscape.CollectionReturnValue> = vi.spyOn(node, 'addClass');

      service.handleSearchSelect('node2');

      expect(addClassSpy).toHaveBeenCalledWith('highlighted');
    });

    it('should remove highlight after timeout', () => {
      vi.useFakeTimers();

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
      const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

      expect(() => {
        service.handleSearchSelect('nonexistent-node');
      }).not.toThrow();

      // Should not call animate for non-existent nodes
      expect(animateSpy).not.toHaveBeenCalled();
    });

    it('should use relative zoom for search results', () => {
      const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

      service.handleSearchSelect('node1');

      // Should have zoom and duration in animate call
      const animateArgs: { center: { eles: Collection }, zoom?: number, duration?: number } = animateSpy.mock.calls[0][0] as { zoom: number, duration: number };
      expect(typeof animateArgs.zoom).toBe('number');
      expect(typeof animateArgs.duration).toBe('number');
    });

    it('should fallback to fuzzy suffix matching when node not found with relative path', () => {
      // Add a node with absolute path (how frontend stores nodes)
      cy.add({ data: { id: '/Users/bob/repos/project/voicetree-bugs/voice/test-node.md', label: 'Test Node' }, position: { x: 400, y: 400 } });

      const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

      // Try to navigate with relative path (simulates SSE event with vault-relative path)
      service.handleSearchSelect('voicetree-bugs/voice/test-node.md');

      // Should have found the node via fuzzy suffix matching
      expect(animateSpy).toHaveBeenCalled();
      const animateArgs: { center: { eles: Collection }, zoom?: number, duration?: number } = animateSpy.mock.calls[0][0] as { center: { eles: Collection } };
      expect((animateArgs.center.eles.first()?.id() ?? "")).toBe('/Users/bob/repos/project/voicetree-bugs/voice/test-node.md');
    });
  });

  describe('navigation integration', () => {
    it('should maintain independent state for different navigation actions', () => {
      // Clear existing terminals and add new ones for this test
      clearTerminals();

      // Create terminals in TerminalStore
      const terminalA: ReturnType<typeof createTerminalData> = createTerminalData({
        attachedToNodeId: 'node1' as NodeIdAndFilePath,
        terminalCount: 0,
        title: 'Terminal A'
      });
      const terminalB: ReturnType<typeof createTerminalData> = createTerminalData({
        attachedToNodeId: 'node2' as NodeIdAndFilePath,
        terminalCount: 0,
        title: 'Terminal B'
      });
      addTerminal(terminalA);
      addTerminal(terminalB);

      const shadowNodeA: string = getShadowNodeId(getTerminalId(terminalA));
      const shadowNodeB: string = getShadowNodeId(getTerminalId(terminalB));

      // Add shadow nodes to cy
      cy.add([
        { data: { id: shadowNodeA, windowType: 'Terminal', isShadowNode: true, parentNodeId: 'node1' }, position: { x: 400, y: 100 } },
        { data: { id: shadowNodeB, windowType: 'Terminal', isShadowNode: true, parentNodeId: 'node2' }, position: { x: 400, y: 200 } }
      ]);

      const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

      const getAnimatedEles: (callIndex: number) => Collection = (callIndex: number): Collection =>
        (animateSpy.mock.calls[callIndex][0] as { center: { eles: Collection } }).center.eles;
      const collectionIncludesNode: (collection: Collection, nodeId: string) => boolean = (collection: Collection, nodeId: string): boolean =>
        collection.map((n) => n.id()).includes(nodeId);

      // Set last node and fit to it
      service.setLastCreatedNodeId('node1');
      service.fitToLastNode();
      expect((getAnimatedEles(0).first()?.id() ?? "")).toBe('node1');

      // Cycle terminal - should not affect last node
      // Terminals sorted: node1-terminal-0 < node2-terminal-0, index 0->1 = node2
      service.cycleTerminal(1);
      expect(collectionIncludesNode(getAnimatedEles(1), shadowNodeB)).toBe(true);

      // Fit to last node again - should still be node1
      service.fitToLastNode();
      expect((getAnimatedEles(2).first()?.id() ?? "")).toBe('node1');

      // Handle search select - should not affect either
      service.handleSearchSelect('node2');
      expect((getAnimatedEles(3).first()?.id() ?? "")).toBe('node2');

      // Last node and terminal cycling should still work independently
      service.fitToLastNode();
      expect((getAnimatedEles(4).first()?.id() ?? "")).toBe('node1');

      // 1->0: node1
      service.cycleTerminal(1);
      expect(collectionIncludesNode(getAnimatedEles(5), shadowNodeA)).toBe(true);
    });
  });
});

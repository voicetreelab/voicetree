import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { GraphNavigationService } from '@/shell/edge/UI-edge/graph/navigation/GraphNavigationService';
import cytoscape, { type Core, type Collection } from 'cytoscape';
import '@/shell/UI/cytoscape-graph-ui'; // Import to trigger extension registration
import { addTerminal, clearTerminals } from '@/shell/edge/UI-edge/state/TerminalStore';
import { createTerminalData, getShadowNodeId, getTerminalId, computeTerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import type { NodeIdAndFilePath } from '@/pure/graph';

type ViewportAnimateCall = {
  __vtTargetEles?: Collection;
  pan?: { x: number; y: number };
  zoom?: number;
  duration?: number;
};

describe('GraphNavigationService', () => {
  let service: GraphNavigationService;
  let cy: Core;
  let container: HTMLElement;

  beforeEach(() => {
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
      const animateArgs: ViewportAnimateCall = animateSpy.mock.calls[0][0] as ViewportAnimateCall;
      expect((animateArgs.__vtTargetEles?.first()?.id() ?? "")).toBe('node2');
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

      const firstCall: ViewportAnimateCall = animateSpy.mock.calls[0][0] as ViewportAnimateCall;
      expect((firstCall.__vtTargetEles?.first()?.id() ?? "")).toBe('node1');

      service.setLastCreatedNodeId('node3');
      service.fitToLastNode();

      const secondCall: ViewportAnimateCall = animateSpy.mock.calls[1][0] as ViewportAnimateCall;
      expect((secondCall.__vtTargetEles?.first()?.id() ?? "")).toBe('node3');
    });
  });

  describe('handleSearchSelect', () => {
    it('should animate viewport to selected node', () => {
      const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

      service.handleSearchSelect('node2');

      expect(animateSpy).toHaveBeenCalled();
      const animateArgs: ViewportAnimateCall = animateSpy.mock.calls[0][0] as ViewportAnimateCall;
      expect((animateArgs.__vtTargetEles?.first()?.id() ?? "")).toBe('node2');
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
      const animateArgs: ViewportAnimateCall = animateSpy.mock.calls[0][0] as ViewportAnimateCall;
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
      const animateArgs: ViewportAnimateCall = animateSpy.mock.calls[0][0] as ViewportAnimateCall;
      expect((animateArgs.__vtTargetEles?.first()?.id() ?? "")).toBe('/Users/bob/repos/project/voicetree-bugs/voice/test-node.md');
    });
  });

  describe('navigation integration', () => {
    it('should maintain independent state for different navigation actions', () => {
      // Clear existing terminals and add new ones for this test
      clearTerminals();

      // Create terminals in TerminalStore
      const terminalA: ReturnType<typeof createTerminalData> = createTerminalData({
        terminalId: computeTerminalId('node1', 0),
        attachedToNodeId: 'node1' as NodeIdAndFilePath,
        terminalCount: 0,
        title: 'Terminal A',
        agentName: 'terminal-a',
      });
      const terminalB: ReturnType<typeof createTerminalData> = createTerminalData({
        terminalId: computeTerminalId('node2', 0),
        attachedToNodeId: 'node2' as NodeIdAndFilePath,
        terminalCount: 0,
        title: 'Terminal B',
        agentName: 'terminal-b',
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
        (animateSpy.mock.calls[callIndex][0] as ViewportAnimateCall).__vtTargetEles as Collection;
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

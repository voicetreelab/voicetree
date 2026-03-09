import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { GraphNavigationService } from '@/shell/edge/UI-edge/graph/navigation/GraphNavigationService';
import cytoscape, { type Core, type Collection } from 'cytoscape';
import '@/shell/UI/cytoscape-graph-ui'; // Import to trigger extension registration
import { vanillaFloatingWindowInstances } from '@/shell/edge/UI-edge/state/UIAppState';
import { addTerminal, clearTerminals } from '@/shell/edge/UI-edge/state/TerminalStore';
import { createTerminalData, getShadowNodeId, getTerminalId, computeTerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import type { NodeIdAndFilePath } from '@/pure/graph';

describe('GraphNavigationService - cycleTerminal', () => {
  let service: GraphNavigationService;
  let cy: Core;
  let container: HTMLElement;
  const mockFocus: MockInstance<() => void> = vi.fn();

  // Helper to create and register a terminal
  function createTestTerminal(attachedToNodeId: string, terminalCount: number): { terminalData: ReturnType<typeof createTerminalData>, shadowNodeId: string } {
    const terminalData: ReturnType<typeof createTerminalData> = createTerminalData({
      terminalId: computeTerminalId(attachedToNodeId, terminalCount),
      attachedToNodeId: attachedToNodeId as NodeIdAndFilePath,
      terminalCount,
      title: `Terminal ${terminalCount}`,
      agentName: `terminal-${attachedToNodeId}-${terminalCount}`,
    });
    addTerminal(terminalData);
    const shadowNodeId: string = getShadowNodeId(getTerminalId(terminalData));
    return { terminalData, shadowNodeId };
  }

  // Helper to get expected shadow node ID for a context node
  const getShadowNodeIdForContext: (contextNodeId: string) => string = (contextNodeId: string): string => {
    return `${contextNodeId}-terminal-0-anchor-shadowNode`;
  };

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
    vanillaFloatingWindowInstances.clear();
    cy.destroy();
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it('should cycle to next terminal in forward direction', () => {
    const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

    service.cycleTerminal(1);

    // Increments from 0 to 1, sorted alphabetically by terminal ID
    // node1-terminal-0 < node2-terminal-0 < node3-terminal-0, so index 1 = node2
    expect(animateSpy).toHaveBeenCalled();
    const animateArgs: { center: { eles: Collection }, zoom?: number, duration?: number } = animateSpy.mock.calls[0][0] as { center: { eles: Collection } };
    const fittedIds: string[] = animateArgs.center.eles.map((n) => n.id());
    // Should include terminal shadow node and its parent (context node) only
    expect(fittedIds).toContain(getShadowNodeIdForContext('node2'));
    expect(fittedIds).toContain('node2'); // parent/context node
    // Should NOT include siblings — only terminal + parent
    expect(fittedIds).not.toContain('node1');
    expect(fittedIds).not.toContain('node3');
    expect(mockFocus).toHaveBeenCalled(); // Auto-focus on cycled terminal
  });

  it('should cycle through all terminals in forward direction', () => {
    const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

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

    service.cycleTerminal(1); // 0->1: node2
    service.cycleTerminal(1); // 1->2: node3
    service.cycleTerminal(1); // 2->0: node1
    expect(collectionIncludesTerminal(getAnimatedEles(2), getShadowNodeIdForContext('node1'))).toBe(true);

    service.cycleTerminal(1); // 0->1: node2
    expect(collectionIncludesTerminal(getAnimatedEles(3), getShadowNodeIdForContext('node2'))).toBe(true);
  });

  it('should cycle to previous terminal in backward direction', () => {
    const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

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

    service.cycleTerminal(-1); // 0->2: node3
    expect(collectionIncludesTerminal(getAnimatedEles(0), getShadowNodeIdForContext('node3'))).toBe(true);

    service.cycleTerminal(-1); // 2->1: node2
    service.cycleTerminal(-1); // 1->0: node1
    expect(collectionIncludesTerminal(getAnimatedEles(2), getShadowNodeIdForContext('node1'))).toBe(true);

    service.cycleTerminal(-1); // 0->2: node3
    expect(collectionIncludesTerminal(getAnimatedEles(3), getShadowNodeIdForContext('node3'))).toBe(true);
  });

  it('should do nothing when no terminals exist in TerminalStore', () => {
    clearTerminals();

    const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

    service.cycleTerminal(1);

    expect(animateSpy).not.toHaveBeenCalled();
  });

  it('should only cycle through terminals registered in TerminalStore', () => {
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

    service.cycleTerminal(1); // 0->1: node2
    service.cycleTerminal(1); // 1->2: node3
    service.cycleTerminal(1); // 2->0: node1

    expect(collectionIncludesTerminal(getAnimatedEles(0), getShadowNodeIdForContext('node2'))).toBe(true);
    expect(collectionIncludesTerminal(getAnimatedEles(1), getShadowNodeIdForContext('node3'))).toBe(true);
    expect(collectionIncludesTerminal(getAnimatedEles(2), getShadowNodeIdForContext('node1'))).toBe(true);

    for (const call of animateSpy.mock.calls) {
      const ids: string[] = (call[0] as { center: { eles: Collection } }).center.eles.map((n) => n.id());
      expect(ids).not.toContain('fake-terminal-shadow');
    }
  });

  it('should only include terminal shadow node and parent in viewport fit', () => {
    const animateSpy: MockInstance<typeof cy.animate> = vi.spyOn(cy, 'animate');

    service.cycleTerminal(1); // 0->1: node2

    const animateArgs: { center: { eles: Collection } } = animateSpy.mock.calls[0][0] as { center: { eles: Collection } };
    const fittedIds: string[] = animateArgs.center.eles.map((n) => n.id());

    expect(fittedIds).toContain(getShadowNodeIdForContext('node2'));
    expect(fittedIds).toContain('node2');
    expect(fittedIds).toHaveLength(2);
  });

  it('should handle single terminal correctly', () => {
    clearTerminals();
    const terminal: { terminalData: ReturnType<typeof createTerminalData>, shadowNodeId: string } = createTestTerminal('node1', 0);
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

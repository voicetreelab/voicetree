import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SearchService } from './SearchService';
import cytoscape, { type Core } from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';
import type { GraphDelta, GraphNode, UpsertNodeDelta, DeleteNode } from '@/pure/graph';

// Mock ninja-keys element
function createMockNinjaKeys(): HTMLElement & { data: unknown[]; open: () => void; close: () => void } {
  const element = document.createElement('div') as HTMLElement & { data: unknown[]; open: () => void; close: () => void };
  element.data = [];
  element.open = vi.fn();
  element.close = vi.fn();
  return element;
}

// Helper to create a minimal GraphNode for testing
function createTestNode(id: string, title: string, content: string = ''): GraphNode {
  return {
    relativeFilePathIsID: id,
    contentWithoutYamlOrLinks: content || `# ${title}\n\nSome content`,
    outgoingEdges: [],
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: new Map()
    }
  };
}

function createUpsertDelta(id: string, title: string, previousNode?: GraphNode): UpsertNodeDelta {
  return {
    type: 'UpsertNode',
    nodeToUpsert: createTestNode(id, title),
    previousNode: O.fromNullable(previousNode)
  };
}

function createDeleteDelta(id: string): DeleteNode {
  return {
    type: 'DeleteNode',
    nodeId: id,
    deletedNode: O.none
  };
}

describe('SearchService', () => {
  let service: SearchService;
  let cy: Core;
  let container: HTMLElement;
  let mockNinjaKeys: ReturnType<typeof createMockNinjaKeys>;

  beforeEach(() => {
    // Create container
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);

    // Create cytoscape instance with initial nodes
    cy = cytoscape({
      container,
      elements: [
        { data: { id: 'node1', label: 'Node 1', content: 'Content for node 1' } },
        { data: { id: 'node2', label: 'Node 2', content: 'Content for node 2' } },
        { data: { id: 'node3', label: 'Node 3', content: 'Content for node 3' } },
      ],
      headless: true
    });

    // Mock ninja-keys element creation
    mockNinjaKeys = createMockNinjaKeys();
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'ninja-keys') {
        return mockNinjaKeys;
      }
      return document.createElement.call(document, tagName);
    });

    // Create service (this calls updateSearchData in constructor)
    const onNodeSelect = vi.fn();
    service = new SearchService(cy, onNodeSelect);
  });

  afterEach(() => {
    service.dispose();
    cy.destroy();
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    vi.restoreAllMocks();
  });

  describe('updateSearchDataIncremental', () => {
    it('should do nothing for empty delta', () => {
      const initialData = [...mockNinjaKeys.data];
      const delta: GraphDelta = [];

      service.updateSearchDataIncremental(delta);

      expect(mockNinjaKeys.data).toEqual(initialData);
    });

    it('should add new node on UpsertNode when node does not exist in search data', () => {
      // Add new node to cytoscape first (simulates applyGraphDeltaToUI running before)
      cy.add({ data: { id: 'newNode', label: 'New Node', content: 'New content' } });

      const initialLength = mockNinjaKeys.data.length;
      const delta: GraphDelta = [createUpsertDelta('newNode', 'New Node')];

      service.updateSearchDataIncremental(delta);

      expect(mockNinjaKeys.data.length).toBe(initialLength + 1);
      const newItem = mockNinjaKeys.data.find((item: { id: string }) => item.id === 'newNode');
      expect(newItem).toBeDefined();
      expect((newItem as { title: string }).title).toBe('New Node');
    });

    it('should update existing node on UpsertNode when node already exists in search data', () => {
      // node1 already exists from initial setup
      const delta: GraphDelta = [createUpsertDelta('node1', 'Updated Node 1')];

      // Update the cytoscape node's label to match delta
      cy.getElementById('node1').data('label', 'Updated Node 1');

      const initialLength = mockNinjaKeys.data.length;
      service.updateSearchDataIncremental(delta);

      // Length should remain same (update, not add)
      expect(mockNinjaKeys.data.length).toBe(initialLength);
      const updatedItem = mockNinjaKeys.data.find((item: { id: string }) => item.id === 'node1');
      expect(updatedItem).toBeDefined();
      expect((updatedItem as { title: string }).title).toBe('Updated Node 1');
    });

    it('should remove node on DeleteNode', () => {
      const initialLength = mockNinjaKeys.data.length;
      const delta: GraphDelta = [createDeleteDelta('node2')];

      service.updateSearchDataIncremental(delta);

      expect(mockNinjaKeys.data.length).toBe(initialLength - 1);
      const deletedItem = mockNinjaKeys.data.find((item: { id: string }) => item.id === 'node2');
      expect(deletedItem).toBeUndefined();
    });

    it('should handle DeleteNode for non-existent node gracefully', () => {
      const initialData = [...mockNinjaKeys.data];
      const delta: GraphDelta = [createDeleteDelta('nonexistent')];

      service.updateSearchDataIncremental(delta);

      // Data should remain unchanged
      expect(mockNinjaKeys.data.length).toBe(initialData.length);
    });

    it('should handle mixed delta with upserts and deletes', () => {
      // Add new node to cytoscape first
      cy.add({ data: { id: 'newNode', label: 'New Node', content: 'New content' } });
      // Update existing node label
      cy.getElementById('node1').data('label', 'Updated Node 1');

      const initialLength = mockNinjaKeys.data.length;
      const delta: GraphDelta = [
        createUpsertDelta('newNode', 'New Node'),        // +1 (add)
        createUpsertDelta('node1', 'Updated Node 1'),   // +0 (update)
        createDeleteDelta('node2')                       // -1 (remove)
      ];

      service.updateSearchDataIncremental(delta);

      // net change: +1 -1 = 0
      expect(mockNinjaKeys.data.length).toBe(initialLength);

      // Verify new node was added
      const newItem = mockNinjaKeys.data.find((item: { id: string }) => item.id === 'newNode');
      expect(newItem).toBeDefined();

      // Verify node1 was updated
      const updatedItem = mockNinjaKeys.data.find((item: { id: string }) => item.id === 'node1');
      expect((updatedItem as { title: string }).title).toBe('Updated Node 1');

      // Verify node2 was removed
      const deletedItem = mockNinjaKeys.data.find((item: { id: string }) => item.id === 'node2');
      expect(deletedItem).toBeUndefined();
    });

    it('should skip shadow nodes on UpsertNode', () => {
      // Add shadow node to cytoscape
      cy.add({ data: { id: 'shadowNode', label: 'Shadow', isShadowNode: true } });

      const initialLength = mockNinjaKeys.data.length;
      const delta: GraphDelta = [createUpsertDelta('shadowNode', 'Shadow')];

      service.updateSearchDataIncremental(delta);

      // Shadow node should not be added
      expect(mockNinjaKeys.data.length).toBe(initialLength);
      const shadowItem = mockNinjaKeys.data.find((item: { id: string }) => item.id === 'shadowNode');
      expect(shadowItem).toBeUndefined();
    });

    it('should skip UpsertNode when node not found in cytoscape', () => {
      // Delta references a node that doesn't exist in cytoscape
      const initialLength = mockNinjaKeys.data.length;
      const delta: GraphDelta = [createUpsertDelta('nonexistentCyNode', 'Nonexistent')];

      service.updateSearchDataIncremental(delta);

      // Should not add anything
      expect(mockNinjaKeys.data.length).toBe(initialLength);
    });

    it('should preserve node handler callback on update', () => {
      const onNodeSelect = vi.fn();
      // Recreate service with our mock callback
      service.dispose();
      service = new SearchService(cy, onNodeSelect);

      // Update node1
      cy.getElementById('node1').data('label', 'Updated Node 1');
      const delta: GraphDelta = [createUpsertDelta('node1', 'Updated Node 1')];

      service.updateSearchDataIncremental(delta);

      // Find the updated item and call its handler
      const updatedItem = mockNinjaKeys.data.find((item: { id: string }) => item.id === 'node1') as { handler: () => void };
      expect(updatedItem.handler).toBeDefined();
      updatedItem.handler();

      expect(onNodeSelect).toHaveBeenCalledWith('node1');
    });
  });
});

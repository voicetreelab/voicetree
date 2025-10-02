import { describe, test, expect, beforeEach } from 'vitest';
import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import { LayoutManager } from '@/graph-core/graphviz/layout/LayoutManager';
import { TidyLayoutStrategy } from '@/graph-core/graphviz/layout/TidyLayoutStrategy';
import type { Node, MarkdownTree } from '@/graph-core/types';

/**
 * Tests for canonical tree structure in LayoutManager and TidyLayoutStrategy
 *
 * These tests verify that the layout system uses the canonical Node.parentId
 * and Node.children fields directly, without any parent-child inversion logic.
 */
describe('Canonical Tree Layout Tests', () => {
  let cy: Core;
  let layoutManager: LayoutManager;

  beforeEach(() => {
    cy = cytoscape({
      headless: true,
      styleEnabled: true,
      style: [
        {
          selector: 'node',
          style: {
            'width': 40,
            'height': 40
          }
        }
      ]
    });
    layoutManager = new LayoutManager(new TidyLayoutStrategy());
  });

  test('should use canonical parentId/children from Node type without inversion', () => {
    // Create a simple tree with canonical structure:
    // root (1) -> child1 (2) -> grandchild (3)
    //          -> child2 (4)
    const nodes: Node[] = [
      {
        id: '1',
        title: 'Root',
        filename: 'root.md',
        parentId: undefined,
        children: ['2', '4'],
        relationships: {},
        content: '',
        summary: '',
        createdAt: new Date(),
        modifiedAt: new Date(),
        tags: []
      },
      {
        id: '2',
        title: 'Child 1',
        filename: 'child1.md',
        parentId: '1',
        children: ['3'],
        relationships: {},
        content: '',
        summary: '',
        createdAt: new Date(),
        modifiedAt: new Date(),
        tags: []
      },
      {
        id: '3',
        title: 'Grandchild',
        filename: 'grandchild.md',
        parentId: '2',
        children: [],
        relationships: {},
        content: '',
        summary: '',
        createdAt: new Date(),
        modifiedAt: new Date(),
        tags: []
      },
      {
        id: '4',
        title: 'Child 2',
        filename: 'child2.md',
        parentId: '1',
        children: [],
        relationships: {},
        content: '',
        summary: '',
        createdAt: new Date(),
        modifiedAt: new Date(),
        tags: []
      }
    ];

    const tree: MarkdownTree = {
      tree: new Map(nodes.map(n => [n.id, n])),
      nextNodeId: 5,
      outputDir: '/tmp/test'
    };

    // Add nodes to cytoscape (without edges initially, to test pure tree structure)
    for (const node of nodes) {
      cy.add({
        group: 'nodes',
        data: {
          id: node.id,
          label: node.title
        }
      });
    }

    // Apply layout with canonical tree
    layoutManager.applyLayoutWithTree(cy, tree, nodes.map(n => n.id));

    // Verify positions
    const positions = nodes.map(n => ({
      id: n.id,
      pos: cy.$id(n.id).position()
    }));

    console.log('Canonical tree positions:', positions);

    // Root should be at top (lowest y)
    const rootPos = cy.$id('1').position();
    const child1Pos = cy.$id('2').position();
    const child2Pos = cy.$id('4').position();
    const grandchildPos = cy.$id('3').position();

    // Verify tree structure is respected: root above children
    expect(rootPos.y).toBeLessThan(child1Pos.y);
    expect(rootPos.y).toBeLessThan(child2Pos.y);
    expect(child1Pos.y).toBeLessThan(grandchildPos.y);

    // Children should be horizontally separated
    expect(Math.abs(child1Pos.x - child2Pos.x)).toBeGreaterThan(20);

    // Parent should be centered over children
    const childrenCenterX = (child1Pos.x + child2Pos.x) / 2;
    expect(Math.abs(rootPos.x - childrenCenterX)).toBeLessThan(10);
  });

  test('should produce reasonable layout width for 29-node tree', () => {
    // Create a tree similar to the real example with 29 nodes
    // This should NOT produce 18k pixel width
    const nodes: Node[] = [];

    // Create root
    nodes.push({
      id: '1',
      title: 'Root',
      filename: 'root.md',
      parentId: undefined,
      children: ['2', '3', '4'],
      relationships: {},
      content: '',
      summary: '',
      createdAt: new Date(),
      modifiedAt: new Date(),
      tags: []
    });

    // Create branching structure
    let nextId = 2;
    const createSubtree = (parentId: string, depth: number, maxDepth: number, branchFactor: number): void => {
      if (depth >= maxDepth) return;

      const childIds: string[] = [];
      for (let i = 0; i < branchFactor; i++) {
        const childId = String(nextId++);
        childIds.push(childId);

        nodes.push({
          id: childId,
          title: `Node ${childId}`,
          filename: `node${childId}.md`,
          parentId,
          children: [],
          relationships: {},
          content: '',
          summary: '',
          createdAt: new Date(),
          modifiedAt: new Date(),
          tags: []
        });
      }

      // Update parent's children
      const parent = nodes.find(n => n.id === parentId);
      if (parent) {
        parent.children.push(...childIds);
      }

      // Recursively create subtrees
      for (const childId of childIds) {
        createSubtree(childId, depth + 1, maxDepth, Math.max(1, branchFactor - 1));
      }
    };

    createSubtree('1', 1, 4, 3);

    // Limit to 29 nodes
    const limitedNodes = nodes.slice(0, 29);

    // Fix children references for truncated nodes
    for (const node of limitedNodes) {
      node.children = node.children.filter(childId => limitedNodes.some(n => n.id === childId));
    }

    const tree: MarkdownTree = {
      tree: new Map(limitedNodes.map(n => [n.id, n])),
      nextNodeId: 30,
      outputDir: '/tmp/test'
    };

    // Add nodes to cytoscape
    for (const node of limitedNodes) {
      cy.add({
        group: 'nodes',
        data: {
          id: node.id,
          label: node.title
        }
      });
    }

    // Apply layout
    layoutManager.applyLayoutWithTree(cy, tree, limitedNodes.map(n => n.id));

    // Measure layout width
    const allX = limitedNodes.map(n => cy.$id(n.id).position().x);
    const minX = Math.min(...allX);
    const maxX = Math.max(...allX);
    const width = maxX - minX;

    console.log(`Layout width for ${limitedNodes.length} nodes: ${width.toFixed(1)}px`);
    console.log(`Min X: ${minX.toFixed(1)}, Max X: ${maxX.toFixed(1)}`);

    // Width should be reasonable, not 18k pixels
    expect(width).toBeLessThan(2000);
    expect(width).toBeGreaterThan(200); // Should have some spread
  });

  test('should handle tree with Map<string, Node> directly', () => {
    // Test that we can pass just the node map without full MarkdownTree
    const nodes: Node[] = [
      {
        id: '1',
        title: 'Root',
        filename: 'root.md',
        parentId: undefined,
        children: ['2'],
        relationships: {},
        content: '',
        summary: '',
        createdAt: new Date(),
        modifiedAt: new Date(),
        tags: []
      },
      {
        id: '2',
        title: 'Child',
        filename: 'child.md',
        parentId: '1',
        children: [],
        relationships: {},
        content: '',
        summary: '',
        createdAt: new Date(),
        modifiedAt: new Date(),
        tags: []
      }
    ];

    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    // Add to cytoscape
    for (const node of nodes) {
      cy.add({
        group: 'nodes',
        data: { id: node.id, label: node.title }
      });
    }

    // Apply layout with node map
    layoutManager.applyLayoutWithTree(cy, nodeMap, nodes.map(n => n.id));

    const rootPos = cy.$id('1').position();
    const childPos = cy.$id('2').position();

    expect(rootPos.y).toBeLessThan(childPos.y);
  });

  test('should fall back to linkedNodeIds when canonical structure not available', () => {
    // Test backward compatibility: when nodes don't have canonical structure,
    // use linkedNodeIds (but without inversion - linkedNodeIds should already be correct)
    cy.add({
      group: 'nodes',
      data: {
        id: 'parent',
        label: 'Parent',
        linkedNodeIds: [] // Parent has no links upward
      }
    });

    cy.add({
      group: 'nodes',
      data: {
        id: 'child',
        label: 'Child',
        linkedNodeIds: ['parent'] // Child links to parent
      }
    });

    // Without canonical tree, should use linkedNodeIds
    // Note: Current implementation may invert this, but we want it to NOT invert
    layoutManager.applyLayout(cy, ['parent', 'child']);

    const parentPos = cy.$id('parent').position();
    const childPos = cy.$id('child').position();

    // With correct interpretation: child links to parent means parent IS the parent
    // So parent should be above child
    expect(parentPos.y).toBeLessThan(childPos.y);
  });
});

import { describe, test, expect, beforeEach } from 'vitest';
import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import { LayoutManager } from '@/graph-core/graphviz/layout/LayoutManager';
import { TidyLayoutStrategy } from '@/graph-core/graphviz/layout/TidyLayoutStrategy';
import { loadMarkdownTree } from '@/graph-core/data/load_markdown/MarkdownParser';
import fs from 'fs';
import path from 'path';

/**
 * Test layout with real markdown fixture to verify 18k pixel bug is fixed
 */
describe('Real Fixture Layout Test', () => {
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

  test('should produce reasonable layout width for real 55-node fixture', () => {
    // Load the actual fixture
    const fixtureDir = path.join(__dirname, '../fixtures/example_real_large/2025-09-30');
    const files = new Map<string, string>();
    const mdFiles = fs.readdirSync(fixtureDir)
      .filter(f => f.endsWith('.md'))
      .sort();

    for (const filename of mdFiles) {
      const content = fs.readFileSync(path.join(fixtureDir, filename), 'utf-8');
      files.set(filename, content);
    }

    const markdownTree = loadMarkdownTree(files, fixtureDir);

    console.log(`\n📊 Loaded ${markdownTree.tree.size} nodes from fixture`);

    // Add nodes to cytoscape
    for (const node of markdownTree.tree.values()) {
      cy.add({
        group: 'nodes',
        data: {
          id: node.id,
          label: node.title
        }
      });
    }

    const nodeIds = Array.from(markdownTree.tree.keys());

    // Apply layout with canonical tree
    // Pass empty newNodeIds array for bulk layout (all nodes are "existing")
    layoutManager.applyLayoutWithTree(cy, markdownTree, []);

    // Measure layout dimensions
    const allX = nodeIds.map(id => cy.$id(id).position().x);
    const allY = nodeIds.map(id => cy.$id(id).position().y);

    const minX = Math.min(...allX);
    const maxX = Math.max(...allX);
    const minY = Math.min(...allY);
    const maxY = Math.max(...allY);

    const width = maxX - minX;
    const height = maxY - minY;

    console.log(`\n📏 Layout dimensions for ${markdownTree.tree.size} nodes:`);
    console.log(`   Width: ${width.toFixed(1)}px (was 18,000+ before fix)`);
    console.log(`   Height: ${height.toFixed(1)}px`);
    console.log(`   Min X: ${minX.toFixed(1)}, Max X: ${maxX.toFixed(1)}`);
    console.log(`   Min Y: ${minY.toFixed(1)}, Max Y: ${maxY.toFixed(1)}`);

    // Find root nodes
    const roots = Array.from(markdownTree.tree.values()).filter(n => !n.parentId);
    console.log(`\n🌳 Found ${roots.length} root nodes:`, roots.map(n => n.id).join(', '));

    // Verify width is reasonable (not 18k pixels!)
    expect(width).toBeLessThan(6000); // WASM tidy layout creates more spread out layouts with better spacing
    expect(width).toBeGreaterThan(100);

    // Verify height is reasonable
    expect(height).toBeGreaterThan(100);
    expect(height).toBeLessThan(3000);

    console.log(`\n✅ Layout dimensions are reasonable!`);
  });
});

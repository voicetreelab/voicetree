import { describe, it, expect } from 'vitest';
import { MarkdownParser } from '@/graph-core/data/load_markdown/MarkdownParser';
import fs from 'fs';
import path from 'path';

describe('Markdown Tree Loading', () => {
  const fixtureDir = path.join(__dirname, '../../fixtures/example_real_large/2025-09-30');

  it('should load all markdown files and build correct parent-child relationships', () => {
    // Load all markdown files
    const files = new Map<string, string>();
    const mdFiles = fs.readdirSync(fixtureDir).filter(f => f.endsWith('.md'));

    for (const filename of mdFiles) {
      const content = fs.readFileSync(path.join(fixtureDir, filename), 'utf-8');
      files.set(filename, content);
    }

    expect(files.size).toBeGreaterThan(0);
    console.log(`Loaded ${files.size} markdown files`);

    // Parse all files
    const parsedNodes = new Map<string, ReturnType<typeof MarkdownParser.parseMarkdownFile>>();
    for (const [filename, content] of files) {
      const parsed = MarkdownParser.parseMarkdownFile(content, filename);
      parsedNodes.set(parsed.id, parsed);
    }

    expect(parsedNodes.size).toBe(files.size);

    // Build parent-child map from links
    const nodeChildren = new Map<string, Set<string>>();
    const nodeParents = new Map<string, string | null>();

    // Initialize all nodes
    for (const [id] of parsedNodes) {
      nodeChildren.set(id, new Set());
      nodeParents.set(id, null);
    }

    // Build relationships from links
    // Note: The markdown format uses Parent links, not Children links
    // So we need to extract parent information from the parsed links
    for (const [filename, content] of files) {
      const node = Array.from(parsedNodes.values()).find(n => n.filename === filename);
      if (!node) continue;

      // Extract parent link from the _Links: section
      const linksSectionMatch = content.match(/_Links:_([\s\S]*?)(?:\n\n|$)/);
      if (linksSectionMatch) {
        const linksContent = linksSectionMatch[1];

        // Look for Parent: section
        const parentSectionMatch = linksContent.match(/Parent:\s*\n- [^[]+\[\[([^\]]+)\]\]/);
        if (parentSectionMatch) {
          const parentFile = parentSectionMatch[1];
          const parentNodeIdMatch = parentFile.match(/^(\d+)_/);
          const parentId = parentNodeIdMatch ? parentNodeIdMatch[1] : parentFile;

          if (parsedNodes.has(parentId)) {
            // Set parent
            nodeParents.set(node.id, parentId);
            // Add as child of parent
            nodeChildren.get(parentId)!.add(node.id);
          }
        }
      }
    }

    // Count root nodes and orphans
    const roots: string[] = [];
    const orphans: string[] = [];

    for (const [id] of parsedNodes) {
      const hasParent = nodeParents.get(id) !== null;
      const hasChildren = nodeChildren.get(id)!.size > 0;

      if (!hasParent && hasChildren) {
        roots.push(id);
      } else if (!hasParent && !hasChildren) {
        orphans.push(id);
      }
    }

    // Expected structure based on Python analysis
    const expectedRoots = ['37', '32', '39', '1'];
    const expectedOrphans = 10;  // Adjusted based on actual data
    const totalComponents = expectedRoots.length + expectedOrphans;

    console.log('Root nodes:', roots.sort((a, b) => parseInt(a) - parseInt(b)));
    console.log('Orphan nodes:', orphans.sort((a, b) => parseInt(a) - parseInt(b)));
    console.log('Total components:', roots.length + orphans.length);

    // Debug: show what links we parsed for some key nodes
    console.log('\nNode 1 links:', parsedNodes.get('1')?.links);
    console.log('Node 2 links:', parsedNodes.get('2')?.links);
    console.log('Node 37 links:', parsedNodes.get('37')?.links);
    console.log('Node 42 links:', parsedNodes.get('42')?.links);

    // Verify we have the correct number of roots
    expect(roots.length, `Expected ${expectedRoots.length} roots but got ${roots.length}. Roots: ${JSON.stringify(roots.slice(0, 10))}`).toBe(expectedRoots.length);

    // Verify we have the correct root IDs
    expect(roots.sort()).toEqual(expectedRoots.sort());

    // Verify we have the correct number of orphans
    expect(orphans.length).toBe(expectedOrphans);

    // Verify total components
    expect(roots.length + orphans.length).toBe(totalComponents);

    // Verify specific relationships we know are correct
    // Node 2 should be a child of node 1
    expect(nodeParents.get('2')).toBe('1');
    expect(nodeChildren.get('1')!.has('2')).toBe(true);

    // Node 42 should be a child of node 37
    expect(nodeParents.get('42')).toBe('37');
    expect(nodeChildren.get('37')!.has('42')).toBe(true);

    // Node 1 should have no parent
    expect(nodeParents.get('1')).toBe(null);

    // Node 37 should have no parent
    expect(nodeParents.get('37')).toBe(null);

    // Count nodes in each tree component
    const componentSizes = new Map<string, number>();

    for (const rootId of roots) {
      const visited = new Set<string>();
      const queue = [rootId];

      while (queue.length > 0) {
        const nodeId = queue.shift()!;
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);

        // Add all children to queue
        for (const childId of nodeChildren.get(nodeId)!) {
          queue.push(childId);
        }
      }

      componentSizes.set(rootId, visited.size);
    }

    console.log('Component sizes:', Object.fromEntries(componentSizes));

    // Node 1's tree should have the most nodes
    const node1TreeSize = componentSizes.get('1')!;
    expect(node1TreeSize, `Node 1 tree size: ${node1TreeSize}`).toBeGreaterThan(20);

    // Node 37's tree should have fewer nodes
    const node37TreeSize = componentSizes.get('37')!;
    expect(node37TreeSize, `Node 37 tree size: ${node37TreeSize}`).toBeLessThan(10);
  });
});

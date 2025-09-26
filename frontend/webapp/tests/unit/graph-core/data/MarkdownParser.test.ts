import { describe, it, expect } from 'vitest';
import { MarkdownParser } from '@/graph-core/data/load_markdown/MarkdownParser';

describe('MarkdownParser', () => {
  it('should parse markdown files and extract wikilinks', async () => {
    const testFiles = new Map([
      ['file1.md', 'This is content with a link to [[file2.md]] and another to [[file3.md]].'],
      ['file2.md', 'This references [[file1.md]] back.'],
      ['file3.md', 'This is a standalone file with no links.']
    ]);

    const result = await MarkdownParser.parseDirectory(testFiles);

    // Check nodes - IDs should be normalized (no .md extension)
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes.map(n => n.data.id)).toContain('file1');
    expect(result.nodes.map(n => n.data.id)).toContain('file2');
    expect(result.nodes.map(n => n.data.id)).toContain('file3');

    // Check labels are cleaned up
    const file1Node = result.nodes.find(n => n.data.id === 'file1');
    expect(file1Node?.data.label).toBe('file1');

    // Check linked node IDs - should be normalized
    expect(file1Node?.data.linkedNodeIds).toEqual(['file2', 'file3']);

    // Check edges - should use normalized IDs
    expect(result.edges).toHaveLength(3);
    expect(result.edges.map(e => e.data.id)).toContain('file1->file2');
    expect(result.edges.map(e => e.data.id)).toContain('file1->file3');
    expect(result.edges.map(e => e.data.id)).toContain('file2->file1');
  });

  it('should handle files with underscores in names', async () => {
    const testFiles = new Map([
      ['test_file_with_underscores.md', 'Content']
    ]);

    const result = await MarkdownParser.parseDirectory(testFiles);

    expect(result.nodes[0].data.label).toBe('test file with underscores');
  });

  it('should handle files with no wikilinks', async () => {
    const testFiles = new Map([
      ['standalone.md', 'This file has no wikilinks at all.']
    ]);

    const result = await MarkdownParser.parseDirectory(testFiles);

    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(0);
    expect(result.nodes[0].data.linkedNodeIds).toEqual([]);
  });

  it('should normalize file paths and handle mixed link formats', async () => {
    const testFiles = new Map([
      ['concepts/introduction.md', 'This links to [[overview]] and [[details.md]].'],
      ['overview.md', 'This links back to [[introduction]].'],
      ['folder/details.md', 'This is a detail file.']
    ]);

    const result = await MarkdownParser.parseDirectory(testFiles);

    // Check that all IDs are normalized (no paths, no extensions)
    expect(result.nodes).toHaveLength(3);
    const nodeIds = result.nodes.map(n => n.data.id);
    expect(nodeIds).toContain('introduction');
    expect(nodeIds).toContain('overview');
    expect(nodeIds).toContain('details');

    // Check that links work correctly with normalized IDs
    const introNode = result.nodes.find(n => n.data.id === 'introduction');
    expect(introNode?.data.linkedNodeIds).toEqual(['overview', 'details']);

    const overviewNode = result.nodes.find(n => n.data.id === 'overview');
    expect(overviewNode?.data.linkedNodeIds).toEqual(['introduction']);

    // Check edges use normalized IDs
    expect(result.edges).toHaveLength(3);
    expect(result.edges.map(e => e.data.id)).toContain('introduction->overview');
    expect(result.edges.map(e => e.data.id)).toContain('introduction->details');
    expect(result.edges.map(e => e.data.id)).toContain('overview->introduction');
  });
});
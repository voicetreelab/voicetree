import { describe, it, expect } from 'vitest';
import { MarkdownParser } from '../../../../src/graph-core/data/MarkdownParser';

describe('MarkdownParser', () => {
  it('should parse markdown files and extract wikilinks', async () => {
    const testFiles = new Map([
      ['file1.md', 'This is content with a link to [[file2.md]] and another to [[file3.md]].'],
      ['file2.md', 'This references [[file1.md]] back.'],
      ['file3.md', 'This is a standalone file with no links.']
    ]);

    const result = await MarkdownParser.parseDirectory(testFiles);

    // Check nodes
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes.map(n => n.data.id)).toContain('file1.md');
    expect(result.nodes.map(n => n.data.id)).toContain('file2.md');
    expect(result.nodes.map(n => n.data.id)).toContain('file3.md');

    // Check labels are cleaned up
    const file1Node = result.nodes.find(n => n.data.id === 'file1.md');
    expect(file1Node?.data.label).toBe('file1');

    // Check linked node IDs
    expect(file1Node?.data.linkedNodeIds).toEqual(['file2.md', 'file3.md']);

    // Check edges
    expect(result.edges).toHaveLength(3);
    expect(result.edges.map(e => e.data.id)).toContain('file1.md->file2.md');
    expect(result.edges.map(e => e.data.id)).toContain('file1.md->file3.md');
    expect(result.edges.map(e => e.data.id)).toContain('file2.md->file1.md');
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
});
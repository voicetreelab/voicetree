import { describe, it, expect } from 'vitest';
import { parseForCytoscape } from '@/graph-core/data/load_markdown/MarkdownParser';

describe('MarkdownParser.parseForCytoscape', () => {
  describe('Frontmatter Parsing', () => {
    it('should extract color from frontmatter', () => {
      const content = `---
node_id: 1
title: Test Node
color: indigo
---
# Test Node

Some content here.`;

      const result = parseForCytoscape(content, 'test.md');

      expect(result.color).toBe('indigo');
    });

    it('should extract title from frontmatter', () => {
      const content = `---
node_id: 1
title: My Custom Title
---
# Test Node`;

      const result = parseForCytoscape(content, 'test.md');

      expect(result.title).toBe('My Custom Title');
    });

    it('should handle quoted color values', () => {
      const content = `---
node_id: 1
color: "blue"
---
# Test`;

      const result = parseForCytoscape(content, 'test.md');

      expect(result.color).toBe('blue');
    });

    it('should handle single-quoted title values', () => {
      const content = `---
title: 'Test Title'
---
# Test`;

      const result = parseForCytoscape(content, 'test.md');

      expect(result.title).toBe('Test Title');
    });

    it('should return undefined for missing color', () => {
      const content = `---
node_id: 1
title: Test
---
# Test`;

      const result = parseForCytoscape(content, 'test.md');

      expect(result.color).toBeUndefined();
    });

    it('should return undefined for missing title', () => {
      const content = `---
node_id: 1
---
# Test`;

      const result = parseForCytoscape(content, 'test.md');

      expect(result.title).toBeUndefined();
    });

    it('should handle content without frontmatter', () => {
      const content = `# Simple Note

Just some content without frontmatter.`;

      const result = parseForCytoscape(content, 'simple.md');

      expect(result.color).toBeUndefined();
      expect(result.title).toBeUndefined();
    });
  });

  describe('ID Normalization', () => {
    it('should normalize filename to ID by removing .md extension', () => {
      const content = '# Test';
      const result = parseForCytoscape(content, 'my-file.md');

      expect(result.nodeId).toBe('my-file');
    });

    it('should extract just filename from absolutePath', () => {
      const content = '# Test';
      const result = parseForCytoscape(content, 'concepts/introduction.md');

      expect(result.nodeId).toBe('introduction');
    });

    it('should handle nested paths', () => {
      const content = '# Test';
      const result = parseForCytoscape(content, 'docs/2025-10-09/notes.md');

      expect(result.nodeId).toBe('notes');
    });

    it('should handle uppercase .MD extension', () => {
      const content = '# Test';
      const result = parseForCytoscape(content, 'README.MD');

      expect(result.nodeId).toBe('README');
    });
  });

  describe('Wikilink Parsing', () => {
    it('should parse simple wikilinks', () => {
      const content = `# Test Node

This links to [[other-node]].`;

      const result = parseForCytoscape(content, 'test.md');

      expect(result.linkedNodeIds).toEqual(['other-node']);
      expect(result.edgeLabels.size).toBe(0);
    });

    it('should parse wikilinks with relationship labels', () => {
      const content = `# Test Node

_Links:_
- is_child_of [[parent-node]]`;

      const result = parseForCytoscape(content, 'test.md');

      expect(result.linkedNodeIds).toContain('parent-node');
      expect(result.edgeLabels.get('parent-node')).toBe('is_child_of');
    });

    it('should parse multiple wikilinks', () => {
      const content = `# Test Node

Links to [[node-1]] and [[node-2]].

_Links:_
- relates_to [[node-3]]`;

      const result = parseForCytoscape(content, 'test.md');

      expect(result.linkedNodeIds).toContain('node-1');
      expect(result.linkedNodeIds).toContain('node-2');
      expect(result.linkedNodeIds).toContain('node-3');
      expect(result.edgeLabels.get('node-3')).toBe('relates_to');
    });

    it('should handle wikilinks with paths', () => {
      const content = `# Test

Link to [[concepts/introduction.md]].`;

      const result = parseForCytoscape(content, 'test.md');

      expect(result.linkedNodeIds).toContain('introduction');
    });

    it('should handle content with no wikilinks', () => {
      const content = `# Simple Note

No links here.`;

      const result = parseForCytoscape(content, 'test.md');

      expect(result.linkedNodeIds).toEqual([]);
      expect(result.edgeLabels.size).toBe(0);
    });

    it('should parse relationship with underscores in label', () => {
      const content = `# Test

_Links:_
- is_a_specific_example_of [[parent]]`;

      const result = parseForCytoscape(content, 'test.md');

      expect(result.linkedNodeIds).toContain('parent');
      expect(result.edgeLabels.get('parent')).toBe('is_a_specific_example_of');
    });

    it('should handle mixed plain and labeled wikilinks', () => {
      const content = `# Test

Plain link: [[plain-node]]

_Links:_
Parent:
- parent_of [[parent-node]]

Children:
- child_of [[child-node]]`;

      const result = parseForCytoscape(content, 'test.md');

      expect(result.linkedNodeIds).toContain('plain-node');
      expect(result.linkedNodeIds).toContain('parent-node');
      expect(result.linkedNodeIds).toContain('child-node');
      expect(result.edgeLabels.get('parent-node')).toBe('parent_of');
      expect(result.edgeLabels.get('child-node')).toBe('child_of');
    });
  });

  describe('Label Generation', () => {
    it('should use frontmatter title as label when available', () => {
      const content = `---
title: My Custom Title (42)
---
# Test`;

      const result = parseForCytoscape(content, 'test-node.md');

      expect(result.label).toBe('My Custom Title (42)');
    });

    it('should fall back to normalized nodeId when no title', () => {
      const content = `# Test`;

      const result = parseForCytoscape(content, 'test_node.md');

      expect(result.label).toBe('test node');
    });

    it('should replace underscores with spaces in fallback label', () => {
      const content = `# Test`;

      const result = parseForCytoscape(content, 'my_test_node.md');

      expect(result.label).toBe('my test node');
    });
  });

  describe('Complete Parsing', () => {
    it('should parse a complete real-world example', () => {
      const content = `---
node_id: 57
title: File Watcher Anti-Pattern (57)
color: indigo
---
### The 'file watcher.ts' module contains misallocated logic.

_Links:_
Parent:
- identifies_an_anti-pattern_within_the [[39_VoiceTree_System.md]]`;

      const result = parseForCytoscape(content, '57_File_Watcher_Anti-Pattern.md');

      expect(result.nodeId).toBe('57_File_Watcher_Anti-Pattern');
      expect(result.title).toBe('File Watcher Anti-Pattern (57)');
      expect(result.label).toBe('File Watcher Anti-Pattern (57)');
      expect(result.color).toBe('indigo');
      expect(result.linkedNodeIds).toContain('39_VoiceTree_System');
      expect(result.edgeLabels.get('39_VoiceTree_System')).toBe('identifies_an_anti-pattern_within_the');
    });
  });
});

import { describe, it, expect } from 'vitest';
import { MarkdownParser } from '@/graph-core/data/load_markdown/MarkdownParser';

describe('Wiki-link Edge Creation Integration', () => {
  describe('Link Parsing with parseMarkdownFile', () => {
    it('should parse basic wiki-links correctly', () => {
      const content = `# Test File

This has a link to [[target-file]].`;

      const result = MarkdownParser.parseMarkdownFile(content, 'test.md');

      expect(result.links).toHaveLength(1);
      expect(result.links[0].targetFile).toBe('target-file');
    });

    it('should parse multiple wiki-links in one line', () => {
      const content = `Check out [[first]], [[second]], and [[third]] for more info.`;

      const result = MarkdownParser.parseMarkdownFile(content, 'test.md');

      expect(result.links).toHaveLength(3);
      expect(result.links.map(l => l.targetFile)).toEqual(['first', 'second', 'third']);
    });

    it('should parse wiki-links in lists', () => {
      const content = `## Getting Started

1. Review the [[architecture]] document
2. Understand the [[workflow]] processes
3. Explore the [[api-design]] specifications`;

      const result = MarkdownParser.parseMarkdownFile(content, 'introduction.md');

      expect(result.links).toHaveLength(3);
      expect(result.links.map(l => l.targetFile)).toContain('architecture');
      expect(result.links.map(l => l.targetFile)).toContain('workflow');
      expect(result.links.map(l => l.targetFile)).toContain('api-design');
    });

    it('should parse wiki-links with paths', () => {
      const content = `## Related

- [[../projects/main-project]] - The main implementation
- [[../daily/2024-01-01]] - Initial planning notes`;

      const result = MarkdownParser.parseMarkdownFile(content, 'concepts/introduction.md');

      expect(result.links).toHaveLength(2);
      expect(result.links[0].targetFile).toBe('../projects/main-project');
      expect(result.links[1].targetFile).toBe('../daily/2024-01-01');
    });

    it('should handle the exact introduction.md content from fixtures', () => {
      const content = `# Introduction

Welcome to the test vault. This document serves as the entry point for understanding the system.

## Key Concepts

The system is built around several [[core-principles]] that guide its design.

## Getting Started

1. Review the [[architecture]] document
2. Understand the [[workflow]] processes
3. Explore the [[api-design]] specifications

## Related

- [[../projects/main-project]] - The main implementation
- [[../daily/2024-01-01]] - Initial planning notes`;

      const result = MarkdownParser.parseMarkdownFile(content, 'concepts/introduction.md');

      console.log('Parsed links from introduction.md:', result.links);

      expect(result.links).toHaveLength(6);
      expect(result.links.map(l => l.targetFile)).toContain('core-principles');
      expect(result.links.map(l => l.targetFile)).toContain('architecture');
      expect(result.links.map(l => l.targetFile)).toContain('workflow');
      expect(result.links.map(l => l.targetFile)).toContain('api-design');
      expect(result.links.map(l => l.targetFile)).toContain('../projects/main-project');
      expect(result.links.map(l => l.targetFile)).toContain('../daily/2024-01-01');
    });

    it('should handle README file specially', () => {
      const content = `# README

See [[concepts/introduction]] for getting started.
Check out [[projects/main-project]] for the main project details.`;

      const result = MarkdownParser.parseMarkdownFile(content, 'README.md');

      expect(result.links).toHaveLength(2);
      expect(result.links[0].targetFile).toBe('concepts/introduction');
      expect(result.links[1].targetFile).toBe('projects/main-project');
    });
  });

  describe('Graph Generation with parseDirectory', () => {
    it('should create edges for introduction file', async () => {
      const files = new Map<string, string>();
      files.set('concepts/introduction.md', `# Introduction

Welcome to the test vault.

## Getting Started

1. Review the [[architecture]] document
2. Understand the [[workflow]] processes`);

      files.set('concepts/architecture.md', '# Architecture\n\nSystem design.');
      files.set('concepts/workflow.md', '# Workflow\n\nProcesses.');

      const graph = await MarkdownParser.parseDirectory(files);

      console.log('Graph nodes:', graph.nodes.map(n => n.data.id));
      console.log('Graph edges:', graph.edges.map(e => e.data));

      // Check that introduction node exists
      const introNode = graph.nodes.find(n => n.data.id === 'introduction');
      expect(introNode).toBeDefined();
      expect(introNode?.data.linkedNodeIds).toContain('architecture');
      expect(introNode?.data.linkedNodeIds).toContain('workflow');

      // Check that edges were created FROM introduction
      const introEdges = graph.edges.filter(e => e.data.source === 'introduction');
      expect(introEdges).toHaveLength(2);
      expect(introEdges.map(e => e.data.target)).toContain('architecture');
      expect(introEdges.map(e => e.data.target)).toContain('workflow');
    });

    it('should handle path-based links correctly', async () => {
      const files = new Map<string, string>();
      files.set('concepts/introduction.md', `# Introduction

Links:
- [[../projects/main-project]]
- [[core-principles]]`);

      files.set('projects/main-project.md', '# Main Project');
      files.set('concepts/core-principles.md', '# Core Principles');

      const graph = await MarkdownParser.parseDirectory(files);

      console.log('Path-based graph edges:', graph.edges.map(e => e.data));

      // The normalizeFileId should extract just the filename
      const introNode = graph.nodes.find(n => n.data.id === 'introduction');
      expect(introNode).toBeDefined();

      // Check edges - target should be normalized to just filename
      const introEdges = graph.edges.filter(e => e.data.source === 'introduction');
      console.log('Introduction edges:', introEdges);

      // The path "../projects/main-project" should normalize to "main-project"
      const mainProjectEdge = introEdges.find(e => e.data.target === 'main-project');
      expect(mainProjectEdge).toBeDefined();

      const principlesEdge = introEdges.find(e => e.data.target === 'core-principles');
      expect(principlesEdge).toBeDefined();
    });

    it('should verify the exact fixture files issue', async () => {
      const files = new Map<string, string>();

      // Add the exact content from fixtures
      files.set('concepts/introduction.md', `# Introduction

Welcome to the test vault. This document serves as the entry point for understanding the system.

## Key Concepts

The system is built around several [[core-principles]] that guide its design.

## Getting Started

1. Review the [[architecture]] document
2. Understand the [[workflow]] processes
3. Explore the [[api-design]] specifications

## Related

- [[../projects/main-project]] - The main implementation
- [[../daily/2024-01-01]] - Initial planning notes`);

      files.set('concepts/architecture.md', `# Architecture

The system architecture follows the principles outlined in [[core-principles]].`);

      files.set('concepts/core-principles.md', '# Core Principles');
      files.set('concepts/workflow.md', '# Workflow');
      files.set('concepts/api-design.md', '# API Design');
      files.set('projects/main-project.md', '# Main Project');

      const graph = await MarkdownParser.parseDirectory(files);

      // Debug output
      console.log('=== FIXTURE TEST ===');
      console.log('All nodes:', graph.nodes.map(n => ({ id: n.data.id, links: n.data.linkedNodeIds })));
      console.log('All edges:', graph.edges.map(e => ({ from: e.data.source, to: e.data.target })));

      // Find introduction node
      const introNode = graph.nodes.find(n => n.data.id === 'introduction');
      console.log('Introduction node:', introNode);

      expect(introNode).toBeDefined();
      expect(introNode?.data.linkedNodeIds.length).toBeGreaterThan(0);

      // Check edges from introduction
      const introEdges = graph.edges.filter(e => e.data.source === 'introduction');
      console.log('Introduction edges:', introEdges);

      // Should have edges to architecture and other nodes
      expect(introEdges.length).toBeGreaterThan(0);

      // Check for the specific edge we're looking for
      const hasArchitectureEdge = introEdges.some(e => e.data.target === 'architecture');
      expect(hasArchitectureEdge).toBe(true);
    });

    it('should handle README.md file correctly', async () => {
      const files = new Map<string, string>();

      files.set('README.md', `# README

See [[concepts/introduction]] for getting started.
Check out [[projects/main-project]] for the main project details.`);

      files.set('concepts/introduction.md', '# Introduction');
      files.set('projects/main-project.md', '# Main Project');

      const graph = await MarkdownParser.parseDirectory(files);

      console.log('README test - nodes:', graph.nodes.map(n => n.data.id));
      console.log('README test - edges:', graph.edges.map(e => e.data));

      const readmeNode = graph.nodes.find(n => n.data.id === 'README');
      expect(readmeNode).toBeDefined();

      const readmeEdges = graph.edges.filter(e => e.data.source === 'README');
      console.log('README edges:', readmeEdges);

      // The targets should be normalized
      // "concepts/introduction" -> "introduction"
      // "projects/main-project" -> "main-project"
      expect(readmeEdges.some(e => e.data.target === 'introduction')).toBe(true);
      expect(readmeEdges.some(e => e.data.target === 'main-project')).toBe(true);
    });
  });
});
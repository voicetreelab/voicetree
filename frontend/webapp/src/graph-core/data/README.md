# Graph Data Processing

This module provides utilities for parsing markdown files and converting them into graph data structures suitable for visualization with libraries like Cytoscape.js.

## Components

### MarkdownParser

A comprehensive markdown file parser that supports both simple wikilink extraction and advanced frontmatter parsing.

**Features:**
- Parse frontmatter (YAML headers with metadata)
- Extract structured links with relationship types
- Convert file collections into graph data
- Support for both simple and advanced parsing modes

**API:**

```typescript
// Parse a single file with frontmatter
const parsed = MarkdownParser.parseMarkdownFile(content, filename);

// Parse a directory of files into MarkdownTree
const tree = loadMarkdownTree(files);
```

### ExampleLoader

Provides example data for testing and development purposes, based on actual VoiceTree output files.

**API:**

```typescript
// Load the small example dataset
const exampleData = await ExampleLoader.loadExampleSmall();
```

### Data Structures

**ParsedNode**: Represents a parsed markdown file with structured metadata
- `id`: Node identifier from frontmatter
- `title`: Node title from frontmatter
- `content`: Full markdown content
- `links`: Array of structured links with types
- `filename`: Original filename

**MarkdownTree**: Canonical tree structure matching Python backend
- `tree`: Map of node IDs to Node objects
- `nextNodeId`: Next available node ID
- `outputDir`: Output directory for markdown files

## Example Usage

```typescript
import { loadMarkdownTree } from './data/load_markdown/MarkdownParser';
import { ExampleLoader } from './data';

// Load example data
const exampleTree = await ExampleLoader.loadExampleSmall();

// Parse your own files
const files = new Map([
  ['node1.md', '# Node 1\nLinks to [[node2.md]]'],
  ['node2.md', '# Node 2\nReferences [[node1.md]]']
]);

const tree = loadMarkdownTree(files);
```

## Testing

Run tests with:
```bash
npx vitest tests/unit/graph-core/data/MarkdownParser.test.ts
```

The tests cover:
- Frontmatter parsing
- Link extraction
- Edge case handling
- Graph data structure generation
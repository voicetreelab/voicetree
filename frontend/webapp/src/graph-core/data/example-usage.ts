import { MarkdownParser, ExampleLoader } from './index';

/**
 * Example usage of the MarkdownParser and ExampleLoader
 * This demonstrates how to use the classes to parse markdown files and load example data
 */

// Example 1: Parse a single markdown file
export async function parseSingleFile() {
  const content = `---
node_id: 1
title: Example Node
---
### This is an example node

Some content here with a link to [[2_Another_Node.md]].

-----------------
_Links:_
Parent:
- is_related_to [[2_Another_Node.md]]
`;

  const parsed = MarkdownParser.parseMarkdownFile(content, '1_Example_Node.md');
  console.log('Parsed node:', parsed);
  return parsed;
}

// Example 2: Load and parse the example small dataset
export async function loadExampleData() {
  const graphData = await ExampleLoader.loadExampleSmall();
  console.log('Example graph data:', graphData);
  console.log(`Loaded ${graphData.nodes.length} nodes and ${graphData.edges.length} edges`);
  return graphData;
}

// Example 3: Parse a directory of files
export async function parseDirectory() {
  const files = new Map([
    ['1_First_Node.md', `---
node_id: 1
title: First Node
---
### First Node Content

This connects to [[2_Second_Node.md]].

-----------------
_Links:_
Parent:
- connects_to [[2_Second_Node.md]]
`],
    ['2_Second_Node.md', `---
node_id: 2
title: Second Node
---
### Second Node Content

This references back to [[1_First_Node.md]].

-----------------
_Links:_
Parent:
- references [[1_First_Node.md]]
`]
  ]);

  const graphData = await MarkdownParser.parseDirectory(files);
  console.log('Directory parse result:', graphData);
  return graphData;
}

// Example usage (uncomment to test):
// parseSingleFile();
// loadExampleData();
// parseDirectory();
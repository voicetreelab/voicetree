# Phase 1: Load Graph in Main Process

## Goal
Initialize the functional graph architecture in the main process with a cached Graph loaded from the filesystem.

## What We're Building

**File:** `electron/graph/load-graph-from-disk.ts`

A pure function that scans the vault directory and builds the initial Graph state.

## Function Signature

```typescript
loadGraphFromDisk :: FilePath -> IO<Graph>
```

## Implementation Plan

### Input
- `vaultPath: string` - Absolute path to markdown vault directory

### Output
- `IO<Graph>` - An IO effect that produces a Graph when executed

### Steps

1. **Scan directory for markdown files**
   ```typescript
   const files = await fs.readdir(vaultPath, { recursive: true })
   const markdownFiles = files.filter(f => f.endsWith('.md'))
   ```

2. **For each markdown file, create GraphNode**
   ```typescript
   const nodes: Record<NodeId, GraphNode> = {}

   for (const file of markdownFiles) {
     const content = await fs.readFile(path.join(vaultPath, file), 'utf-8')
     const node = parseMarkdownToGraphNode(content, file)
     nodes[node.id] = node
   }
   ```

3. **Build adjacency list from links**
   ```typescript
   const edges: Record<NodeId, NodeId[]> = {}

   for (const [nodeId, node] of Object.entries(nodes)) {
     const linkedIds = extractLinkedNodeIds(node.content, nodes)
     edges[nodeId] = linkedIds
   }
   ```

4. **Return Graph**
   ```typescript
   return { nodes, edges }
   ```

## Helper Functions Needed

### `parseMarkdownToGraphNode :: (string, string) -> GraphNode`

Parse markdown content and extract:
- `id` - from frontmatter `node_id` field OR derive from filename
- `title` - from frontmatter `title` field OR first `# Header`
- `content` - full markdown content
- `summary` - from frontmatter `summary` field OR empty string
- `color` - from frontmatter `color` field (Option type)

```typescript
function parseMarkdownToGraphNode(content: string, filename: string): GraphNode {
  const frontmatter = extractFrontmatter(content)

  return {
    id: frontmatter.node_id ?? filenameToNodeId(filename),
    title: frontmatter.title ?? extractTitle(content) ?? 'Untitled',
    content: content,
    summary: frontmatter.summary ?? '',
    color: frontmatter.color ? some(frontmatter.color) : none
  }
}
```

### `extractLinkedNodeIds :: (string, Record<NodeId, GraphNode>) -> NodeId[]`

Extract wikilinks from content and resolve to node IDs:
- Find all `[[wikilinks]]` in content
- Map wikilink to node ID (lookup by title or filename)
- Return array of linked node IDs

```typescript
function extractLinkedNodeIds(content: string, nodes: Record<NodeId, GraphNode>): NodeId[] {
  const wikilinkRegex = /\[\[([^\]]+)\]\]/g
  const matches = [...content.matchAll(wikilinkRegex)]

  return matches
    .map(match => {
      const linkText = match[1]
      // Find node by title or filename matching linkText
      return Object.values(nodes).find(n =>
        n.title === linkText ||
        nodeIdToFilename(n.id) === linkText
      )?.id
    })
    .filter(id => id !== undefined) as NodeId[]
}
```

## Integration into main.ts

```typescript
// electron/main.ts
import { loadGraphFromDisk } from './graph/load-graph-from-disk'
import type { Graph } from '../src/graph-core/functional/types'

async function main() {
  // Get vault path from config or user selection
  const vaultPath = '/path/to/vault'

  // Load initial graph (only mutation in the entire system)
  let currentGraph: Graph = await loadGraphFromDisk(vaultPath)()

  console.log(`Loaded graph: ${Object.keys(currentGraph.nodes).length} nodes`)

  // TODO: Wire up event handlers (Phase 2)
}
```

## Testing Strategy

**Unit Test:** `tests/unit/electron/graph/load-graph-from-disk.test.ts`

```typescript
describe('loadGraphFromDisk', () => {
  it('should load empty graph from empty directory', async () => {
    const graph = await loadGraphFromDisk(emptyVaultPath)()
    expect(Object.keys(graph.nodes)).toHaveLength(0)
    expect(Object.keys(graph.edges)).toHaveLength(0)
  })

  it('should load nodes from markdown files', async () => {
    // Given: vault with 3 markdown files
    const graph = await loadGraphFromDisk(testVaultPath)()
    expect(Object.keys(graph.nodes)).toHaveLength(3)
  })

  it('should extract node properties from frontmatter', async () => {
    const graph = await loadGraphFromDisk(testVaultPath)()
    const node = graph.nodes['1']
    expect(node.title).toBe('Test Node')
    expect(node.summary).toBe('A test summary')
    expect(node.color).toEqual(some('#FF0000'))
  })

  it('should build edges from wikilinks', async () => {
    // Given: node1.md contains [[node2]]
    const graph = await loadGraphFromDisk(testVaultPath)()
    expect(graph.edges['1']).toContain('2')
  })
})
```

**Integration Test:** `tests/integration/electron/load-real-vault.test.ts`

Use the `markdownTreeVault` directory in the project to test with real data.

## Success Criteria

- ✓ `loadGraphFromDisk` function loads all markdown files
- ✓ Parses frontmatter correctly (node_id, title, summary, color)
- ✓ Falls back to extracting title from `# Header`
- ✓ Builds adjacency list from wikilinks
- ✓ Handles empty vault gracefully
- ✓ All unit tests pass
- ✓ Integration test with real vault passes

## Files to Create

```
electron/
  graph/
    load-graph-from-disk.ts           # Main function
    parse-markdown-to-node.ts         # Helper: string -> GraphNode
    extract-linked-node-ids.ts        # Helper: string -> NodeId[]
    extract-frontmatter.ts            # Helper: string -> Frontmatter

tests/
  unit/
    electron/
      graph/
        load-graph-from-disk.test.ts  # Unit tests
  integration/
    electron/
      load-real-vault.test.ts         # Integration test
```

## Dependencies

- `gray-matter` - For frontmatter parsing (already in project)
- `fs/promises` - For async file operations
- `path` - For path manipulation

## Next Steps

After Phase 1 is complete:
- Phase 2: Wire up IPC event handlers
- Phase 3: Refactor renderer to send actions

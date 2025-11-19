# Progressive Edge Validation - Implementation Handover

## Context

**Problem:** The current system has temporal coupling in edge resolution. Initial bulk load behaves differently from incremental file system events, violating the principle that "adding a collection of single nodes should be the same as adding a whole graph."

**Current Issues:**
1. `buildNodesWithEdges` re-validates all edges during initial load with complete graph
2. `mapFSEventsToGraphDelta` validates edges incrementally with current graph state
3. Edge resolution depends on WHEN extraction happens and WHAT nodes exist
4. Two different code paths for same logical operation

**Solution:** Progressive edge validation with bidirectional healing. When any node is added, validate both:
- Outgoing edges from the new node (can now resolve to existing nodes)
- Incoming edges to the new node (existing nodes with raw links can now resolve)

## Key Insight

**Unified Operation:** Both bulk load and incremental updates become sequences of the same atomic operation:

```typescript
addNodeToGraph(fsEvent, currentGraph) → GraphDelta
```

- **Bulk load**: `graph = files.reduce((g, file) => applyGraphDeltaToGraph(g, addNodeToGraph(file, g)), emptyGraph)`
- **Incremental**: `delta = addNodeToGraph(fsEvent, currentGraph)`

**Note:** `applyGraphDeltaToGraph` is the existing pure function in `src/pure/graph/graphDelta/applyGraphDeltaToGraph.ts` that:
- Takes a `Graph` and a `GraphDelta` (array of UpsertNode/DeleteNode actions)
- Applies each action sequentially to produce a new `Graph`
- Handles upserts (add/update nodes) and deletions (remove nodes + cleanup edges)

## Architecture Changes

### Current Architecture

```
Initial Load Path:
  loadGraphFromDisk
  ├─> scanMarkdownFiles
  ├─> loadNodes (parseMarkdownToGraphNode with empty {})
  └─> buildNodesWithEdges (re-extract with full graph) ❌ TEMPORAL

Incremental Path:
  mapFSEventsToGraphDelta
  └─> handleUpsert (extractEdges with current graph) ❌ DIFFERENT
```

### New Architecture

```
Both Paths:
  addNodeToGraph(fsEvent, currentGraph)
  ├─> parseMarkdownToGraphNode (raw edges if unresolved)
  ├─> extractOutgoingEdges (validate with currentGraph)
  ├─> findNodesWithIncomingEdgesToThis (smart match)
  ├─> revalidateIncomingEdges (heal those nodes)
  └─> return GraphDelta [newNode, ...healedNodes]

Initial Load:
  files.reduce(
    (graph, file) => applyGraphDeltaToGraph(graph, addNodeToGraph(file, graph)),
    emptyGraph
  )

Incremental:
  addNodeToGraph(fsEvent, currentGraph)
```

## Detailed Implementation Plan

### 1. Create Core Function: `addNodeToGraph`

**File:** `src/pure/graph/graphDelta/addNodeToGraph.ts` (new file)

**Signature:**
```typescript
export function addNodeToGraph(
  fsEvent: FSUpdate,
  vaultPath: string,
  currentGraph: Graph
): GraphDelta
```

**Algorithm:**
```typescript
1. Parse markdown to base node (with raw edges)
   baseNode = parseMarkdownToGraphNode(content, filename)

2. Validate outgoing edges from new node with current graph
   validatedOutgoingEdges = extractEdges(content, currentGraph.nodes)
   newNode = setOutgoingEdges(baseNode, validatedOutgoingEdges)

3. Find nodes with incoming edges that NOW resolve to newNode
   affectedNodeIds = findNodesWithPotentialEdgesToNode(newNode, currentGraph)

4. Re-validate edges for each affected node
   healedNodes = affectedNodeIds.map(id => {
     node = currentGraph.nodes[id]
     graphWithNewNode = { nodes: { ...currentGraph.nodes, [newNode.id]: newNode } }
     healedEdges = extractEdges(node.content, graphWithNewNode.nodes)
     return setOutgoingEdges(node, healedEdges)
   })

5. Return GraphDelta with new node + all healed nodes
   return [
     { type: 'UpsertNode', nodeToUpsert: newNode },
     ...healedNodes.map(n => ({ type: 'UpsertNode', nodeToUpsert: n }))
   ]
```

**Example:**
```typescript
// Graph state: { "felix/2": { edges: [{ targetId: "1", label: "..." }] } }
// Add: felix/1.md

const delta = addNodeToGraph(
  { absolutePath: "/vault/felix/1.md", content: "# One", eventType: "Added" },
  "/vault",
  currentGraph
)

// Returns:
[
  { type: 'UpsertNode', nodeToUpsert: { id: "felix/1", ... } },
  { type: 'UpsertNode', nodeToUpsert: {
      id: "felix/2",
      edges: [{ targetId: "felix/1", label: "..." }]  // HEALED
    }
  }
]
```

### 2. Helper: Find Nodes With Potential Edges

**File:** `src/pure/graph/graphDelta/addNodeToGraph.ts`

**Function:**
```typescript
function findNodesWithPotentialEdgesToNode(
  newNode: GraphNode,
  currentGraph: Graph
): readonly NodeId[]
```

**Algorithm:**
```typescript
1. Extract all path segments from newNode.relativeFilePathIsID
   segments = extractPathSegments(newNode.relativeFilePathIsID)
   // "felix/1" → ["felix/1", "1"]

2. Find all nodes with edges where targetId matches any segment
   return Object.values(currentGraph.nodes)
     .filter(node =>
       node.outgoingEdges.some(edge => segments.includes(edge.targetId))
     )
     .map(node => node.relativeFilePathIsID)
```

**Optimization:** Build an inverted index `Map<rawLinkText, Set<NodeId>>` for O(1) lookup
- Maintain during graph operations
- Or compute on-demand if graph is small

### 3. Update `loadGraphFromDisk`

**File:** `src/shell/edge/main/graph/readAndDBEventsPath/loadGraphFromDisk.ts`

**Before:**
```typescript
export async function loadGraphFromDisk(vaultPath: O.Option<string>): Promise<Graph> {
  const files = await scanMarkdownFiles(vaultPath.value)
  const preliminaryNodes = await loadNodes(vaultPath.value, files)
  const graph = { nodes: buildNodesWithEdges(preliminaryNodes) }  // ❌
  return reverseGraphEdges(applyPositions(reverseGraphEdges(graph)))
}
```

**After:**
```typescript
import { applyGraphDeltaToGraph } from '@/pure/graph/graphDelta/applyGraphDeltaToGraph.ts'
import { addNodeToGraph } from '@/pure/graph/graphDelta/addNodeToGraph.ts'

export async function loadGraphFromDisk(vaultPath: O.Option<string>): Promise<Graph> {
  if (O.isNone(vaultPath)) return { nodes: {} }

  const files = await scanMarkdownFiles(vaultPath.value)
  const limitCheck = enforceFileLimit(files.length)
  if (E.isLeft(limitCheck)) return { nodes: {} }

  // Progressive loading: reduce over files
  const graph = await files.reduce(
    async (graphPromise, file) => {
      const currentGraph = await graphPromise
      const fullPath = path.join(vaultPath.value, file)
      const content = await fs.readFile(fullPath, 'utf-8')

      const fsEvent: FSUpdate = {
        absolutePath: fullPath,
        content,
        eventType: 'Added'
      }

      // Use unified function (same as incremental!)
      const delta = addNodeToGraph(fsEvent, vaultPath.value, currentGraph)
      return applyGraphDeltaToGraph(currentGraph, delta)
    },
    Promise.resolve({ nodes: {} } as Graph)
  )

  return reverseGraphEdges(applyPositions(reverseGraphEdges(graph)))
}
```

**Key Changes:**
- ❌ Remove `loadNodes` function
- ❌ Remove `buildNodesWithEdges` function
- ✅ Use `reduce` to progressively build graph
- ✅ Each file addition uses `addNodeToGraph` (same as incremental)

### 4. Update `mapFSEventsToGraphDelta`

**File:** `src/pure/graph/mapFSEventsToGraphDelta.ts`

**Before:**
```typescript
function handleUpsert(fsUpdate: FSUpdate, vaultPath: string, currentGraph: Graph): GraphDelta {
  const nodeId = extractNodeIdFromPath(fsUpdate.absolutePath, vaultPath)
  const baseNode = parseMarkdownToGraphNode(fsUpdate.content, filename)
  const nodeWithCorrectId = { ...baseNode, relativeFilePathIsID: nodeId }
  const edges = extractEdges(fsUpdate.content, currentGraph.nodes)
  const node = setOutgoingEdges(nodeWithCorrectId, edges)
  return [{ type: 'UpsertNode', nodeToUpsert: node }]
}
```

**After:**
```typescript
import { addNodeToGraph } from '@/pure/graph/graphDelta/addNodeToGraph.ts'

function handleUpsert(fsUpdate: FSUpdate, vaultPath: string, currentGraph: Graph): GraphDelta {
  // Use unified function - handles both outgoing and incoming edge validation
  return addNodeToGraph(fsUpdate, vaultPath, currentGraph)
}
```

**Key Changes:**
- ❌ Remove custom edge extraction logic
- ✅ Delegate to `addNodeToGraph`
- ✅ Now heals incoming edges automatically

### 5. Delete Obsolete Functions

**File:** `src/shell/edge/main/graph/readAndDBEventsPath/loadGraphFromDisk.ts`

**Delete:**
```typescript
// Lines 89-109: loadNodes function
async function loadNodes(...)

// Lines 111-141: buildNodesWithEdges function
function buildNodesWithEdges(...)
```

**Reason:** Replaced by progressive `reduce` pattern using `addNodeToGraph`

## Path Comparison: Before vs After

### Scenario: Load 3 files

**Files:**
```
felix/1.md:  # One
felix/2.md:  - related [[1]]
felix/3.md:  - extends [[2]]
```

### BEFORE (Current)

**Bulk Load:**
```typescript
1. loadNodes → parse all 3 with extractEdges(content, {})
   nodes = {
     "felix/1": { edges: [] },
     "felix/2": { edges: [{ targetId: "1", label: "related" }] },      // raw
     "felix/3": { edges: [{ targetId: "2", label: "extends" }] }       // raw
   }

2. buildNodesWithEdges → re-extract all 3 with extractEdges(content, allNodes)
   nodes = {
     "felix/1": { edges: [] },
     "felix/2": { edges: [{ targetId: "felix/1", label: "related" }] }, // resolved
     "felix/3": { edges: [{ targetId: "felix/2", label: "extends" }] }  // resolved
   }
```

**Incremental (add felix/4.md: "- links [[3]]"):**
```typescript
1. mapFSEventsToGraphDelta → extractEdges(content, currentGraph)
   delta = [{
     type: 'UpsertNode',
     nodeToUpsert: {
       id: "felix/4",
       edges: [{ targetId: "felix/3", label: "links" }]  // resolved immediately
     }
   }]
```

**Problem:** Different behavior! Bulk load does TWO extractions, incremental does ONE.

### AFTER (New)

**Bulk Load:**
```typescript
graph = [felix/1, felix/2, felix/3].reduce((g, file) => {
  delta = addNodeToGraph(file, g)
  return applyGraphDeltaToGraph(g, delta)
}, emptyGraph)

// Step 1: Add felix/1
addNodeToGraph(felix/1, {}) → [
  { type: 'UpsertNode', nodeToUpsert: { id: "felix/1", edges: [] } }
]
graph = { "felix/1": { edges: [] } }

// Step 2: Add felix/2
addNodeToGraph(felix/2, graph) → [
  { type: 'UpsertNode', nodeToUpsert: {
      id: "felix/2",
      edges: [{ targetId: "felix/1", label: "related" }]  // resolves!
    }
  }
]
graph = {
  "felix/1": { edges: [] },
  "felix/2": { edges: [{ targetId: "felix/1", label: "related" }] }
}

// Step 3: Add felix/3
addNodeToGraph(felix/3, graph) → [
  { type: 'UpsertNode', nodeToUpsert: {
      id: "felix/3",
      edges: [{ targetId: "felix/2", label: "extends" }]  // resolves!
    }
  }
]
graph = {
  "felix/1": { edges: [] },
  "felix/2": { edges: [{ targetId: "felix/1", label: "related" }] },
  "felix/3": { edges: [{ targetId: "felix/2", label: "extends" }] }
}
```

**Incremental (add felix/4.md: "- links [[3]]"):**
```typescript
delta = addNodeToGraph(felix/4, graph) → [
  { type: 'UpsertNode', nodeToUpsert: {
      id: "felix/4",
      edges: [{ targetId: "felix/3", label: "links" }]  // resolves!
    }
  }
]
```

**Result:** IDENTICAL! Both use `addNodeToGraph` with current graph state.

### Reverse Order Test (Order Independence)

**Load in reverse: [felix/3, felix/2, felix/1]**

```typescript
// Step 1: Add felix/3 (links to non-existent 2)
addNodeToGraph(felix/3, {}) → [
  { type: 'UpsertNode', nodeToUpsert: {
      id: "felix/3",
      edges: [{ targetId: "2", label: "extends" }]  // raw (can't resolve)
    }
  }
]
graph = { "felix/3": { edges: [{ targetId: "2", label: "extends" }] } }

// Step 2: Add felix/2 (links to non-existent 1, HEALS felix/3)
addNodeToGraph(felix/2, graph) → [
  { type: 'UpsertNode', nodeToUpsert: {
      id: "felix/2",
      edges: [{ targetId: "1", label: "related" }]  // raw
    }
  },
  { type: 'UpsertNode', nodeToUpsert: {
      id: "felix/3",
      edges: [{ targetId: "felix/2", label: "extends" }]  // HEALED!
    }
  }
]
graph = {
  "felix/2": { edges: [{ targetId: "1", label: "related" }] },
  "felix/3": { edges: [{ targetId: "felix/2", label: "extends" }] }  // healed
}

// Step 3: Add felix/1 (HEALS felix/2)
addNodeToGraph(felix/1, graph) → [
  { type: 'UpsertNode', nodeToUpsert: {
      id: "felix/1",
      edges: []
    }
  },
  { type: 'UpsertNode', nodeToUpsert: {
      id: "felix/2",
      edges: [{ targetId: "felix/1", label: "related" }]  // HEALED!
    }
  }
]
graph = {
  "felix/1": { edges: [] },
  "felix/2": { edges: [{ targetId: "felix/1", label: "related" }] },
  "felix/3": { edges: [{ targetId: "felix/2", label: "extends" }] }
}
```

**Final state: IDENTICAL regardless of order!** ✅

## Edge Cases to Handle

### 1. File Modification (not addition)

When a file is modified, it may:
- Add new outgoing edges → validate against current graph
- Remove outgoing edges → no healing needed
- Change content that affects title → just update node

**Solution:**
```typescript
// For 'Changed' events, still use addNodeToGraph
// It will:
// 1. Update the node with new content/edges
// 2. Heal any nodes that now resolve to this node (if filename changed)
// 3. Remove stale edges automatically (applyGraphActionsToDB handles this)
```

### 2. File Deletion

Nodes with edges to deleted node should:
- Keep the raw link text (edge becomes unresolved)
- When deleted node is re-added, edges auto-heal

**Current behavior:** Already handled by `DeleteNode` action

### 3. Circular Dependencies

Files with circular references:
```
a.md: [[b]]
b.md: [[a]]
```

**Works naturally:**
1. Add a → edges: [{ targetId: "b" }] (raw)
2. Add b → edges: [{ targetId: "a" }] (resolves!), HEALS a's edge
3. Final: a→b, b→a ✅

### 4. Performance: O(n²) Healing?

Worst case: every new node heals all existing nodes

**Mitigation:**
- Build inverted index: `Map<rawLinkText, Set<NodeId>>`
- Update incrementally on each node addition
- Lookup becomes O(1) instead of O(n)

**Implementation:**
```typescript
// Maintain in applyGraphActionsToDB
const edgeIndex = new Map<string, Set<NodeId>>()

// On node upsert:
node.outgoingEdges.forEach(edge => {
  if (!graph.nodes[edge.targetId]) {
    edgeIndex.get(edge.targetId)?.add(node.id) ??
      edgeIndex.set(edge.targetId, new Set([node.id]))
  }
})

// In findNodesWithPotentialEdgesToNode:
const segments = extractPathSegments(newNode.id)
return segments.flatMap(seg => [...(edgeIndex.get(seg) ?? [])])
```

### 5. Initial Load Performance

Currently: O(n) - one pass
New: O(n) with healing - still O(n) amortized if we use index

**Benchmark:** Test with large vault (10k+ files)

## Testing Strategy

### Unit Tests

**File:** `src/pure/graph/graphDelta/addNodeToGraph.test.ts` (new)

```typescript
describe('addNodeToGraph', () => {
  it('should add node with validated outgoing edges', () => {
    const graph = { nodes: { "a": { ... } } }
    const fsEvent = createFSEvent("b.md", "[[a]]")
    const delta = addNodeToGraph(fsEvent, "/vault", graph)

    expect(delta).toHaveLength(1)
    expect(delta[0].nodeToUpsert.outgoingEdges).toEqual([
      { targetId: "a", label: "..." }
    ])
  })

  it('should heal incoming edges when adding new node', () => {
    const graph = {
      nodes: {
        "a": {
          id: "a",
          edges: [{ targetId: "b", label: "links" }]  // raw
        }
      }
    }
    const fsEvent = createFSEvent("b.md", "# B")
    const delta = addNodeToGraph(fsEvent, "/vault", graph)

    expect(delta).toHaveLength(2)
    expect(delta[0].nodeToUpsert.id).toBe("b")
    expect(delta[1].nodeToUpsert.id).toBe("a")
    expect(delta[1].nodeToUpsert.outgoingEdges[0].targetId).toBe("b")  // healed!
  })

  it('should work with subfolder resolution', () => {
    const graph = {
      nodes: {
        "felix/2": {
          id: "felix/2",
          edges: [{ targetId: "1", label: "..." }]
        }
      }
    }
    const fsEvent = createFSEvent("felix/1.md", "# One")
    const delta = addNodeToGraph(fsEvent, "/vault", graph)

    expect(delta[1].nodeToUpsert.outgoingEdges[0].targetId).toBe("felix/1")
  })

  it('should be order-independent', () => {
    const files = [
      { file: "a.md", content: "[[b]]" },
      { file: "b.md", content: "[[c]]" },
      { file: "c.md", content: "# C" }
    ]

    const graphForward = buildGraphFromFiles(files)
    const graphReverse = buildGraphFromFiles([...files].reverse())

    expect(graphForward).toEqual(graphReverse)
  })
})
```

### Integration Tests

**Update:** `src/shell/edge/main/graph/integration-tests/folder-loading.test.ts`

```typescript
it('should load graph progressively with edge healing', async () => {
  // Create files in order that requires healing
  await fs.writeFile('vault/c.md', '[[b]]')
  await fs.writeFile('vault/b.md', '[[a]]')
  await fs.writeFile('vault/a.md', '# A')

  const graph = await loadGraphFromDisk(O.some('vault'))

  // All edges should be resolved despite reverse order
  expect(graph.nodes['c'].outgoingEdges[0].targetId).toBe('b')
  expect(graph.nodes['b'].outgoingEdges[0].targetId).toBe('a')
})
```

**Update:** `src/shell/edge/main/graph/integration-tests/fileWatching.test.ts`

```typescript
it('should heal edges when watched file is added', async () => {
  // Add file with forward reference
  await fs.writeFile('vault/a.md', '[[b]]')
  await waitForFileWatch()

  let graph = getCurrentGraph()
  expect(graph.nodes['a'].outgoingEdges[0].targetId).toBe('b')  // raw

  // Add the referenced file
  await fs.writeFile('vault/b.md', '# B')
  await waitForFileWatch()

  graph = getCurrentGraph()
  expect(graph.nodes['a'].outgoingEdges[0].targetId).toBe('b')  // still works
  expect(graph.nodes['b']).toBeDefined()  // target exists now
})
```

### Existing Tests to Update

1. **loadGraphFromDisk.test.ts** - Should still pass (behavior unchanged)
2. **extract-edges-subfolder-bug.test.ts** - Should still pass
3. **applyGraphDeltaToUI.test.ts** - May need updates for healing deltas

## Migration Path

### Phase 1: Implement Core Function
1. Create `addNodeToGraph.ts`
2. Implement `findNodesWithPotentialEdgesToNode`
3. Add unit tests

### Phase 2: Update Incremental Path
1. Update `mapFSEventsToGraphDelta` to use `addNodeToGraph`
2. Run incremental tests
3. Verify edge healing works in file watching

### Phase 3: Update Bulk Load
1. Refactor `loadGraphFromDisk` to use reduce pattern
2. Delete `loadNodes` and `buildNodesWithEdges`
3. Run bulk load tests
4. Verify order independence

### Phase 4: Optimization (if needed)
1. Profile performance with large vaults
2. Add inverted index if O(n²) is problematic
3. Benchmark before/after

## Success Criteria

✅ **Functional:**
- [ ] Bulk load and incremental use same `addNodeToGraph` function
- [ ] Edges heal progressively regardless of file addition order
- [ ] Subfolder link resolution works (felix/2 → [[1]] → felix/1)
- [ ] All existing tests pass
- [ ] New order-independence tests pass

✅ **Architectural:**
- [ ] No temporal coupling (same input → same output)
- [ ] Single code path for node addition
- [ ] Pure functions (no hidden state)
- [ ] Functional core, imperative shell (no UI logic changes)

✅ **Performance:**
- [ ] Initial load time ≤ current implementation
- [ ] Incremental updates maintain O(1) with index

## Files to Create

1. `src/pure/graph/graphDelta/addNodeToGraph.ts` - Core unified function
2. `src/pure/graph/graphDelta/addNodeToGraph.test.ts` - Unit tests

## Files to Modify

1. `src/shell/edge/main/graph/readAndDBEventsPath/loadGraphFromDisk.ts` - Use reduce pattern
2. `src/pure/graph/mapFSEventsToGraphDelta.ts` - Delegate to addNodeToGraph
3. `src/shell/edge/main/graph/integration-tests/folder-loading.test.ts` - Add healing tests
4. `src/shell/edge/main/graph/integration-tests/fileWatching.test.ts` - Add healing tests

## Files to Delete

Functions within `loadGraphFromDisk.ts`:
- `loadNodes` (lines 89-109)
- `buildNodesWithEdges` (lines 111-141)

## Open Questions

1. **Performance:** Should we implement inverted index immediately or wait for profiling?
   - Recommendation: Start simple, optimize if needed

2. **Delete handling:** Should deletion trigger reverse-healing (nodes revert to raw links)?
   - Current behavior: Edges remain, target just doesn't exist in graph
   - Proposed: Keep current behavior (simpler)

3. **File renames:** Should we detect renames and heal all edges?
   - Current: Treated as delete + add
   - Proposed: Keep current (OS provides rename events we could hook into later)

## Next Steps

1. Review this plan with team
2. Start with Phase 1: Implement `addNodeToGraph` with tests
3. Verify unit tests pass
4. Continue to Phase 2 (incremental path)
5. Complete Phase 3 (bulk load)
6. Profile and optimize if needed

---

**Estimated Effort:** 4-6 hours
- Core function: 2 hours
- Test updates: 1-2 hours
- Integration: 1-2 hours
- Testing/debugging: 1 hour

# Parent Lookup O(1) Performance Optimization

## Status: READY FOR IMPLEMENTATION

**Preparation completed:** All edge modifications now go through centralized functions in `graph-edge-operations.ts`, making the actual optimization straightforward to implement when needed.

## Problem

Currently, finding parent nodes requires traversing all nodes in the graph to find which nodes have the target node in their `outgoingEdges`. This is O(n) complexity.

For operations like:
- Finding parent node for positioning calculations
- Navigation (e.g., "go to parent")
- Validation (e.g., checking if adding edge would create cycle)

This can become a performance bottleneck as graphs grow larger.

## Already Completed (Pre-optimization Refactoring)

✅ **Created centralized edge operations** - `src/functional_graph/pure/graph-edge-operations.ts`
  - `addOutgoingEdge(node, targetId)` - Add single edge
  - `removeOutgoingEdge(node, targetId)` - Remove single edge
  - `removeOutgoingEdges(node, targetIds)` - Remove multiple edges
  - `setOutgoingEdges(node, edges)` - Replace all edges

✅ **Comprehensive test coverage** - `tests/unit/functional-graph/graph-edge-operations.test.ts`
  - 17 passing tests covering all edge operations
  - Tests immutability, edge cases, and correct behavior

✅ **Refactored all edge modification sites** to use centralized functions:
  - `src/functional_graph/pure/graphDelta/uiInteractionsToGraphDeltas.ts` - Uses `addOutgoingEdge()`
  - `src/functional_graph/pure/graphDelta/applyGraphDeltaToGraph.ts` - Uses `removeOutgoingEdge()`
  - `src/functional_graph/pure/mapFSEventsToGraphDelta.ts` - Uses `setOutgoingEdges()`
  - `src/functional_graph/shell/main/readAndDBEventsPath/loadGraphFromDisk.ts` - Uses `setOutgoingEdges()`

**What this means:** When adding the incoming edges index, you only need to update the functions in `graph-edge-operations.ts` - all call sites are already using these functions!

## Proposed Solution

Add a graph-level derived index that maintains incoming edges for O(1) parent lookup, while keeping `outgoingEdges` on `GraphNode` as the single source of truth.

### Architecture Changes

#### 1. Add Graph container type

```typescript
// src/functional_graph/pure/types.ts

export interface Graph {
  readonly nodes: ReadonlyMap<NodeId, GraphNode>
  // Derived index: nodeId -> array of nodes that point to it
  readonly incomingEdgesIndex: ReadonlyMap<NodeId, readonly NodeId[]>
}
```

#### 2. Create graph manipulation functions

New file: `src/functional_graph/pure/graph-operations.ts`

Core functions needed:
- `buildIncomingEdgesIndex(nodes: ReadonlyMap<NodeId, GraphNode>): ReadonlyMap<NodeId, readonly NodeId[]>`
- `addOutgoingEdge(graph: Graph, fromNodeId: NodeId, toNodeId: NodeId): Graph`
- `removeOutgoingEdge(graph: Graph, fromNodeId: NodeId, toNodeId: NodeId): Graph`
- `getParents(graph: Graph, nodeId: NodeId): readonly NodeId[]` - O(1) lookup wrapper

These functions ensure the index stays in sync with outgoingEdges.

#### 3. Replace current graph representation

Current places that likely use `Map<NodeId, GraphNode>` or similar:
- `src/functional_graph/pure/applyGraphActionsToDB.ts`
- `src/functional_graph/shell/main/readAndDBEventsPath/loadGraphFromDisk.ts`
- Anywhere graph state is maintained

Replace with `Graph` type.

#### 4. Update parent-finding code

Files that likely traverse to find parents:
- `src/functional_graph/pure/findParentNode.ts` - Replace with O(1) index lookup
- `src/functional_graph/pure/positioning/calculateInitialPosition.ts` - If it finds parents
- Any navigation or validation code

Replace traversal logic with `getParents(graph, nodeId)`.

#### 5. Maintain index on graph mutations

Ensure all code that adds/removes edges uses the new functions:
- `src/functional_graph/pure/graphDelta/uiInteractionsToGraphDeltas.ts`
- `src/functional_graph/pure/mapFSEventsToGraphDelta.ts`
- `src/functional_graph/shell/UI/handleUIActions.ts`

## Implementation Steps

**Remaining work:**

1. Add `incomingEdgesIndex` field to `Graph` interface in types.ts
2. Implement `buildIncomingEdgesIndex()` function with tests
3. Update `graph-edge-operations.ts` to maintain the index:
   - Modify `addOutgoingEdge()` to accept `Graph` and update index
   - Modify `removeOutgoingEdge()` to accept `Graph` and update index
   - Modify `setOutgoingEdges()` to accept `Graph` and update index
   - Add `getParents(graph: Graph, nodeId: NodeId)` wrapper
4. Update `findParentNode.ts` to use `getParents()` instead of traversal
5. Update `loadGraphFromDisk.ts` to call `buildIncomingEdgesIndex()` after loading nodes
6. Update existing tests to pass `Graph` instead of just nodes

**Already done:**
- ✅ All edge mutation code uses centralized functions
- ✅ Edge operation functions fully tested

## Testing Strategy

- Unit tests for index building correctness
- Unit tests for edge manipulation maintaining index consistency
- Performance tests comparing O(n) vs O(1) lookup on large graphs (1000+ nodes)
- Integration tests ensuring existing functionality unchanged

## Risks & Considerations

1. **Memory overhead** - Index duplicates edge information in reverse. For N nodes with average E edges each, adds O(N*E) memory. Acceptable tradeoff for query speed.

2. **Migration scope** - Graph type is pervasive. May require touching many files. Consider feature flag or gradual rollout.

3. **Index rebuild** - When loading from disk, must build index. Should be fast (single O(N*E) pass) but consider lazy building if needed.

4. **Serialization** - Index is derived, should NOT be serialized to disk. Rebuild on load.

## When to Implement

Implement when:
- Graph operations feel slow (user reports or profiling shows parent lookup bottleneck)
- Graphs regularly exceed 100+ nodes
- Adding features that require frequent parent lookups

## Effort Estimate

**Original estimate:** ~6-10 hours

**Completed so far:** ~2-3 hours (edge operations refactoring + tests)

**Remaining work:**
- 1-2 hours for index implementation + tests
- 1-2 hours for updating Graph type and call sites
- 1 hour for performance validation

**Remaining effort:** ~3-5 hours

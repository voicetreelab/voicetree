# Subtask: Fix Tree Search Performance

WARNING, THIS TASK IS EXTREMELY LOW PRIORITY.


## Overview
Critical performance issue in tree node search using linear O(n) algorithm. The TODO explicitly states "THIS WONT SCALE" for the `get_node_id_from_name()` function. This needs to be replaced with a hash-based O(1) lookup system.

## Current State Analysis

### Problem Summary
- **Function**: `get_node_id_from_name()` in `backend/tree_manager/utils.py:28-30`
- **Issue**: Uses linear search through all nodes
- **Impact**: Performance degrades linearly with tree size
- **TODO**: "THIS WONT SCALE - uses linear search"

### Current Implementation (Problematic)
```python
def get_node_id_from_name(tree, name):
    # Linear search through all nodes - O(n)
    for node in tree.nodes:
        if node.name == name:
            return node.id
    return None
```

### Performance Impact
- 100 nodes: ~0.1ms (acceptable)
- 1,000 nodes: ~1ms (noticeable)
- 10,000 nodes: ~10ms (problematic)
- 100,000 nodes: ~100ms (unacceptable)

## Implementation Plan

### Phase 1: Analysis (Day 1)
- [ ] Profile current performance with various tree sizes
- [ ] Identify all callers of `get_node_id_from_name()`
- [ ] Understand tree modification patterns (how often nodes are added/removed)
- [ ] Check if node names are unique (required for hash map)

### Phase 2: Design New Data Structure (Day 2)
- [ ] Design hash-based index structure
- [ ] Plan for index maintenance during tree modifications
- [ ] Handle edge cases (duplicate names, renames, deletions)
- [ ] Design migration strategy for existing trees

### Phase 3: Implementation (Day 3-4)
- [ ] Implement name-to-id hash map in DecisionTree class
- [ ] Update all tree modification methods to maintain index
- [ ] Implement index rebuild functionality
- [ ] Add validation to ensure index consistency

### Phase 4: Testing and Benchmarking (Day 5)
- [ ] Create performance test suite
- [ ] Benchmark improvement across different tree sizes
- [ ] Test index consistency after modifications
- [ ] Stress test with concurrent modifications

## Technical Approach

### Solution 1: Integrated Hash Index (Recommended)
```python
class DecisionTree:
    def __init__(self):
        self.nodes = {}  # id -> node
        self.name_to_id = {}  # name -> id (NEW INDEX)
        self.root_id = None
    
    def add_node(self, node):
        self.nodes[node.id] = node
        self.name_to_id[node.name] = node.id  # Maintain index
    
    def remove_node(self, node_id):
        node = self.nodes.get(node_id)
        if node:
            del self.nodes[node_id]
            del self.name_to_id[node.name]  # Maintain index
    
    def rename_node(self, node_id, new_name):
        node = self.nodes.get(node_id)
        if node:
            del self.name_to_id[node.name]  # Remove old
            node.name = new_name
            self.name_to_id[new_name] = node_id  # Add new
    
    def get_node_by_name(self, name):
        # O(1) lookup!
        node_id = self.name_to_id.get(name)
        return self.nodes.get(node_id) if node_id else None
```

### Solution 2: External Index (Alternative)
```python
class TreeNodeIndex:
    def __init__(self, tree):
        self.tree = tree
        self.rebuild_index()
    
    def rebuild_index(self):
        self.name_to_id = {}
        for node_id, node in self.tree.nodes.items():
            self.name_to_id[node.name] = node_id
    
    def get_node_id_from_name(self, name):
        return self.name_to_id.get(name)
```

### Migration Strategy
```python
def migrate_tree_to_indexed(old_tree):
    new_tree = IndexedDecisionTree()
    # Copy all nodes
    for node in old_tree.nodes.values():
        new_tree.add_node(node)
    # Copy structure
    new_tree.root_id = old_tree.root_id
    return new_tree
```

## Complexities and Risks

### Technical Complexities
1. **Name Uniqueness**: Must ensure node names are unique for hash map
2. **Concurrent Access**: Need thread-safe operations if used concurrently
3. **Memory Overhead**: Additional memory for maintaining index
4. **Index Consistency**: Must keep index synchronized with tree modifications

### Edge Cases
1. **Duplicate Names**: How to handle if names aren't unique?
2. **Case Sensitivity**: Should "Node1" and "node1" be different?
3. **Special Characters**: Handle names with special characters
4. **Empty Names**: What if node name is empty or None?

### Performance Considerations
1. **Memory vs Speed**: Trading memory for lookup speed
2. **Index Rebuild**: When/how to rebuild if index gets corrupted
3. **Bulk Operations**: Optimize for bulk insertions/deletions

## Benchmark Plan

### Test Scenarios
```python
# Performance test suite
tree_sizes = [100, 1000, 10000, 100000]
operations = ['lookup', 'insert', 'delete', 'rename']

for size in tree_sizes:
    tree = create_tree_with_nodes(size)
    
    # Measure lookup performance
    start = time.time()
    for _ in range(1000):
        get_node_by_name(tree, random_name())
    lookup_time = time.time() - start
    
    # Compare old vs new implementation
    print(f"Size {size}: {lookup_time}ms")
```

### Success Metrics
1. **Lookup Performance**: < 1ms for 10,000 nodes
2. **Memory Overhead**: < 20% increase
3. **No Regression**: Insert/delete operations not significantly slower
4. **Consistency**: 100% index accuracy after modifications

## Implementation Checklist

### Core Changes
- [ ] Update DecisionTree class to include name_to_id index
- [ ] Modify get_node_id_from_name() to use hash lookup
- [ ] Update add_node() to maintain index
- [ ] Update remove_node() to maintain index
- [ ] Add rename_node() method with index update
- [ ] Add index validation method

### Supporting Changes
- [ ] Update all callers to use new API
- [ ] Add migration code for existing trees
- [ ] Create performance benchmarks
- [ ] Add unit tests for index consistency
- [ ] Document new behavior

### Safety Measures
- [ ] Add index rebuild capability
- [ ] Add index validation in debug mode
- [ ] Log warnings for duplicate names
- [ ] Graceful fallback to linear search if index corrupted

## Dependencies
- None - this is a foundational performance fix

## Rollback Plan
1. Keep old linear search as fallback method
2. Feature flag to enable/disable indexed lookup
3. Ability to rebuild index from tree data

## Notes
- This is a critical performance fix that will benefit all tree operations
- Consider making this change before implementing new features that depend on tree search
- The hash index approach is standard practice for this type of problem
- Memory overhead is acceptable given the performance benefits
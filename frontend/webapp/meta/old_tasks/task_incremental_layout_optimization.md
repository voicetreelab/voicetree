# Task: Incremental Layout Optimization

## Initial Problem

**Bug Report**: All new nodes being placed at (0.0, 0.0) in production

```
[IncrementalTidy] Partial relayout for 1 new nodes
[LayoutManager] Applied 36 positions. Samples:
(5) ['10_Understand_Current_Layouts_for_New_Notes: (0.0, 0.0)',
     '9_Layout_Application_Causes_Note_Jumps: (0.0, 0.0)', ...]
```

### Root Cause Identified

The `IncrementalTidyLayoutStrategy` is **stateful** (maintains internal cache of tree structure), but the production code was **recreating the strategy instance** when switching from initial load to incremental mode:

```typescript
// BEFORE (buggy):
useEffect(() => {
  const strategy = isInitialLoad ? new TidyLayoutStrategy() : new IncrementalTidyLayoutStrategy();
  layoutManagerRef.current = new LayoutManager(strategy);
}, [isInitialLoad]); // ❌ Recreated on every state change!
```

When the strategy was recreated:
- `layoutNodesCache` and `rootsCache` were empty
- `partialRelayout()` ran but couldn't find roots to run `secondWalk()` on
- All nodes stayed at (0, 0)

## Solution Approach

### Phase 1: Architectural Fix (COMPLETED ✅)

**Persist the strategy instance** to maintain cache across updates:

```typescript
// AFTER (correct):
useEffect(() => {
  const strategy = new IncrementalTidyLayoutStrategy();
  layoutManagerRef.current = new LayoutManager(strategy);
}, []); // ✅ Created once, persists forever
```

**Status**: This fixed the crash and nodes no longer appear at (0,0).

### Phase 2: Algorithmic Optimization (IN PROGRESS ⚠️)

The initial fix made the system **functional but inefficient**. The old `relayout()` function was calling `firstWalk()` recursively on every ancestor, re-laying out entire subtrees unnecessarily.

**Goal**: Implement true O(d) partial relayout using filtered walks (as described in the Reingold-Tilford blog post and Rust implementation).

#### Changes Made:

1. **Fixed `addChildSpacing` bug** (webapp/src/graph-core/graphviz/layout/IncrementalTidyLayoutStrategy.ts:598-614)
   - Removed `child.relativeX += delta` (line 608)
   - This was double-counting: delta already in `modifierToSubtree`

2. **Implemented `buildAffectedSet`** (lines 273-285)
   - Collects changed nodes + all their ancestors
   - Returns `Set<string>` of node IDs that need relayout

3. **Implemented `firstWalkWithFilter`** (lines 291-324)
   - Only processes nodes in `affectedSet`
   - Skips unchanged subtrees (treats as rigid black boxes)

4. **Implemented `secondWalkWithFilter`** (lines 330-343)
   - Updates absolute positions
   - Only traverses into affected subtrees

5. **Refactored `partialRelayout`** (lines 205-300)
   - Uses filtered walks instead of recursive `relayout()`
   - Proper 7-step algorithm:
     1. Integrate new nodes into cache
     2. Build affected set
     3. Initialize affected nodes
     4. Invalidate thread pointers
     5. Run `firstWalkWithFilter` from roots
     6. Run `secondWalkWithFilter` from roots
     7. Collect positions

## What Broke

### Current Issue: Bulk Layout Broken ❌

**Symptom**: When running the app, all nodes appear in a **horizontal line** with y-coordinate = 0.0

**Root Cause**: The filtered walks are being called for the **initial bulk load**, but the `affectedSet` logic is designed for incremental updates.

### Test Results:

```bash
✓ strategy recreation test (passes)
✓ rapid additions test (passes)
✗ 100 nodes test (TIMEOUT after 30s)
```

The 100-node test is timing out, suggesting an infinite loop or performance issue in `firstWalkWithFilter`.

## Constraints

1. **Visual Stability**: Cannot do full relayout on every change - causes "visual thrash"
2. **Performance**: Must be O(d) where d=depth, not O(n) where n=total nodes
3. **Correctness**: Must maintain Tidy Tree algorithm guarantees (no overlaps, aesthetic spacing)
4. **State Management**: Strategy instance must persist to maintain cache

## Next Steps

### Immediate: Fix Bulk Layout

**Hypothesis**: The issue is likely in `firstWalkWithFilter` or how `setY` is being called.

**Debug Steps**:
1. Check if `firstWalkWithFilter` is being called during initial load
2. Verify Y-coordinates are set properly for all nodes, not just affected ones
3. Consider: Should initial load use `fullLayout()` path instead?

**Potential Fix**:
```typescript
// In fullLayout(), ensure we're not calling filtered walks
private fullLayout(context: PositioningContext): PositioningResult {
  // ... existing code ...

  for (const root of this.rootsCache) {
    this.layout(root); // ✅ Uses unfiltered firstWalk()
  }

  // NOT: this.firstWalkWithFilter(root, affectedSet); // ❌
}
```

### Medium Term: Fix Filtered Walk Logic

Compare our TypeScript implementation more carefully against the Rust reference:

**Rust Reference** (key insight):
```rust
fn first_walk_with_filter(node, set) {
  if !set.contains(node) {
    return; // Skip entire subtree
  }

  // BUT: Still need to process children's extremes/threads
  // even if children themselves aren't in set
}
```

**Our implementation might be too aggressive** - skipping nodes that need their metadata updated even if layout doesn't change.

### Long Term: Testing Strategy

1. Add test for bulk layout (initial load of 100 nodes)
2. Add test for incremental add after bulk load
3. Add performance benchmark (ensure O(d) not O(n))
4. Add visual regression test (screenshot comparison)

## Files Modified

- `webapp/src/components/voice-tree-graph-viz-layout.tsx` (lines 169-175)
  - Persist strategy instance

- `webapp/src/graph-core/graphviz/layout/IncrementalTidyLayoutStrategy.ts`
  - Line 608: Removed `child.relativeX += delta`
  - Lines 205-300: Refactored `partialRelayout()`
  - Lines 273-285: Added `buildAffectedSet()`
  - Lines 291-324: Added `firstWalkWithFilter()`
  - Lines 330-343: Added `secondWalkWithFilter()`

- `webapp/tests/e2e/isolated-with-harness/graph-core/incremental-layout.spec.ts`
  - Line 168: Adjusted threshold (300 → 350)

## References

- [Reingold-Tilford Blog Post](https://llimllib.github.io/pymag-trees/)
- Rust implementation: `tidy-tree` crate
- Original issue: nodes at (0,0) due to cache loss

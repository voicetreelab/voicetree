# Incremental Physics Layout: Handover Document

## 1. Goal, Constraints, and Desired System

### Goal
Make incremental node additions visually stable by preserving physics forces across `addNodes()` calls. Currently, `fullBuild()` applies physics (`microRelax`), but `addNodes()` skips it entirely, causing visual discontinuity.

### Constraints
- **WASM Tidy is fragile**: `partial_layout()` panics with "unreachable" when passed multiple nodes at once (bug just fixed by calling it once per node)
- **No dimension updates**: `updateNodeDimensions()` not implemented - would require removing/re-adding nodes to WASM
- **Performance**: Need O(dirty) updates for large graphs, not O(N)
- **Determinism**: Must be reproducible for same inputs

### Desired System
**Stateful physics with warm-start**:
- Tidy provides structural positions (hierarchy truth)
- Physics provides aesthetic refinement (spacing, angles)
- Persist small per-node `delta` (offset from tidy) and `velocity`
- On incremental add: warm-start physics from `tidyTarget + delta`, relax only dirty set, write back new delta

## 2. Pseudocode (Engineered Approach)

```typescript
// Persistent state (DONE - lines 142-143)
private physDelta = new Map<string, {x, y}>();  // Small offsets from tidy
private physVel   = new Map<string, {x, y}>();  // Momentum for warm-start

// Modified fullBuild() pipeline
async fullBuild(nodes) {
  // ... existing tidy layout ...
  const tidyUI = this.engineToUIPositions(enginePositions);

  // Warm-start from previous state (delta=0, vel=0 for new nodes)
  const seeded = warmStart(tidyUI, this.physDelta);

  // Run full physics with all nodes
  const relaxed = microRelaxLocal(seeded, tidyUI, allNodes, allNodeIds);

  // Write back deltas: delta[i] = relaxed[i] - tidyUI[i]
  updateDeltasAndVelocities(relaxed, tidyUI);

  return relaxed;
}

// Modified addNodes() pipeline
async addNodes(newNodes) {
  // ... existing tidy partial_layout ...
  const tidyUI = this.extractPositions();

  // Compute dirty set: new nodes + their parents + siblings + parents' siblings (2-hop)
  const dirtySet = computeDirtySet(newNodes, existingNodes);

  // Warm-start ALL nodes from tidy + delta
  const seeded = warmStart(tidyUI, this.physDelta);

  // Relax ONLY dirty nodes (with projected forces)
  const relaxed = microRelaxLocal(seeded, tidyUI, allNodes, dirtySet, 50); // Fewer iters

  // Update deltas/velocities for dirty nodes
  updateDeltasAndVelocities(relaxed, tidyUI);

  // Apply decay: delta *= 0.98 (prevent long-term drift)
  decayDeltas();

  return relaxed;
}

// New: Local physics with projected radial/tangential forces
function microRelaxLocal(seeded, tidyTarget, allNodes, dirtySet, iters=50) {
  const pos = clone(seeded);

  for (iter in iters) {
    for (id in dirtySet) {
      const parent = getParent(id);

      // Radial/tangential frame relative to parent
      const r_vec = pos[id] - pos[parent];
      const r = length(r_vec);
      const u_r = r_vec / r;           // radial unit vector
      const u_t = {x: -u_r.y, y: u_r.x}; // tangential unit vector

      // Forces:
      // 1. Radial spring: pull toward tidy target distance
      const L_target = length(tidyTarget[id] - tidyTarget[parent]);
      const F_radial = 0.08 * (r - L_target) * u_r;

      // 2. Tangential repulsion from siblings (preserves depth)
      let F_tangent = 0;
      for (sibling in getSiblings(id)) {
        if (!dirtySet.has(sibling)) continue;
        const d_vec = pos[id] - pos[sibling];
        const d = length(d_vec);
        const minSep = sum_of_radii(id, sibling);
        if (d < minSep) {
          const F_repel = 0.5 * (minSep - d);
          F_tangent += F_repel * dot(d_vec, u_t); // project onto tangent
        }
      }

      // Integrate with damping
      vel[id] = vel[id] * 0.85 + (F_radial + F_tangent * u_t) * dt;

      // Clamp: ±15% radial change, ±6° angular change (preserve hierarchy)
      vel[id] = clampRadialAndAngular(vel[id], r, L_target);

      pos[id] += vel[id];
    }
  }
  return pos;
}

function computeDirtySet(newNodes, existingNodes) {
  const dirty = new Set(newNodes.map(n => n.id));

  // Add 2-hop neighbors: parents, siblings, parents' siblings
  for (node of newNodes) {
    const parent = node.parentId;
    if (parent) {
      dirty.add(parent);
      const siblings = getChildren(parent);
      siblings.forEach(s => dirty.add(s));

      const grandparent = getParent(parent);
      if (grandparent) {
        const parentSiblings = getChildren(grandparent);
        parentSiblings.forEach(ps => dirty.add(ps));
      }
    }
  }
  return dirty;
}
```

## 3. Current State

### Implemented
- ✅ `physDelta` and `physVel` maps added (TidyLayoutStrategy.ts:142-143)
- ✅ Tests for `updateNodeDimensions` skipped (not implemented)
- ✅ WASM `partial_layout` bug workaround (call once per node instead of batched)

### Not Implemented
- ❌ `computeDirtySet()` function
- ❌ `microRelaxLocal()` with projected forces
- ❌ Warm-start logic in `fullBuild()` and `addNodes()`
- ❌ Delta write-back and decay mechanism
- ❌ Integration tests for incremental physics

### Active Bugs
- `partial_layout()` still fragile - may have other edge cases beyond the multi-node bug

## 4. Problems, Hunches, and Next Steps

### Problems
1. **WASM boundary is brittle**: `partial_layout` has bugs, `updateNodeDimensions` impossible without remove/re-add
2. **Unclear value proposition**: Is physics complexity worth it? Existing layout works reasonably well.
3. **Performance unknowns**: Will dirty-set physics be fast enough? What's the real-world dirty set size?
4. **State management complexity**: Persisting delta/velocity adds 2 maps + decay logic + cleanup on node delete

### Hunches
- **Projected forces are key**: Radial/tangential projection should preserve hierarchy better than raw Cartesian
- **Dirty set may be large**: Adding a child with many siblings → dirty includes all siblings + parent → could be O(N/depth) nodes
- **Simpler approach might suffice**: Just re-run existing `microRelax` on incremental adds with fewer iterations (100 vs 600)?

### Immediate Next Steps

**Option A: Simple Re-run (Recommended First)**
1. Modify `addNodes()` to call existing `microRelax()` with 100 iterations (like the first engineer suggested)
2. Test if visual discontinuity is actually resolved
3. Profile performance on realistic graph sizes
4. **If good enough**, stop here. Don't add state complexity.

**Option B: Full Stateful Physics (If Option A insufficient)**
1. Implement `computeDirtySet()` (start with 1-hop: new nodes + parents + siblings)
2. Implement `microRelaxLocal()` with projected forces (radial spring + tangential repulsion)
3. Add warm-start logic to `fullBuild()` and `addNodes()`
4. Add delta write-back in both paths
5. Add decay mechanism (`delta *= 0.98` per call)
6. Test incremental add visual continuity
7. Profile dirty-set size and performance

**My recommendation**: Start with Option A. The stateful approach adds significant complexity for uncertain benefit.

## 5. Where the Complexity Lives (Tech Debt)

### Biggest Struggle: WASM Boundary
- **No introspection**: Can't debug Rust panics, just "unreachable" errors
- **Limited API**: No `update_node_size`, `partial_layout` is buggy, can't query internal state
- **Fragile**: Adding nodes out of order → panic, wrong parent ID → panic, dimension mismatch → silent corruption

### Cognitive Load: Coordinate Spaces
- **Engine space**: Tidy's internal coordinates (swapped width/height for orientation)
- **UI space**: After rotation transformation (45° diagonal, left-right transpose, or identity)
- Easy to apply physics in wrong space or forget to convert

### Physics Code Complexity
- `microRelax()` is 240 lines (TidyLayoutStrategy.ts:568-723)
- 600 iterations × O(N²) repulsion checks (with radius cutoff)
- Leaf pre-distribution, circular seeding, force accumulation, clamped integration
- Hard to tune, hard to reason about convergence

### Test Brittleness
- 10 tests skipped (3 for missing `partial_layout`, 7 for missing `updateNodeDimensions`)
- Tests depend on exact numeric positions, break on small algorithm changes
- WASM initialization in tests is slow (~400ms setup time per file)

**Recommendation for future**: Consider replacing WASM tidy with pure TS implementation for better debuggability, or lobby for better WASM API (`update_node_size`, stable `partial_layout`, query methods).

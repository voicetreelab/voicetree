# Graph Layout Issues - Handover Document

## Current State (2025-10-02)

### Problem
TidyLayoutStrategy produces layouts **18,000+ pixels wide** for 29 nodes. Nodes appear as tiny dots with massive horizontal spread and minimal vertical hierarchy.

### Root Cause
**No canonical tree structure.** We reconstruct parent-child relationships from `linkedNodeIds` (wikilinks), but:
- Wikilinks point **upward** to parents (child → parent)
- Wikilinks create a **DAG**, not a tree (nodes can link to multiple parents)
- We're guessing at hierarchy instead of using authoritative tree structure

### Current Bandaids
1. `TidyLayoutStrategy.ts:265-290` - Inverts linkedNodeIds direction (parent ↔ child)
2. `TidyLayoutStrategy.ts:282` - Keeps only FIRST parent to force tree structure
3. Reduced spacing: `PEER_MARGIN=20`, `PARENT_CHILD_MARGIN=60`, `TREE_SPACING=80`

**These don't fix the fundamental issue.**

## Proper Solution

### Use Canonical Tree Structure

The `Node` interface already exists in `types.ts`:
```typescript
interface Node {
  id: string;
  parentId?: string;    // Single parent
  children: string[];   // Child IDs
  ...
}
```

**We need to:**
1. Get canonical tree from Python backend (it has the authoritative structure)
2. Store `Map<id, Node>` in `markdownFiles` ref or similar
3. Pass this to `TidyLayoutStrategy` instead of reconstructing from wikilinks
4. Update `PositioningContext.newNodes` to use `Node.parentId` and `Node.children`

### Where is Canonical Tree?
The tree visualization user showed comes from **somewhere** - likely:
- Python `backend/markdown_tree_manager/markdown_to_tree/`
- OR markdown frontmatter with `parent_id` field
- OR computed deterministically from wikilinks with specific rules

**Action:** Find where canonical tree lives and expose it to frontend.

## Files Modified (Current Session)
- `TidyLayoutStrategy.ts` - Inverted parent-child logic, reduced spacing
- `LayoutManager.ts` - Added debug logging
- `test-runner.ts` - Fixed to use TidyLayoutStrategy
- `layout/index.ts` - Removed non-existent ReingoldTilfordStrategy export

## Tests
- `bulk-load-layout.spec.ts` - All 5 tests passing
- BUT: Test uses small fixture, doesn't catch the 18k pixel width issue

## Next Steps
1. **Find canonical tree source** - Check Python backend or markdown frontmatter
2. **Expose to frontend** - Add to IPC API or parse from markdown
3. **Refactor LayoutManager** - Accept `Map<id, Node>` instead of `linkedNodeIds`
4. **Remove bandaids** - Delete parent-child inversion logic once canonical tree is used
5. **Update tests** - Add assertions for layout width (should be <2000px for 29 nodes)

## Contact
Issues discovered during debugging with user on 2025-10-02. Context limit reached at 180k tokens.

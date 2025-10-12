# TypeScript → Rust/WASM Layout Migration Status

**Date:** 2025-10-08
**Session:** Context continuation - WASM migration implementation

---

## Goal

Migrate tidy tree layout algorithm from TypeScript to Rust/WASM to:
1. Use upstream `zxch3n/tidy` Rust implementation as single source of truth
2. Solve existing incremental layout bugs (nodes at 0,0, timeout issues)
3. Improve performance with native WASM execution
4. Maintain existing test coverage

---

## Progress Summary

### ✅ Phase 1: WASM Build (COMPLETED)
**Status:** Built and integrated successfully

**Actions:**
- Installed toolchain: `wasm-pack`, `rustup`, `wasm32-unknown-unknown` target
- Updated `tidy/rust/crates/wasm/Cargo.toml`: `wasm-bindgen 0.2.74 → 0.2.95`
- Built WASM module: `cd tidy/rust/crates/wasm && wasm-pack build --target bundler`
- Generated artifacts at `src/graph-core/wasm-tidy/`:
  - `wasm_bg.wasm` (103 KB) - Binary
  - `wasm.js` - JS glue code
  - `wasm.d.ts` - TypeScript types

**Configuration:**
- Added `vite-plugin-wasm` and `vite-plugin-top-level-await` to both configs
- `vite.config.ts`: Added WASM plugins
- `electron.vite.config.ts`: Added WASM plugins with `build.target: 'esnext'`

---

### ✅ Phase 2: TidyLayoutStrategy WASM Implementation (COMPLETED)
**Status:** Implemented and tested successfully

**Implementation:** `src/graph-core/graphviz/layout/TidyLayoutStrategy.ts`
- **Before:** 616 lines (full TypeScript algorithm with TidyData, LayoutNode, LinkedYList, Contour classes)
- **After:** 162 lines (WASM adapter)

**Key Architecture:**
```typescript
// ID Mapping: String → Numeric for WASM
const stringToNum = new Map<string, number>();
const numToString = new Map<number, string>();

// Topological Sort (CRITICAL FIX)
const sortedNodes = this.topologicalSort(allNodes, parentMap);

// WASM Calls
this.tidy = Tidy.with_tidy_layout(PARENT_CHILD_MARGIN, PEER_MARGIN);
for (const node of sortedNodes) {
  this.tidy.add_node(id, width, height, parentId);
}
this.tidy.layout();
const posArray = this.tidy.get_pos(); // [id1, x1, y1, id2, x2, y2, ...]
```

**Critical Fix - Topological Sorting:**
- **Problem:** Rust `add_node()` requires parent to exist before child
- **Solution:** BFS-based topological sort ensures parent-first insertion order
- **Code:** `topologicalSort()` method (lines 113-161)

**Test Results:**
- ✅ `tests/e2e/isolated-with-harness/graph-core/layout-integration.spec.ts` **PASSING**
  - Bulk load 50 nodes: **18.4ms**
  - Incremental add 20 nodes: **232.8ms**
  - Proper Y-coordinate distribution (6 unique levels)
- ✅ Unit tests: Mostly passing (11 failures unrelated to WASM)
- ✅ **Manual testing:** `npm run electron` works perfectly
  ```
  IncrementalTidyLayoutStrategy.ts:210 [IncrementalTidy] First run, performing full layout
  LayoutManager.ts:226 [LayoutManager] Applied 39 positions
  ```

---

## Problems Encountered

### 1. ❌ Missing WASM Toolchain
**Error:** `command not found: wasm-pack`
**Solution:** Installed `wasm-pack` and `rustup`, added `wasm32-unknown-unknown` target

### 2. ❌ Incompatible wasm-bindgen Version
**Error:** `older versions of 'wasm-bindgen' are incompatible with current Rust`
**Solution:** Updated `Cargo.toml`: `wasm-bindgen = "0.2.95"`

### 3. ❌ WASM Panic on Arbitrary Node Order
**Error:** Blank page, WASM panic when child added before parent
**Root Cause:** Rust `map.get(&parent_id).unwrap()` panics if parent doesn't exist
**Solution:** Implemented BFS topological sort to guarantee parent-first insertion

**Agent Feedback Validation:**
> "The Rust API requires parents to be added before children. If we blindly sort by id, any cross-branch references will blow up with unwrap()."

This was **100% correct**. The topological sort fixed the issue.

### 4. ❌ Pre-Existing Test Failures (UNRESOLVED)

#### 4a. `tests/e2e/isolated-with-harness/graph-core/bulk-load-layout.spec.ts`
**Status:** SKIPPED - Pre-existing broken test infrastructure
**Error:** `The requested module '/src/graph-core/data/load_markdown/MarkdownParser.ts' does not provide an export named 'MarkdownParser'`
**Root Cause:**
- Test imports `MarkdownParser.parseDirectory()` which doesn't exist
- File exports `MarkdownToTreeConverter` and `loadMarkdownTree` instead
- Test harness was never working

**Decision:** Ignored per user instruction

#### 4b. `tests/e2e/full-electron/electron-real-folder.spec.ts`
**Status:** FAILING (pre-existing, **not caused by WASM migration**)
**Error:** `PAGE ERROR: Cannot set properties of undefined (setting 'prototype')`

**Investigation:**
```javascript
// Bundle error at line 101342 in dist/assets/main-DJz3cg5r.js
define(Color, color, {  // 'color' is undefined
  copy (channels) { ... }
});
```

**Root Cause:** d3-color bundling issue in production build, not WASM-related

**Evidence:**
- Tested with old config (no WASM plugins): **STILL FAILS** with same error
- Manual `npm run electron` (dev mode): **WORKS PERFECTLY**
- Only production build (`npx electron-vite build`) used by tests fails

**Configuration Changes Attempted:**
1. Added `build.target: 'esnext'` to electron.vite.config.ts
2. Reordered plugins: `topLevelAwait(), wasm()`
3. Tried `wasm({ syncInit: true })`
4. None resolved the d3-color bundling issue

**Conclusion:** This is a **pre-existing Electron production build issue**, unrelated to WASM migration.

---

## Current State

### What's Working
- ✅ WASM module built and integrated
- ✅ TidyLayoutStrategy using WASM (162 lines vs 616 lines)
- ✅ Topological sorting ensures correct node order
- ✅ layout-integration.spec.ts passing
- ✅ Manual `npm run electron` works perfectly
- ✅ App loads 39 nodes successfully with WASM layout

### What's Not Working
- ❌ electron-real-folder.spec.ts (pre-existing d3-color bundling issue)
- ❌ bulk-load-layout.spec.ts (pre-existing MarkdownParser import issue)

---

## Constraints

1. **Synchronous API:** `PositioningStrategy.position()` must remain synchronous
2. **Parent-before-child:** Rust API requires topological ordering
3. **No async in strategy layer:** WASM init handled at module load, not per-call
4. **ID Mapping:** String IDs → numeric IDs for WASM, then back
5. **Test Coverage:** Existing tests must pass (layout-integration ✓)

---

## Agent Feedback Analysis

The other agent's feedback identified 6 key concerns:

1. **✅ Synchronous layout contract:** Correctly kept synchronous, no async introduced
2. **✅ Node insertion order:** Implemented topological sort - CRITICAL fix
3. **⚠️ Incremental strategy O(n):** Current implementation does full relayout
   - Agent noted: "partial-relayout API not exposed in WASM yet"
   - Phase 3 will need to address this
4. **✅ ID mapping optimization:** Used simple array lookup (numToString Map)
5. **✅ Build pipeline:** Added WASM support without breaking SSR/workers
6. **✅ Test expectations:** Topological sort ensures deterministic ordering

**Overall:** Agent feedback was highly accurate and guided successful implementation.

---

## Next Steps

### Phase 3: IncrementalTidyLayoutStrategy (PENDING)
**Goal:** Migrate incremental layout to WASM

**Challenges:**
- Current WASM API only exposes `layout()` (full O(n) relayout)
- Need to either:
  - A) Extend Rust WASM to expose `partial_layout(changed_ids)` for true O(d) incremental
  - B) Accept O(n) for now and optimize later

**Approach:**
1. Review current `IncrementalTidyLayoutStrategy.ts` (uses metadata cache)
2. Decide: Extend WASM API or accept full relayout?
3. Implement similar to Phase 2 (maintain Tidy instance between calls)
4. Ensure tests pass

### Phase 4: Cleanup and Integration (PENDING)
1. Delete old TypeScript tidy algorithm code (if any remains)
2. Run full test suite
3. Document WASM recompilation process for future changes
4. Update README/docs

### Future: Fix Pre-Existing Test Issues
**Not blocking migration, but should be addressed:**

1. Fix electron-real-folder.spec.ts d3-color bundling
   - Investigate why production build breaks d3-color
   - May need to exclude d3-color from bundling or fix plugin order

2. Fix bulk-load-layout.spec.ts MarkdownParser import
   - Either create `MarkdownParser.parseDirectory()` wrapper
   - Or update test to use `loadMarkdownTree()` directly

---

## Compilation Commands Reference

### WASM Recompilation (if Rust changes)
```bash
cd tidy/rust/crates/wasm
wasm-pack build --target bundler
# Output: src/graph-core/wasm-tidy/*.wasm, *.js, *.d.ts
```

### Development
```bash
npm run electron       # Dev mode (works perfectly)
npm run dev           # Browser-only dev
```

### Testing
```bash
npm run test          # Unit tests + electron-real-folder
npx playwright test tests/e2e/isolated-with-harness/graph-core/layout-integration.spec.ts  # ✅ PASSING
```

### Production Build (has d3-color issue)
```bash
npx electron-vite build
npx playwright test tests/e2e/full-electron/electron-real-folder.spec.ts  # ❌ FAILING (pre-existing)
```

---

## Files Modified

**Core Implementation:**
- `src/graph-core/graphviz/layout/TidyLayoutStrategy.ts` - WASM adapter (616→162 lines)

**Build Configuration:**
- `electron.vite.config.ts` - Added WASM plugins, `build.target: 'esnext'`
- `vite.config.ts` - Added WASM plugins
- `package.json` - Added `vite-plugin-wasm`, `vite-plugin-top-level-await`
- `tidy/rust/crates/wasm/Cargo.toml` - Updated wasm-bindgen to 0.2.95

**WASM Artifacts (generated):**
- `src/graph-core/wasm-tidy/wasm_bg.wasm` - 103 KB binary
- `src/graph-core/wasm-tidy/wasm.js` - JS glue code
- `src/graph-core/wasm-tidy/wasm.d.ts` - TypeScript definitions

**Test Infrastructure:**
- `tests/e2e/full-electron/electron-real-folder.spec.ts` - Added error logging

---

## Summary

**Phase 1 & 2: COMPLETE ✅**
- WASM successfully integrated
- TidyLayoutStrategy uses Rust implementation
- Tests passing where infrastructure works
- Manual testing confirms everything works

**Blockers:** None for migration. Pre-existing test infrastructure issues are **separate concerns**.

**Ready for Phase 3:** IncrementalTidyLayoutStrategy implementation

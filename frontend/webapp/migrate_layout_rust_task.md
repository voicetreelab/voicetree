# Task: Migrate Incremental Layout to Rust/WASM Implementation

## Goal
Adopt the upstream `zxch3n/tidy` Rust implementation (compiled to WebAssembly) as the single source of truth for both bulk and incremental tidy layout so that we inherit the battle-tested cache handling, incremental relayout, and performance characteristics.

## Constraints
- Must integrate with existing Cytoscape-based UI; no frontend rewrite.
- Preserve current `LayoutManager` and strategy interfaces so higher-level callers stay untouched.
- No network calls at runtime: ship the `.wasm` with the bundle.
- Keep Playwright and electron tests exercising the same high-level APIs (bulk load, incremental adds).
- Minimise TypeScript surface area; Rust should own tree state and incremental cache.

## Key Challenges
- Consistent node representations: the Rust module expects stable IDs, parent/child relations, widths/heights; we currently reconstruct context from Cytoscape per call and sometimes create placeholder nodes.
- State caching: Rust code maintains layout caches across calls; we must initialise once and reuse per session.
- WASM integration: need build pipeline (`wasm-pack`), loader in Vite/Electron, and async initialisation that works both in browser and Electron renderer.
- Bridging data structures: marshaling between TypeScript `NodeInfo`/`Position` and the Rust structs, including handling incremental changes list.

## Plan
1. **WASM Build Setup**
   - Add a `tidy-wasm` package via `wasm-pack build --target bundler` from `tidy/rust/crates/tidy-tree`.
   - Wire the output into the webapp build (Vite/Electron) and ensure `.wasm` asset loads asynchronously at app start.
2. **Wrapper Module**
   - Create `src/graph-core/graphviz/layout/wasmTidyAdapter.ts` that initialises the WASM module once (`await init()`), and exposes `layoutFull(nodes)` and `layoutIncremental(existingNodes, newNodes)` functions.
   - Marshal `NodeInfo` → Rust-friendly payload (arrays of structs) and map responses back to `Map<string, Position>`.
3. **Strategy Replacement**
   - Replace `IncrementalTidyLayoutStrategy` with a thin adapter that delegates to the WASM wrapper while keeping the `PositioningStrategy` interface.
   - Ensure strategy maintains a session-scoped Rust layout instance (one per LayoutManager).
4. **Cytoscape Integration Adjustments**
   - Audit `useFileWatcher` to guarantee `parentId` is present for new nodes (fallback to root list if missing) so Rust cache stays consistent.
   - Batch incremental additions when possible to reduce per-node calls.
5. **Testing & Validation**
   - Update existing Playwright/Electron tests to run against the WASM-backed strategy; verify bulk + incremental flows.
   - Add a sanity test for the adapter (e.g., small tree round-trip).
6. **Cleanup**
   - Remove legacy TypeScript incremental tidy implementation once the WASM path is stable and all tests pass.

## System Overview (ASCII)

```
+-------------------+       +-------------------+
|   Cytoscape UI    |<----->|   LayoutManager   |
+-------------------+       +---------+---------+
                                      |
                                      v
                         +---------------------------+
                         | IncrementalTidyStrategy   |
                         | (WASM-backed adapter)     |
                         +-------------+-------------+
                                       |
                 init/load wasm        v
          +-------------------+   +-------------------+
          | tidy_wasm_loader  |-->|  Rust Tidy WASM   |
          | (ts async init)   |   |  (full + partial) |
          +-------------------+   +-------------------+
```

### Main Flow (Bulk + Incremental)
```
[UseFileWatcher] --nodes--> [LayoutManager.position()] --context--> [IncrementalTidyStrategy]
      |                                                            |
      |                               (on first call) init wasm -->|
      |                                                            v
      |                                             [Rust tidy layout engine]
      |                                                            |
      '--- apply positions <---------------------------------------'
```


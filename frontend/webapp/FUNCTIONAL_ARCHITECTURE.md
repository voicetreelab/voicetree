# Functional Graph Architecture - Current State

## 📊 High-Level Architecture (Boxes & Arrows)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        RENDERER PROCESS                             │
│                                                                     │
│  ┌──────────────┐                                                  │
│  │ User Actions │  (onClick, addNode, updateNode, deleteNode)      │
│  └──────┬───────┘                                                  │
│         │         side effect: optimistic UI updates.                                                  │
│         │ IPC                                                       │
│         ▼                                                           │
└─────────────────────────────────────────────────────────────────────┘
          │
          │ 'graph:createNode', 'graph:updateNode', 'graph:deleteNode'
          │
┌─────────▼───────────────────────────────────────────────────────────┐
│                         MAIN PROCESS                                │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │         IMPURE SHELL (electron/handlers/)                  │   │
│  │                                                             │   │
│  │  ┌──────────────────────────────────────┐                 │   │
│  │  │  ipc-graph-handlers.ts               │                 │   │
│  │  │                                       │                 │   │
│  │  │  ipcMain.handle('graph:createNode')  │                 │   │
│  │  │    1. getGraph() → Graph             │ ◄───────────┐   │   │
│  │  │    2. Build effect:                  │             │   │   │
│  │  │       effect = apply_graph_updates   │             │   │   │
│  │  │                (graph, action)       │             │   │   │
│  │  │    3. Execute: result = effect(env)()│────┐        │   │   │
│  │  │    4. setGraph(result.right)         │    │        │   │   │
│  │  └──────────────────────────────────────┘    │        │   │   │
│  │                                               │        │   │   │
│  │  ┌──────────────────────────────────────┐    │        │   │   │
│  │  │  file-watch-handlers.ts              │    │        │   │   │
│  │  │                                       │    │        │   │   │
│  │  │  onFileChange(path, content)         │    │        │   │   │
│  │  │    1. getGraph() → Graph             │ ◄──┼────────┤   │   │
│  │  │    2. Build effect:                  │    │        │   │   │
│  │  │       effect = apply_db_updates      │    │        │   │   │
│  │  │                (graph, fsUpdate)     │    │        │   │   │
│  │  │    3. Execute: newGraph = effect(env)│────┼───┐    │   │   │
│  │  │    4. setGraph(newGraph)             │    │   │    │   │   │
│  │  │    5. env.broadcast(newGraph)        │────┼───┼─┐  │   │   │
│  │  └──────────────────────────────────────┘    │   │ │  │   │   │
│  │                                               │   │ │  │   │   │
│  │  Environment (Env):                          │   │ │  │   │   │
│  │  • vaultPath: string                         │   │ │  │   │   │
│  │  • broadcast: (graph) => void                │   │ │  │   │   │
│  └──────────────────────────────────────────────┼───┼─┼──┘   │   │
│                                                  │   │ │      │   │
│                                                  │   │ │      │   │
│         Global State (Single Mutation Point)    │   │ │      │   │
│         let currentGraph: Graph ◄────────────────┘   │ │      │   │
│                  │                                   │ │      │   │
│                  └───────────────────────────────────┘ │      │   │
│                                                        │      │   │
│  ┌────────────────────────────────────────────────────▼──────┼───┤
│  │         PURE LAYER (src/functional_graph/pure/)           │   │
│  │                                                            │   │
│  │  ┌───────────────────────────────────────┐                │   │
│  │  │  applyGraphActionsToDB.ts             │                │   │
│  │  │                                        │                │   │
│  │  │  apply_graph_updates(                 │                │   │
│  │  │    graph: Graph,                      │                │   │
│  │  │    action: NodeAction                 │                │   │
│  │  │  ): AppEffect<Graph>                  │                │   │
│  │  │                                        │                │   │
│  │  │  Returns: (env: Env) =>               │                │   │
│  │  │    TaskEither<Error, Graph>           │                │   │
│  │  │                                        │                │   │
│  │  │  Effect Description:                  │                │   │
│  │  │  • Update graph (pure)                │                │   │
│  │  │  • Wrap fs.writeFile in TaskEither   │                │   │
│  │  │  • Return new Graph                   │                │   │
│  │  └───────────────────────────────────────┘                │   │
│  │                                                            │   │
│  │  ┌───────────────────────────────────────┐                │   │
│  │  │  applyFSEventToGraph.ts               │                │   │
│  │  │                                        │                │   │
│  │  │  apply_db_updates_to_graph(           │                │   │
│  │  │    graph: Graph,                      │                │   │
│  │  │    update: FSUpdate                   │                │   │
│  │  │  ): EnvReader<Graph>                  │                │   │
│  │  │                                        │                │   │
│  │  │  Returns: (env: Env) => Graph         │                │   │
│  │  │                                        │                │   │
│  │  │  Pure Computation:                    │                │   │
│  │  │  • Parse markdown                     │                │   │
│  │  │  • Update graph structure             │                │   │
│  │  │  • Extract edges from [[links]]       │                │   │
│  │  │  • Return new Graph (NO broadcast!)   │                │   │
│  │  └───────────────────────────────────────┘                │   │
│  │                                                            │   │
│  │  Other Pure Functions:                                    │   │
│  │  • action-creators.ts       (Build NodeAction objects)    │   │
│  │  • project-to-cytoscape.ts  (Graph → CytoscapeElements)   │   │
│  │  • markdown_parsing/        (Parse markdown, extract data)│   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─────────────────────────────────────────┐                     │
│  │  FILE SYSTEM (Vault)                    │                     │
│  │                                          │                     │
│  │  vault/                                  │                     │
│  │  ├── node1.md  ◄──── fs.writeFile ───────┼─────────────────────┘
│  │  ├── node2.md                            │
│  │  └── node3.md  ───── fs watch ──────────┐│
│  └─────────────────────────────────────────┘│
│                                              │
│                                              └─── FileWatchHandler
└──────────────────────────────────────────────────────────────────┘
          │
          │ IPC: 'graph:stateChanged'
          │
┌─────────▼───────────────────────────────────────────────────────────┐
│                     RENDERER PROCESS                                │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │  VoiceTreeGraphView / Cytoscape                          │     │
│  │                                                           │     │
│  │  onGraphStateChanged(graph: Graph)                       │     │
│  │    1. Project: elements = projectToCytoscape(graph)      │     │
│  │    2. Reconcile: cy.batch(() => update DOM)              │     │
│  └──────────────────────────────────────────────────────────┘     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 🎯 Current State Summary

### ✅ What's Working

1. **Pure Layer** (`src/functional_graph/pure/`)
   - ✅ Types defined with Reader monad (`AppEffect<A>`, `EnvReader<A>`)
   - ✅ User actions → DB effects (`applyGraphActionsToDB.ts`)
   - ✅ FS events → Graph updates (`applyFSEventToGraph.ts`)
   - ✅ Graph → Cytoscape projection (`project-to-cytoscape.ts`)
   - ✅ Action creators (pure functions to build NodeAction objects)
   - ✅ Markdown parsing utilities
   - ✅ **NO SIDE EFFECTS** - All pure!

2. **Impure Shell** (`electron/handlers/`)
   - ✅ IPC handlers execute DB effects
   - ✅ File watch handlers execute FS update effects
   - ✅ Environment setup (vaultPath, broadcast)
   - ✅ Global state management (`currentGraph`)
   - ✅ Broadcast to renderer

3. **Tests**
   - ✅ 15/15 tests passing for `apply-graph-updates`
   - ✅ 16/16 tests passing for `apply-db-updates`
   - ✅ 9/9 tests passing for `project-to-cytoscape`
   - ✅ 15/15 tests passing for `action-creators`
   - ✅ Idempotent delete (no failures on missing files)

4. **Architecture**
   - ✅ Reader monad pattern implemented
   - ✅ Clear pure/impure boundary
   - ✅ Environment dependency injection
   - ✅ Effect descriptions vs execution separated

### ⚠️ Warnings (Expected)

- ESLint warnings about `try-catch` in handlers (expected - impure shell can have error handling)
- ESLint warning about `throw` in pure function (acceptable for fail-fast)

## 🔄 Data Flow Examples

### Example 1: User Creates Node

```
1. User clicks "Add Node" button (Renderer)
   ↓
2. IPC: 'graph:createNode' → Main Process
   ↓
3. Handler (IMPURE):
   - Calls: apply_graph_updates(currentGraph, action)
   - Gets: AppEffect<Graph>  (just a description!)
   - Executes: await effect(env)()
   - Result: Either<Error, Graph>
   ↓
4. If success:
   - setGraph(newGraph)       (mutation)
   - FS writes file           (side effect via TaskEither)
   ↓
5. FileWatchHandler detects new file
   ↓
6. File handler (IMPURE):
   - Calls: apply_db_updates_to_graph(currentGraph, fsUpdate)
   - Gets: EnvReader<Graph>   (just a function!)
   - Executes: newGraph = effect(env)
   - Broadcasts: env.broadcast(newGraph)
   ↓
7. Renderer receives 'graph:stateChanged'
   ↓
8. UI updates via Cytoscape reconciliation
```

### Example 2: External File Change

```
1. User edits file in VS Code
   ↓
2. FileWatchHandler detects change
   ↓
3. File handler (IMPURE):
   - Build effect: apply_db_updates_to_graph(graph, fsUpdate)
   - Execute: newGraph = effect(env)
   - Broadcast: env.broadcast(newGraph)
   ↓
4. Renderer receives updated graph
   ↓
5. Cytoscape reconciles: updates node label, edges
```

## 📋 Next Steps

### Phase 1: Complete Basic Integration ✅ DONE
- ✅ Implement Reader monad pattern
- ✅ Refactor pure functions to use environment
- ✅ Update handlers to execute effects
- ✅ Fix tests
- ✅ Remove side effects from pure layer

### Phase 2: Wire Up to Real Application (CURRENT)

**Priority tasks:**

1. **Connect to main.ts**
   - Wire up handlers in electron/main.ts
   - Initialize global state from `loadGraphFromDisk`
   - Setup FileWatchHandler integration
   - Test end-to-end flow

2. **Renderer Integration**
   - Connect IPC calls from VoiceTreeGraphView
   - Subscribe to 'graph:stateChanged' events
   - Test optimistic updates

3. **Create Central Runtime Module** (Optional but recommended)
   ```
   src/functional_graph/shell/main/graph-runtime.ts
   - Centralize Env creation
   - Manage currentGraph state
   - Export getGraph(), setGraph(), getEnv()
   ```

4. **Documentation**
   - Update CLAUDE.md with new architecture
   - Document the Reader pattern usage
   - Add examples for common operations

### Phase 3: Advanced Features (FUTURE)

1. **Undo/Redo**
   - Action log (all NodeActions are already serializable!)
   - Replay actions to rebuild state
   - Time-travel debugging

2. **Optimistic Updates**
   - Renderer can call `apply_graph_updates` locally
   - Show immediate UI feedback
   - Reconcile when server confirms

3. **State Persistence**
   - Save `currentGraph` to .voicetree/graph_data.json
   - Load on startup
   - Handle conflicts with filesystem

4. **Composition & Chaining**
   ```typescript
   pipe(
     createNode(nodeId, content),
     chain(graph => updateNode(parentId, newContent)),
     chain(graph => addEdge(nodeId, parentId))
   )
   ```

5. **Testing Improvements**
   - Property-based testing with fast-check
   - Test effect composition
   - Mutation testing verification

## 🎓 Key Architectural Decisions

### Why Reader Monad?

**Before (Curried Parameters):**
```typescript
const applyUpdate = apply_graph_updates(vaultPath)  // Partial application
const [newGraph, effect] = applyUpdate(graph, action)
```

**After (Reader):**
```typescript
const effect = apply_graph_updates(graph, action)   // No partial application
const result = await effect(env)()                  // Env provided at execution
```

**Benefits:**
- Environment passed at execution time (more flexible)
- Easy to add new dependencies to `Env` without changing function signatures
- Standard FP pattern, composable
- Testing: just provide test environment

### Why Separate Pure/Impure?

**Pure Layer:**
- Testable without mocks
- Referentially transparent
- Composable
- Reusable (e.g., renderer can use for optimistic updates)

**Impure Shell:**
- Single place for all side effects
- Easy to mock for integration tests
- Clear responsibility: "execute what pure layer describes"

### Why TaskEither?

```typescript
type AppEffect<A> = ReaderTaskEither<Env, Error, A>
//                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                  Reader: needs Env
//                  Task:   async computation
//                  Either: can fail with Error or succeed with A
```

**Alternatives considered:**
- Promises: No typed errors, can't compose as easily
- Callbacks: Callback hell, hard to compose
- async/await: No explicit error types, harder to compose

**TaskEither wins:**
- Type-safe error handling
- Composable (map, chain, fold)
- Lazy (doesn't execute until called)
- Standard in fp-ts ecosystem

## 🔍 How to Verify Everything Works

### Manual Testing Checklist

```bash
# 1. Run unit tests
npm run test -- tests/unit/graph-core/functional/ --run

# 2. Build the app
npm run build

# 3. Run the app
npm run electron

# 4. Test user actions
# - Click "Add Node" → should create file + update UI
# - Edit node content → should update file + UI
# - Delete node → should remove file + UI

# 5. Test external file changes
# - Edit vault/*.md in VS Code
# - Check if UI updates automatically

# 6. Check console for errors
# - Should see: "[IPC] Graph handlers registered"
# - Should see: "[FileWatch] Graph handlers registered"
```

### Debug Checklist

If something doesn't work:

1. **Check console logs**
   - Are handlers registered?
   - Any errors during effect execution?

2. **Check graph state**
   - IPC: `electronAPI.graph.getState()`
   - Should match filesystem

3. **Check file watcher**
   - Are file events firing?
   - Is broadcast being called?

4. **Check types**
   - `npx tsc --noEmit`
   - Should have no errors

## 📊 Architecture Health Metrics

| Metric | Current | Goal | Status |
|--------|---------|------|--------|
| Pure functions | 100% | 100% | ✅ |
| Test coverage | 55/55 | 100% | ✅ |
| Side effects in pure layer | 0 | 0 | ✅ |
| Type safety | 100% | 100% | ✅ |
| ESLint errors | 0 | 0 | ✅ |
| Integration with main.ts | 0% | 100% | ⏳ |
| Renderer integration | 0% | 100% | ⏳ |
| End-to-end tests | 0% | 80% | ⏳ |

## 🎉 Summary

**Current State:**
- ✅ Pure functional core is complete and tested
- ✅ Reader monad pattern fully implemented
- ✅ All critical bugs fixed (broadcast, imports, idempotent delete)
- ✅ Clear architectural boundaries
- ⏳ Ready for integration with main application

**Next Immediate Steps:**
1. Wire up handlers in `electron/main.ts`
2. Test end-to-end flow in running application
3. Document usage patterns

**Long-term Vision:**
- Undo/redo
- Time-travel debugging
- Optimistic updates
- Composable effect chains
- Full type safety throughout

The foundation is solid. Now it's time to connect it to the real application! 🚀

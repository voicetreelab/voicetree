# Functional Graph Architecture - Migration Next Steps

## Current Status: Phase 1-3 Foundation Complete ✅

### Completed
- ✅ **Phase 1**: Load graph from disk (pure functions, 41 tests passing)
- ✅ **Phase 2**: Event handlers wired up (26 tests passing)
- ✅ **Phase 3**: Renderer actions & projection (38 tests passing)
- ✅ **ESLint FP rules**: Configured and enforced (26 errors fixed)
- ✅ **105 total tests passing** in functional architecture

### Current Architecture State

```
Pure Functional Core:
├── types.ts (Domain model)
├── applyGraphActionsToDB.ts (User actions → Graph)
├── applyFSEventToGraph.ts (FS events → Graph)
├── project-to-cytoscape.ts (Graph → UI)
└── action-creators.ts (Pure action factories)

Loaders:
└── load-graph-from-disk.ts (FS → Graph)

Effects (currently with currying - needs refactor):
├── DBIO (filesystem persistence)
└── UIIO (renderer broadcast)

Imperative Shell:
├── GraphStateManager.ts (Subscription & reconciliation)
└── Handlers (IPC & file watch)
```

---

## Immediate Next Steps (High Priority)

### 1. **Refactor to Reader Monad** 🔴 BLOCKING

**Status**: Not started
**Blockers**: Currying breaks tests, prevents vault switching
**Task file**: `vault/Task-RefactorToReaderMonad.md`

**What**: Change DBIO/UIIO from curried functions to Reader monad pattern
```typescript
// Before (curried)
type DBIO<A> = () => Promise<A>
apply_graph_updates(vaultPath)(graph, action)

// After (Reader)
type DBIO<A> = (env: GraphEnv) => Promise<A>
apply_graph_updates(graph, action)
```

**Why**:
- Enables vault switching
- Fixes broken tests
- Idiomatic FP
- Explicit dependencies

**Effort**: 2-3 hours
**Impact**: Unblocks all future work

---

### 2. **Integrate GraphStateManager into VoiceTreeGraphView** 🟡

**Status**: Not started
**Depends on**: Reader monad refactor

**What**: Wire up functional graph in renderer alongside existing FileEventManager

```typescript
// VoiceTreeGraphView.ts
export class VoiceTreeGraphView {
  private graphStateManager?: GraphStateManager

  constructor(...) {
    if (USE_FUNCTIONAL_GRAPH) {
      this.graphStateManager = new GraphStateManager(this.cy)
    }

    // DO NOT keep old FileEventManager running. NO FALLBACKS.

---

### 3. **End-to-End Testing** 🟢

**Status**: Not started
**Depends on**: GraphStateManager integration

**What**: Create e2e test for full functional flow

```typescript
// tests/e2e/functional-graph-flow.spec.ts
test('user creates node → persists → broadcasts → renders', async () => {
  // 1. User clicks canvas
  const action = createCreateNodeAction(...)
  await electronAPI.graph.createNode(action)

  // 2. File written to disk
  expect(fs.existsSync('/vault/123.md')).toBe(true)

  // 3. Graph broadcast received
  expect(graphStateChangedCallback).toHaveBeenCalled()

  // 4. Cytoscape updated
  expect(cy.nodes()).toHaveLength(1)
})
```

**Why**:
- Verify entire pipeline works
- Catch integration bugs early
- Document expected behavior

**Effort**: 3-4 hours
**Impact**: Confidence in architecture

---

## Phase 4: Gradual Migration (Medium Priority)

### 4. **Migrate User Actions One by One** 🟡

**Strategy**: Feature flags for each action type

```typescript
const USE_FUNCTIONAL_CREATE = process.env.FUNCTIONAL_CREATE === 'true'
const USE_FUNCTIONAL_UPDATE = process.env.FUNCTIONAL_UPDATE === 'true'
const USE_FUNCTIONAL_DELETE = process.env.FUNCTIONAL_DELETE === 'true'

// In VoiceTreeGraphView
handleNodeCreate() {
  if (USE_FUNCTIONAL_CREATE) {
    // New functional path
    const action = createCreateNodeAction(...)
    electronAPI.graph.createNode(action)
  } else {
    // Old path
    electronAPI.createStandaloneNode()
  }
}
```

**Migration Order**:
1. **CreateNode** (simplest, no dependencies)
2. **UpdateNode** (depends on edit workflow)
3. **DeleteNode** (needs confirmation dialog)

**Effort per action**: 2-3 hours
**Total effort**: 6-9 hours

---

### 5. **Remove Legacy Code** 🟢

**Status**: Blocked by migration
**Depends on**: All actions migrated

**What to remove**:
```
❌ FileEventManager.ts (1,200 lines)
❌ GraphMutator.ts (800 lines)
❌ Old IPC handlers:
   - create-standalone-node
   - save-file-content
   - delete-file
❌ MarkdownNodeManager methods (create, save, delete)
```

**Keep**:
```
✅ CytoscapeCore.ts (rendering)
✅ FloatingWindowManager.ts (editors)
✅ FileWatchManager.ts (chokidar wrapper)
✅ PositionManager.ts (position persistence)
✅ UI managers (hotkeys, search, etc.)
```

**Effort**: 2-3 hours cleanup + testing
**Impact**: ~2,000 lines removed, simpler codebase

---

## Phase 5: Advanced Features (Low Priority)

### 6. **Undo/Redo** 🟢

**Status**: Not started
**Depends on**: Functional graph in production

**Design**:
```typescript
// Action log in main process
const actionHistory: NodeAction[] = []
let currentIndex = 0

// Undo: replay all actions except last
function undo() {
  currentIndex--
  const newGraph = replayActions(initialGraph, actionHistory.slice(0, currentIndex))
  currentGraph = newGraph
  broadcast(newGraph)
}

// Redo: replay one more action
function redo() {
  currentIndex++
  const newGraph = replayActions(initialGraph, actionHistory.slice(0, currentIndex))
  currentGraph = newGraph
  broadcast(newGraph)
}
```

**Effort**: 4-6 hours
**Value**: High user value

---

### 7. **Event Sourcing** 🟢

**Status**: Research
**Depends on**: Action history

**Design**: Persist action log to disk

```typescript
// .voicetree/action-log.jsonl
{"type": "CreateNode", "nodeId": "1", "content": "...", "timestamp": "..."}
{"type": "UpdateNode", "nodeId": "1", "content": "...", "timestamp": "..."}
```

**Benefits**:
- Audit trail
- Time-travel debugging
- Conflict resolution
- Sync between devices

**Effort**: 6-8 hours
**Value**: Enables collaboration features

---

### 8. **Multi-Vault Support** 🟡

**Status**: Not started
**Enabled by**: Reader monad (env can change)

**Design**:
```typescript
// User switches vault
ipcMain.handle('switch-vault', async (event, newVaultPath) => {
  // Just update environment!
  currentVaultPath = newVaultPath

  // Reload graph
  currentGraph = await loadGraphFromDisk(newVaultPath)()

  // Broadcast new graph
  const env = createEnv()
  env.broadcast(currentGraph)
})
```

**Effort**: 2-3 hours (once Reader monad in place)
**Value**: High user value

---

### 9. **Performance Optimization** 🟢

**Status**: Not needed yet
**Depends on**: Usage data

**Potential optimizations**:
- Incremental projection (diff-based rendering)
- Virtual rendering for large graphs (>1000 nodes)
- Batch action processing
- WebWorker for graph operations
- Snapshot persistence (avoid full reload)

**Effort**: Variable (1-10 hours per optimization)
**Priority**: Only when performance becomes issue

---

## Timeline & Roadmap

### Week 1: Foundation (In Progress)
- ✅ Phase 1-3 implementation
- ✅ ESLint FP rules
- 🔴 **Reader monad refactor** (blocking)

### Week 2: Integration
- 🟡 GraphStateManager integration
- 🟢 E2E testing
- 🟡 Migrate CreateNode action

### Week 3: Migration
- 🟡 Migrate UpdateNode action
- 🟡 Migrate DeleteNode action
- 🟢 Remove legacy code

### Week 4: Polish
- 🟢 Undo/Redo
- 🟡 Multi-vault support
- 🟢 Documentation

### Future (as needed)
- Event sourcing
- Performance optimization
- Collaboration features

---

## Decision Points

### When to Remove Feature Flags?

**Criteria**:
- ✅ All actions migrated
- ✅ E2E tests pass
- ✅ No regressions in production
- ✅ Performance is acceptable
- ✅ 2 weeks of stable usage

**Then**: Remove flags, delete legacy code

### When to Enable for All Users?

**Criteria**:
- ✅ Feature flags removed
- ✅ Legacy code deleted
- ✅ All tests pass
- ✅ Documentation updated
- ✅ 1 week of dogfooding

**Then**: Make functional graph the default

---

## Risk Management

### Rollback Plan

If functional graph causes issues:

1. **Immediate**: Disable feature flag
   ```typescript
   const USE_FUNCTIONAL_GRAPH = false
   ```

2. **Short-term**: Fix bug in functional code

3. **Long-term**: If unfixable, keep legacy code as fallback

### Migration Safety

- Keep both systems running in parallel
- Feature flags for each action type
- Extensive e2e testing
- Gradual rollout to users

---

## Success Metrics

### Technical
- ✅ 100% test coverage of functional code
- ✅ 0 ESLint FP errors
- ✅ No performance regression
- ✅ <2000 lines of new code (vs ~2000 removed)

### Product
- ✅ Undo/redo works
- ✅ Vault switching works
- ✅ All existing features work
- ✅ No user complaints

### Team
- ✅ Easier to reason about code
- ✅ Faster to add features
- ✅ Fewer bugs in production

---

## Questions to Answer

1. **Should we keep FileWatchManager?**
   - Yes - it's just a chokidar wrapper, still useful

2. **Should we keep PositionManager?**
   - Yes - position persistence is separate concern

3. **Should GraphStateManager be a class?**
   - Yes - it's the imperative shell, allowed to use classes
   - Could be refactored to functions later if needed

4. **Should we use fp-ts more extensively?**
   - Maybe - Reader monad could use fp-ts/Reader
   - For now, simple types are fine
   - Can add fp-ts gradually

---

## Priority Matrix

| Task | Priority | Effort | Impact | Status |
|------|----------|--------|--------|--------|
| Reader monad refactor | 🔴 Critical | 2-3h | High | Not started |
| GraphStateManager integration | 🟡 High | 4-6h | High | Not started |
| E2E testing | 🟢 Medium | 3-4h | Medium | Not started |
| Migrate CreateNode | 🟡 High | 2-3h | Medium | Not started |
| Migrate UpdateNode | 🟡 High | 2-3h | Medium | Not started |
| Migrate DeleteNode | 🟡 High | 2-3h | Medium | Not started |
| Remove legacy code | 🟢 Medium | 2-3h | High | Blocked |
| Undo/Redo | 🟢 Medium | 4-6h | High | Blocked |
| Multi-vault | 🟡 High | 2-3h | High | Blocked |
| Event sourcing | 🟢 Low | 6-8h | Medium | Future |
| Performance | 🟢 Low | Variable | Low | Future |

---

## Conclusion

**Next immediate action**: Start the Reader monad refactor (Task-RefactorToReaderMonad.md)

**Goal**: Have functional graph fully integrated and legacy code removed within 3-4 weeks.

**Outcome**: Simpler, more maintainable codebase with powerful features (undo/redo, multi-vault) enabled by functional architecture.

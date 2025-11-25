# Test Quality Evaluation Results

Generated: 2025-11-25

## Scoring Legend
- **Badness** (0-30): Higher = worse (red flags)
- **Goodness** (-20 to 0): More negative = more valuable (green flags)
- **Net Score**: badness + goodness (lower = better)
  - < -10: High-value test, protect it
  - -10 to 0: Decent test, keep
  - 0 to 10: Marginal, candidate for reduction/deletion
  - > 10: Actively harmful, delete or rewrite
- **Reducibility**: (% removable, % value retained after reduction)

---

## ALL RESULTS SORTED BY NET SCORE (worst first)

### CANDIDATES FOR DELETION/REWRITE (net_score > 5)

| File | Net Score | Badness | Goodness | Reducibility | Comment |
|------|-----------|---------|----------|--------------|---------|
| loadGraphFromDisk-frontmatter-title.test.ts | **9** | 10 | -1 | (90%, 20%) | EXTREMELY WEAK. Doesn't test what it claims - checks title exists but never verifies it came from frontmatter. 90% redundant with main test. DELETE. |
| FloatingWindowFullscreen.test.ts | **6** | 11 | -5 | (40%, 70%) | Excessive mocking, tautological tests that just verify mocks were called. High implementation coupling. Rewrite to test behavior. |
| settings-cache.test.ts | **5** | 6 | -1 | (60%, 60%) | Tests trivial getters/setters. Tautological - testing JavaScript primitives not business logic. Reduce to single smoke test. |

### MARGINAL VALUE (net_score 0 to 5)

| File | Net Score | Badness | Goodness | Reducibility | Comment |
|------|-----------|---------|----------|--------------|---------|
| mapFSEventsToGraphDelta.test.ts | **1** | 8 | -7 | (50%, 85%) | Tests simple .md extension preservation 7 times with trivial variations. Reduce to 2-3 tests. |
| notifyTextToTreeServerOfDirectory.test.ts | **1** | 8 | -7 | (40%, 80%) | Over-tested retry logic. Redundant retry tests, tests implementation detail (5s interval). Consolidate. |
| graph-edge-operations.test.ts | **0** | 5 | -5 | (40%, 90%) | Simple edge operations with unnecessary immutability tests. Consolidate. |
| FloatingEditorManager.test.ts | **0** | 8 | -8 | (30%, 85%) | Moderate value, some redundancy. Keep core filter logic tests. |

### DECENT TESTS (net_score -10 to 0)

| File | Net Score | Badness | Goodness | Reducibility | Comment |
|------|-----------|---------|----------|--------------|---------|
| rpc-handler.test.ts | **-1** | 8 | -9 | (40%, 85%) | Boundary guardian for IPC. Consolidate redundant error tests. |
| graphToAscii.test.ts | **-1** | 6 | -7 | (40%, 90%) | Tests ASCII rendering. Redundant branching tests, consolidate. |
| VerticalMenuService.test.ts | **-1** | 7 | -8 | (25%, 80%) | Heavy mocking but tests important conditional menu behavior. |
| settings.test.ts | **-2** | 5 | -7 | (20%, 90%) | Tests filesystem persistence. Consolidate error tests. |
| applyPositions.test.ts | **-3** | 8 | -11 | (20%, 95%) | Complex positioning algorithm. Keep - guards complex logic despite some coupling. |
| filename-utils.test.ts | **-4** | 6 | -10 | (40%, 75%) | High redundancy in trivial string ops. Reduce. |
| BreathingAnimationService.test.ts | **-4** | 7 | -11 | (20%, 90%) | Good regression test for animation bug. Keep. |
| StyleService.test.ts | **-4** | 8 | -12 | (20%, 85%) | Critical theme override bug test. Keep. |
| getNodeIdsInTraversalOrder.test.ts | **-4** | 3 | -7 | (15%, 95%) | DFS traversal with good complexity coverage. Keep. |
| extract-linked-node-ids-alt.test.ts | **-5** | 5 | -10 | (30%, 85%) | ./prefix bug tests valuable. Merge with main file. |
| extract-title.test.ts | **-5** | 4 | -9 | (30%, 85%) | Simple regex. Some redundancy. Documents buggy behavior. |
| markdown-to-title.test.ts | **-5** | 6 | -11 | (35%, 85%) | High redundancy in quote handling tests. Consolidate. |
| build-config.test.ts | **-5** | 6 | -11 | (25%, 90%) | CRITICAL: Guards path resolution for dev/prod/packaged modes. Keep. |
| GraphNavigationService.test.ts | **-5** | 5 | -10 | (25%, 85%) | Complex cycling logic. Consolidate wrap-around tests. |
| spawnTerminalWithNewContextNode.test.ts | **-5** | 8 | -13 | (25%, 85%) | Heavy mocking but tests critical pipeline. Reduce timeout dependencies. |
| handleUIActions-with-filesystem.test.ts | **-5** | 11 | -16 | (15%, 90%) | Heavy mocking, tests real filesystem ops. Keep core tests. |
| fileWatching.test.ts | **-5** | 10 | -15 | (30%, 80%) | Timing fragile but tests critical file watching. Consolidate. |
| folder-loading.test.ts | **-5** | 9 | -14 | (35%, 75%) | Too comprehensive, split into focused tests. |
| extract-path-segments.test.ts | **-6** | 4 | -10 | (15%, 95%) | Good algorithm coverage. Minor redundancy. |
| graph-transformations.test.ts | **-6** | 3 | -9 | (20%, 95%) | Graph reversal algorithm. Keep. |
| handleUIActions.test.ts | **-6** | 5 | -11 | (30%, 80%) | Clean integration. Remove redundant label extraction test. |
| node_to_markdown.test.ts | **-6** | 5 | -11 | (35%, 85%) | Good round-trip tests. Consolidate frontmatter redundancy. |
| loadGraphFromDisk.test.ts | **-6** | 3 | -9 | (15%, 95%) | EXCELLENT. Core graph loading with real filesystem. Keep. |
| extract-linked-node-ids-with-labels.test.ts | **-7** | 6 | -13 | (40%, 80%) | Critical label extraction. Duplicate debugging tests - remove. |
| extract-linked-node-ids.test.ts | **-7** | 5 | -12 | (25%, 90%) | Path matching algorithm. Consolidate similar tests. |
| positioning-spacing.test.ts | **-7** | 2 | -9 | (0%, 100%) | EXCELLENT. Focused regression test, no mocking. Keep as-is. |
| CodeMirrorEditorView.test.ts | **-8** | 5 | -13 | (35%, 80%) | Thorough frontmatter parsing. Parameterize edge cases. |
| load-graph-from-disk.test.ts | **-8** | 3 | -11 | (0%, 100%) | Focused edge extraction test. Keep. |
| getSubgraphByDistance.test.ts | **-8** | 3 | -11 | (20%, 95%) | Complex weighted distance algorithm. Keep. |

### HIGH-VALUE TESTS (net_score < -10)

| File | Net Score | Badness | Goodness | Reducibility | Comment |
|------|-----------|---------|----------|--------------|---------|
| coordinate-conversions.test.ts | **-9** | 5 | -14 | (25%, 95%) | EXCELLENT. Critical coordinate math with exceptional regression test for window teleportation bug. |
| extract-edges-subfolder-bug.test.ts | **-9** | 3 | -12 | (0%, 100%) | EXCELLENT. Focused regression test for subfolder bug. Keep as-is. |
| applyGraphActionsToDB.test.ts | **-9** | 5 | -14 | (20%, 95%) | Critical boundary tests for filesystem effects. Keep. |
| applyGraphDeltaToUI.test.ts | **-10** | 3 | -13 | (20%, 90%) | Excellent UI integration with regression tests. Keep. |
| addNodeToGraph.test.ts | **-10** | 6 | -16 | (15%, 95%) | VERY HIGH VALUE. Order-independent graph construction tests. |
| extract-frontmatter.test.ts | **-11** | 4 | -15 | (20%, 90%) | Strong YAML parsing coverage. Minor consolidation possible. |
| parse-markdown-to-node.test.ts | **-11** | 5 | -16 | (25%, 85%) | Key integration point. Excellent documentation value. |
| applyGraphDeltaToDB.test.ts | **-11** | 2 | -13 | (20%, 90%) | MODEL integration test. Real filesystem, no mocks. Keep. |
| useTranscriptionSender.test.ts | **-12** | 3 | -15 | (15%, 90%) | EXEMPLARY. Tests complex stateful logic via behavior, not implementation. |
| createContextNode.test.ts | **-12** | 5 | -17 | (25%, 85%) | Comprehensive. Excellent regression test for edge bug. |
| edge-labels-full-pipeline.test.ts | **-15** | 1 | -16 | (10%, 95%) | EXCEPTIONAL. Full E2E pipeline test, zero mocking, caught real production bug. |

---

## SUMMARY BY CATEGORY

### Tests to DELETE or REWRITE (3 files)
1. `loadGraphFromDisk-frontmatter-title.test.ts` - Doesn't test what it claims
2. `FloatingWindowFullscreen.test.ts` - Tautological mock verification
3. `settings-cache.test.ts` - Tests JavaScript primitives

### Tests to SIGNIFICANTLY REDUCE (5 files, ~40-50% reduction)
1. `mapFSEventsToGraphDelta.test.ts` - 7 tests for same thing
2. `graph-edge-operations.test.ts` - Remove immutability tests
3. `filename-utils.test.ts` - Redundant string tests
4. `graphToAscii.test.ts` - Redundant branching tests
5. `extract-linked-node-ids-with-labels.test.ts` - Duplicate debugging tests

### Tests to CONSOLIDATE (8 files, ~25-35% reduction)
1. `extract-linked-node-ids-alt.test.ts` - Merge with main file
2. `markdown-to-title.test.ts` - Quote handling variations
3. `node_to_markdown.test.ts` - Frontmatter redundancy
4. `CodeMirrorEditorView.test.ts` - Parameterize edge cases
5. `folder-loading.test.ts` - Split into focused tests
6. `fileWatching.test.ts` - Consolidate .md extension tests
7. `rpc-handler.test.ts` - Consolidate error tests
8. `notifyTextToTreeServerOfDirectory.test.ts` - Consolidate retry tests

### EXEMPLARY Tests to PROTECT (5 files)
1. `edge-labels-full-pipeline.test.ts` - Perfect E2E test
2. `useTranscriptionSender.test.ts` - Exemplary behavioral testing
3. `positioning-spacing.test.ts` - Focused regression test
4. `extract-edges-subfolder-bug.test.ts` - Clean regression test
5. `coordinate-conversions.test.ts` - Critical math with regression coverage

---

## ESTIMATED IMPACT

- **Files to delete/rewrite**: 3 files
- **Significant reduction**: ~200-300 lines removable
- **Consolidation**: ~400-500 lines removable
- **Total reduction**: ~15-20% of test LOC
- **Value retained**: ~90%+

## KEY PATTERNS IDENTIFIED

**What makes tests valuable:**
- Zero or minimal mocking
- Tests behavior, not implementation
- Documents real production bugs
- Guards complex algorithms
- Full pipeline/integration tests

**What makes tests harmful:**
- Verifying mocks were called (tautological)
- Testing language primitives (getters/setters)
- Heavy implementation coupling
- Redundant edge case variations
- Testing same behavior multiple ways

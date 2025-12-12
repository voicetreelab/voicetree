# Test Quality Evaluation Results

Generated: 2025-12-09

## Summary

- **Total tests evaluated**: 57
- **High-value tests (< -10)**: 24
- **Decent tests (-10 to 0)**: 28
- **Marginal tests (0 to 10)**: 4
- **Harmful tests (> 10)**: 1

---

## Tests Sorted by Net Score (Worst First)

### HARMFUL (net_score > 10) - DELETE OR REWRITE

| File | Net Score | Comment |
|------|-----------|---------|
| `src/pure/graph/markdown-parsing/filename-utils.test.ts` | **15** | Tautological tests for identity functions that literally return input unchanged. The production code is `return filename` and `return nodeId.includes('.md') ? nodeId : nodeId + '.md'`, yet tests exhaustively verify this trivial behavior. Completely tautological and actively harmful. |

### MARGINAL (net_score 0-10) - CANDIDATES FOR REDUCTION/DELETION

| File | Net Score | Comment |
|------|-----------|---------|
| `src/shell/edge/main/edge-auto-rpc/rpc-handler.test.ts` | **6** | Heavy mocking of both electron IPC and mainAPI makes this fragile. Tests implementation details like mock.calls extraction. Several tests verify trivial behavior (argument passing, return value types) that should be caught by TypeScript. |
| `src/shell/UI/cytoscape-graph-ui/services/VerticalMenuService.test.ts` | **4** | Heavy mocking of ctxmenu library and fragile coupling to menu HTML structure. Brittle string matching ('Delete Selected', '0 nodes selected') makes tests break on UI copy changes. |
| `src/shell/edge/main/graph/integration-tests/load-graph-from-disk.test.ts` | **1** | Highly redundant with the other loadGraphFromDisk test. Uses hardcoded external vault path that may not exist. Single test case adds minimal value. Strong candidate for deletion. |
| `src/shell/edge/main/state/settings-cache.test.ts` | **0** | Tests trivial getter/setter/clear operations on a simple cache variable. No complex logic, no edge cases. Could be replaced with a single smoke test. Borderline tautological. |

### DECENT (net_score -10 to 0) - KEEP

| File | Net Score | Reducibility | Comment |
|------|-----------|--------------|---------|
| `src/pure/graph/graph-operations/graph-edge-operations.test.ts` | -1 | 40%, 70% | Simple tests for trivial edge operations. Somewhat tautological but provides documentation value. |
| `src/shell/edge/UI-edge/graph/integration-tests/handleUIActions.test.ts` | -2 | 35%, 80% | Tests UI actions with mocked electronAPI. Some redundancy testing positioning and label extraction separately. |
| `src/shell/UI/cytoscape-graph-ui/services/StyleService.test.ts` | -2 | 20%, 80% | Tests theme detection logic. Guards regression in dark/light mode text color. |
| `src/shell/edge/UI-edge/floating-windows/terminals/integration-tests/spawnTerminalWithNewContextNode.test.ts` | -3 | 30%, 85% | Tests delegation to main process for terminal spawning. Heavy mocking but tests important boundary logic. |
| `src/pure/graph/markdown-writing/graphToAscii.test.ts` | -3 | 35%, 70% | Tests ASCII tree visualization. Could be more focused with snapshot testing. |
| `src/pure/graph/markdown-parsing/extract-linked-node-ids-alt.test.ts` | -4 | 40%, 70% | Tests wikilink resolution edge cases. Has redundancy but documents specific bug reproductions. |
| `src/shell/UI/floating-windows/FloatingWindowFullscreen.test.ts` | -4 | 10%, 85% | Tests browser Fullscreen API integration. Guards boundary with browser. Mocking reduces value. |
| `src/pure/graph/recentNodeHistoryV2.test.ts` | -4 | 25%, 80% | Tests recent node history tracking with filtering logic. Moderate value. |
| `src/shell/edge/UI-edge/graph/navigation/GraphNavigationService.test.ts` | -5 | 20%, 85% | Tests complex terminal cycling with state management. Some redundancy in cycling direction tests. |
| `src/pure/graph/positioning/applyPositions.test.ts` | -5 | 15%, 85% | Tests complex graph layout algorithm. Includes extensive edge overlap detection helpers. |
| `src/pure/graph/graph-operations/merge/redirectEdgeTarget.test.ts` | -5 | 25%, 85% | Straightforward pure function test. Some redundancy in preserving properties tests. |
| `src/pure/graph/mapFSEventsToGraphDelta.test.ts` | -5 | 20%, 85% | Tests filesystem event to graph delta mapping. Protects boundary layer. |
| `src/pure/graph/graph-operations/traversal/getNodeIdsInTraversalOrder.test.ts` | -6 | 10%, 90% | Clean tests for depth-first traversal with cycle handling. Good coverage of edge cases. |
| `src/pure/graph/graph-operations/graph-transformations.test.ts` | -6 | 20%, 85% | Tests graph edge reversal with cycles, diamonds. Documents non-obvious behavior. |
| `src/pure/graph/applyGraphActionsToDB.test.ts` | -6 | 30%, 75% | Integration tests for filesystem write effects. High boundary guardian value. |
| `src/shell/edge/UI-edge/graph/integration-tests/handleUIActions-with-filesystem.test.ts` | -7 | 25%, 85% | Comprehensive end-to-end test with real filesystem. High value despite complexity. |
| `src/shell/edge/main/graph/markdownReadWritePaths/readAndApplyDBEventsPath/notifyTextToTreeServerOfDirectory.test.ts` | -7 | 0%, 100% | Tests critical retry logic for backend notification. Guards against integration failures. |
| `src/shell/edge/main/graph/integration-tests/saveNodePositions.test.ts` | -7 | 20%, 85% | Tests position persistence through in-memory state and filesystem round-trips. |
| `src/shell/UI/floating-windows/editors/CodeMirrorEditorView.test.ts` | -7 | 30%, 75% | Extensive frontmatter parsing tests. Contains valuable regression tests but ~30% could be consolidated. |
| `src/shell/UI/cytoscape-graph-ui/services/BreathingAnimationService.test.ts` | -8 | 15%, 90% | Tests complex state machine with timers. Guards critical animation behavior. |
| `src/pure/graph/positioning/coordinate-conversions.test.ts` | -8 | 20%, 90% | Tests critical coordinate conversion math. Strong value for protecting geometry calculations. |
| `src/pure/graph/graph-operations/traversal/getSubgraphByDistance.test.ts` | -8 | 15%, 90% | Thorough tests for weighted distance algorithm. Excellent documentation value. |
| `src/pure/graph/markdown-writing/node_to_markdown.test.ts` | -8 | 30%, 75% | Tests bidirectional markdown serialization. Documents important serialization boundary. |
| `src/pure/graph/markdown-parsing/markdown-to-title.test.ts` | -9 | 20%, 85% | Tests title extraction priority logic. Documents markdown-as-truth principle. |
| `src/pure/graph/markdown-parsing/extract-linked-node-ids-with-labels.test.ts` | -9 | 25%, 80% | Integration tests for relationship label extraction. High value for edge labeling behavior. |
| `src/pure/graph/graph-operations/merge/createRepresentativeNode.test.ts` | -9 | 20%, 90% | Strong test for complex merge node creation including centroid calculation. |
| `src/shell/edge/UI-edge/graph/integration-tests/positioning-spacing.test.ts` | -9 | 20%, 90% | Excellent regression test for positioning bugs with real fixture data. |

### HIGH-VALUE (net_score < -10) - PROTECT

| File | Net Score | Reducibility | Comment |
|------|-----------|--------------|---------|
| `src/pure/graph/markdown-parsing/extract-edges-subfolder-bug.test.ts` | -10 | 30%, 85% | Focused regression test for subfolder path matching bug. Very clear purpose and high value. |
| `src/pure/graph/markdown-parsing/extract-path-segments.test.ts` | -10 | 15%, 90% | Tests path parsing and matching algorithm. High value for complex path matching logic. |
| `src/pure/graph/markdown-parsing/extract-linked-node-ids.test.ts` | -10 | 20%, 85% | Comprehensive tests for wikilink extraction. Tests critical markdown parsing boundary logic. |
| `src/pure/graph/graphDelta/deleteNodeEdgePreservation.test.ts` | -10 | 15%, 90% | Tests critical edge preservation on node deletion. High regression protection value. |
| `src/pure/graph/undo/undoStack.test.ts` | -10 | 15%, 90% | Solid test for undo/redo stack management. Stack overflow and redo clearing behaviors are critical. |
| `src/shell/edge/UI-edge/text_to_tree_server_communication/useTranscriptionSender.test.ts` | -10 | 10%, 95% | High-value behavioral tests for incremental token sending. Excellent test design. |
| `src/shell/edge/main/graph/integration-tests/fileWatching.test.ts` | -10 | 15%, 90% | Critical test for file watching and wikilink edge management. Guards essential filesystem sync. |
| `src/shell/edge/main/graph/integration-tests/folder-loading.test.ts` | -10 | 25%, 85% | Comprehensive folder loading test. Includes regression test for malformed YAML handling. |
| `src/pure/graph/graphDelta/addNodeToGraph.test.ts` | -11 | 25%, 80% | Integration tests for progressive edge validation. High value for preventing edge resolution regressions. |
| `src/pure/graph/markdown-parsing/parse-markdown-to-node.test.ts` | -11 | 25%, 80% | Tests critical markdown-to-node parsing. High value for system boundary parsing logic. |
| `src/shell/edge/main/settings/settings.test.ts` | -11 | 10%, 95% | Clean integration test using real filesystem. Guards user data persistence. |
| `src/pure/settings/resolveEnvVars.test.ts` | -11 | 10%, 90% | Clean pure function tests. Good documentation of environment variable resolution behavior. |
| `src/pure/graph/graph-operations/merge/getIncomingEdgesToSubgraph.test.ts` | -12 | 10%, 95% | Excellent pure function test. Minimal redundancy, tests critical graph traversal logic. |
| `src/pure/graph/graph-operations/merge/findRepresentativeNode.test.ts` | -12 | 10%, 95% | High-value test for complex graph traversal algorithm finding node with most reachable descendants. |
| `src/shell/edge/main/electron/build-config.test.ts` | -13 | 15%, 90% | Excellent test for complex multi-mode path configuration. Guards against deployment bugs. |
| `src/shell/edge/main/mcp-server/integration-tests/getUnseenNodesAroundContextNode.test.ts` | -13 | 15%, 90% | Tests MCP tool for detecting new nodes. Minimal mocking, high value. |
| `src/pure/graph/graph-operations/merge/computeMergeGraphDelta.test.ts` | -14 | 15%, 92% | Critical orchestrator test covering merge delta computation. Protects against regression in merge workflow. |
| `src/pure/graph/graph-operations/merge/integration-tests/merge-integration.test.ts` | -14 | 20%, 88% | Excellent integration test verifying full merge flow. Valuable for catching interaction bugs. |
| `src/pure/graph/undo/reverseDelta.test.ts` | -14 | 10%, 95% | High-value test for critical undo/redo logic. Thoroughly tests bidirectional delta reversal. |
| `src/shell/edge/main/graph/integration-tests/createContextNode.test.ts` | -14 | 20%, 90% | Outstanding integration test. Includes critical regression test for edge count bug. |
| `src/shell/edge/main/graph/integration-tests/edge-labels-full-pipeline.test.ts` | -16 | 10%, 95% | Exceptional full-pipeline test. Zero mocks, tests real user scenario. Perfect example of integration test value. |
| `src/shell/edge/UI-edge/graph/integration-tests/applyGraphDeltaToUI.test.ts` | -17 | 5%, 98% | Exceptional integration test. No mocks, tests complete graph delta with real Cytoscape. Excellent example. |
| `src/shell/edge/main/state/recent-writes-store.test.ts` | -18 | 0%, 100% | Exceptional test suite. Guards critical FS event deduplication logic. Pure unit test. |
| `src/shell/edge/main/graph/integration-tests/applyGraphDeltaToDB.test.ts` | -18 | 10%, 95% | Excellent integration test with zero mocks, testing full write path. |
| `src/shell/edge/main/graph/markdownReadWritePaths/readAndApplyDBEventsPath/loadGraphFromDisk.test.ts` | -19 | 10%, 95% | Comprehensive integration test covering full graph loading pipeline. Zero mocks, excellent documentation value. |

---

## Action Items

### Immediate Actions (Score > -5)

1. **DELETE**: `filename-utils.test.ts` (score: 15) - Tautological, tests identity functions
2. **REWRITE OR DELETE**: `rpc-handler.test.ts` (score: 6) - Over-mocked, tests implementation details
3. **REDUCE**: `VerticalMenuService.test.ts` (score: 4) - Fragile string matching, heavy mocking
4. **DELETE**: `load-graph-from-disk.test.ts` (score: 1) - Redundant with other test
5. **REDUCE**: `settings-cache.test.ts` (score: 0) - Replace with single smoke test

### Reduction Candidates (High reducibility with >80% value retained)

| File | Reduction | Value Retained |
|------|-----------|----------------|
| `filename-utils.test.ts` | 85% | 15% |
| `settings-cache.test.ts` | 70% | 40% |
| `graph-edge-operations.test.ts` | 40% | 70% |
| `extract-linked-node-ids-alt.test.ts` | 40% | 70% |
| `handleUIActions.test.ts` | 35% | 80% |
| `graphToAscii.test.ts` | 35% | 70% |
| `CodeMirrorEditorView.test.ts` | 30% | 75% |
| `node_to_markdown.test.ts` | 30% | 75% |
| `applyGraphActionsToDB.test.ts` | 30% | 75% |
| `spawnTerminalWithNewContextNode.test.ts` | 30% | 85% |

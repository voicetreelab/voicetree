## 1. Projection-derived hidden set

- [ ] 1.1 Add a pure helper `selectHiddenByCollapseNodeIds(projectedGraph, fullGraphNodes)` (or expose existing equivalent) in `packages/libraries/graph-state` that returns the set of context-node ids present in `state.graph.nodes` but absent from the projection — i.e. `hiddenByCollapse: true`. Distinguishes from "node truly deleted" (absent from both).
- [ ] 1.2 Unit-test the helper against fixtures with: (a) no collapse, (b) single collapsed folder, (c) nested collapsed folders, (d) node deleted vs node collapsed.

## 2. Floating-window visibility sync helper (UI edge)

- [ ] 2.1 Add `syncFloatingTerminalVisibilityFromProjection(projectedGraph)` under `webapp/src/shell/edge/UI-edge/floating-windows/terminals/`. For each terminal in `TerminalStore`, look up `attachedToContextNodeId` against the hidden-by-collapse set from 1.1 and toggle the floating window root element's `display`.
- [ ] 2.2 Preserve prior minimized state: if `isMinimized` was true before hide, restore-on-expand keeps the minimized badge; otherwise restore the floating window itself.
- [ ] 2.3 On show-from-hidden, re-resolve anchor position (call existing reposition path) before unhiding to avoid stale position glitches.
- [ ] 2.4 Black-box test: given a `TerminalStore` and a synthetic projection, observe `display` style toggling on a real DOM element across collapse → expand cycles. No mocks of internal calls; assert on observable DOM state.

## 3. Hook the sync into folderCollapse.ts

- [ ] 3.1 In `webapp/src/shell/edge/UI-edge/graph/view/folderCollapse.ts`, immediately after each `applyGraphDeltaToUI(cy, projectedGraph)` call, invoke `syncFloatingTerminalVisibilityFromProjection(projectedGraph)` in the same synchronous call frame.
- [ ] 3.2 Verify all call sites of `applyGraphDeltaToUI` that can be triggered by a collapse change route through this — search for direct callers and either route them through `folderCollapse.ts` or have them invoke the sync helper themselves.
- [ ] 3.3 Black-box test: trigger a folder collapse via the UI-edge API, assert that the cytoscape node and the floating window both update in the same frame (no flicker scenario, design risk #1).

## 4. Sidebar click auto-expands collapsed ancestors

- [ ] 4.1 In `TerminalTreeSidebar.tsx`'s `handleSelect`, before calling `restoreTerminal` / `onNavigate`, check whether `terminal.attachedToContextNodeId` is in the current hidden-by-collapse set.
- [ ] 4.2 If hidden: compute the minimal chain of collapsed ancestor folder ids whose expansion would un-hide the anchor. Dispatch a single `setFolderStateBatch(...)` (or sequential `setFolderState` calls if batch unavailable) to expand them, then proceed with the normal activation flow.
- [ ] 4.3 Black-box test: with anchor inside two collapsed folders, simulate sidebar row click, assert both folders are expanded and the floating window's `display` is restored.

## 5. Anchor-deleted path is untouched

- [ ] 5.1 Verify (and add a regression test if missing) that deletion of a context node from `state.graph.nodes` still closes its terminals via the existing close path, and is *not* treated as a hide. Use the helper from 1.1 to confirm the deleted node id appears in neither the projection nor `state.graph.nodes`.

## 6. Cleanup and docs

- [ ] 6.1 Update any inline comment in `folderCollapse.ts` describing the order of operations so future readers see the visibility-sync step.
- [ ] 6.2 Run `npm run test` and ensure no regressions in graph-state, UI-edge, or floating-window suites.
- [ ] 6.3 Manual smoke (Playwright or local Electron): collapse a folder containing an active floating terminal, observe window disappears; expand, observe window returns with same position; click sidebar row while collapsed, observe folder auto-expands.

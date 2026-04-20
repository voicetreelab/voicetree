## 1. Phase FA — Algorithm + rendering (FA-100..FA-103, unblocked)

- [ ] 1.1 FA-100 — Author fixture vault at `packages/graph-tools/fixtures/folder-aware-fixture/` per design.md layout (13 nodes across 3 folders + root)
- [ ] 1.2 FA-101 — Add folder-alignment scoring in `collapseBoundary.ts`: derive `alignedFolderPath` on each candidate; apply `+0.05` cohesion bonus to folder-aligned louvain candidates in `compareCandidates`; use `GraphNode.kind === 'folder'` as folder predicate in `buildFolderCandidates`
- [x] 1.3 FA-102 — Add `pinnedFolderIds?: readonly string[]` to `AutoViewOptions`; implement pre-pass in `autoView.ts` that injects pinned folders as already-selected clusters before `findCollapseBoundary`; exclude pinned nodes from all other candidate pools
- [x] 1.4 FA-103 — Change `formatCollapsedSummary` in `autoView.ts` to emit folder basename + trailing slash when `alignedFolderPath` is set; implement sibling-collision disambiguation (`parent/basename/` form)
- [x] 1.5 Vitest: pure unit coverage — scoring bonus behaviour, pre-pass correctness, label disambiguation (3 test files, ≥15 assertions total)

## 2. Phase FB — CLI + verifier (FA-104..FA-107, gated)

- [ ] 2.1 FA-104 — Wire `--from-session <sessionId>` flag into `bin/vt-graph.ts` (gated on decouple-ui-from-graph-server P6)
- [ ] 2.2 FA-104 — Wire `GraphDbClient.getSessionState(sessionId)` → extract collapseSet → filter to `kind === 'folder'` → pass as `pinnedFolderIds` (gated on decouple-ui-from-graph-server P5)
- [ ] 2.3 FA-104 — Non-folder-id warnings to stderr; fail loudly if daemon unreachable (no silent fallback)
- [ ] 2.4 FA-105 — Author the CLI-driven verifier agent: Sonnet/Codex headless dB=0 leaf with scripted Verification block; asserts on ASCII output of `vt view render --auto` against the fixture (gated on FA-104 complete)
- [ ] 2.5 FA-106 — Budget-overrun fallback test: extend fixture vault with an oversized folder OR add a second fixture; assert intra-folder subdivision preserves folder label on remnant
- [ ] 2.6 FA-107 — Integration test against a live daemon: spawn `vt-graphd` in test, mount fixture, POST collapseSet to session, render, assert (gated on decouple-ui-from-graph-server P5)

## 3. Phase FC — Validation + archive

- [ ] 3.1 `openspec validate folder-aware-community-view --strict` passes (done at change-authoring time; re-verify after any spec edit)
- [ ] 3.2 Forward-link from `decouple-ui-from-graph-server` kanban confirmed (done at change-authoring time)
- [ ] 3.3 On FA-100..FA-103 completion: commit `feat(graph-tools): folder-aware community view (FA-100..103)` and mark FA-100..FA-103 done on kanban
- [ ] 3.4 On FA-104..FA-107 completion (post-gate): commit `feat(graph-tools): folder-aware community view — session pinning (FA-104..107)` and mark FA-104..FA-107 done
- [ ] 3.5 `openspec archive folder-aware-community-view` once all FA-cards are done and the change has shipped a stable release cycle

## 4. Coordination

- [ ] 4.1 Confirm `unified-folder-file-nodes` Wave B is fully shipped (`GraphNode.kind === 'folder'` available end-to-end) before FA-101 lands — per Leo's kanban this is `3b645780`
- [ ] 4.2 Subscribe to `decouple-ui-from-graph-server` kanban — trigger FA-104 kickoff when P5 (GraphDbClient) AND P6 (`vt view` CLI conventions) both mark Done
- [ ] 4.3 Re-use the BF-210 Verification-block template (see `brain/working-memory/tasks/decouple-ui-from-graph-server/BF-210-daemon-skeleton.md`) for every FA-card's Verification section
- [ ] 4.4 Announce FA-105's verifier as an optional INT-1 harness add-on: flow F9-folder-aware could run alongside F1..F8 post-Leo-gates

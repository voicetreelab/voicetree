## Why

`vt graph view --auto` already collapses subgraphs when visible-entity count exceeds budget — but its two candidate strategies (`folder-first` by folder-path prefix, `louvain` by community detection) treat folders as a structural hint, not as first-class graph entities. Post-Wave-B (`unified-folder-file-nodes` shipped; `GraphNode.kind === 'folder'` is a first-class type), the algorithm can do better: when a detected community *aligns* with a folder subtree, the collapsed summary should carry the **folder's basename** as its label (users recognise `projects/` faster than `cluster-7`), and any folder a **session has explicitly pinned closed** should be locked collapsed regardless of budget.

Today's UX gap, from `leo-vt-cli-vs-ui-state-parity-discovery.md`: the UI can read a session's collapseSet via `FolderTreeStore`, but `vt graph view --auto` is a CLI-only command that has no session — it re-runs community detection from scratch every invocation and discards any user collapse intent. Once `decouple-ui-from-graph-server` P5 (GraphDbClient) + P6 (`vt view` CLI) land, the CLI can pin to a session and honour its collapseSet; this change is the algorithmic + CLI-surface work that makes that pin meaningful.

## What Changes

- **Folder-alignment scoring in `collapseBoundary.ts`.** When a candidate collapse cluster is a subset of some folder's descendant set, score it above an equivalent-size non-aligned louvain cluster. Folder candidates already exist (`buildFolderCandidates`); this change adds a ranking bonus and a per-candidate "aligned folder" tag used later for labelling.
- **Session-pin pre-pass in `autoView.ts`.** Before budget allocation, fold a session's collapseSet into the selected clusters. Pinned folders occupy budget slots as `kind === 'folder'` cluster summaries and SHALL NOT be eligible for expansion by the auto-budget pass.
- **ASCII renderer label change.** `formatCollapsedSummary` SHALL emit the folder's basename (`▢ projects/ [collapsed: 12 nodes, …]`) when the cluster is folder-aligned, instead of the synthetic `cluster-N` / representative-title fallback.
- **New `--from-session <sessionId>` flag on `vt graph view`.** Gated on Leo P6: when present, the CLI fetches the session's collapseSet via `GraphDbClient` and passes it to the algorithm as the pinned set. Without the flag, current behaviour is unchanged.
- **CLI-driven verifier agent (dogfood pattern).** A Sonnet/Codex leaf drives `vt view render --auto --budget=N --from-session=X` against a fixture vault with known folder + link topology and asserts the ASCII output invariants. Doubles as integration test for `view-session` + `cli-vault-control` capabilities.
- **BREAKING for internal callers only**: callers that parse `▢ cluster-N` from `--auto` output (there are none today, but the synthetic label is technically observable) should switch to folder-basename matching. No public API changes.

### Capabilities

#### New Capabilities

- `folder-aware-community-view`: algorithm- and rendering-level awareness that folders are first-class GraphNodes with graph-aligned collapse semantics. Folder-aligned collapse clusters are preferred and labelled by basename; session-pinned folders are pre-folded into the collapse set and locked; budget overrun falls back to intra-folder community detection with the folder label preserved on the visible remnant.

#### Modified Capabilities

None. The existing `folder-as-node` and `folder-collapse` requirements (owned by `unified-folder-file-nodes`) keep their semantics — this change only strengthens the selection and rendering of their outputs in the `--auto` view.

## Impact

- **Modified**: `packages/graph-tools/src/collapseBoundary.ts` — add folder-alignment scoring bonus in `compareCandidates`; add `alignedFolderPath?: string` to `CollapseCluster`.
- **Modified**: `packages/graph-tools/src/autoView.ts` — session-pin pre-pass before `findCollapseBoundary`; pass pinned cluster set through to rendering.
- **Modified**: `packages/graph-tools/bin/vt-graph.ts` — new `--from-session <id>` flag wired through to `renderAutoView`.
- **New**: `packages/graph-tools/fixtures/folder-aware-fixture/` — deterministic fixture vault with 3-level folder hierarchy + known cross-folder link topology for the verifier.
- **New**: `packages/graph-tools/tests/collapseBoundary.folder-aware.test.ts` — unit tests for scoring + pinning.
- **New**: `brain/working-memory/tasks/folder-aware-community-view/` — epic kanban (FA-100..FA-107).
- **Soft-blocked on**: `decouple-ui-from-graph-server` P5 (GraphDbClient for session fetch) + P6 (CLI session pinning conventions). FA-100..FA-103 are independent of the gate; FA-104..FA-107 are blocked until both P5 and P6 ship.
- **Coordination**: `unified-folder-file-nodes` must be fully shipped — this change consumes `GraphNode.kind === 'folder'` as the folder predicate, so the Wave B contract must be stable before FA-101 lands. (Confirmed `unified-folder-file-nodes/design.md` Wave B5 landed as `3b645780` per Leo's kanban.)
- **No persistence change**: session collapseSet is fetched at render-time, not cached by the CLI; matches `view-session` RAM-only model.

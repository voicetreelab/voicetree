## Context

`packages/graph-tools/src/collapseBoundary.ts` already has two strategies:

1. `buildFolderCandidates(graph)` — for every folder path with ≥2 descendants that is not protected and not >90% of the graph, emit a candidate cluster with `strategy: 'folder-first'`, `label: "<folderPath>/"`, `anchorFolderPath: <parent>`.
2. `buildLouvainCandidates(graph)` — detect communities via Louvain modularity optimisation; emit a candidate with `strategy: 'louvain'`, `label: representative.title || "cluster-N"`.

`findCollapseBoundary` runs folder-first greedy selection first; falls back to louvain only when folder-first does not fit the budget. Selection inside each strategy sorts candidates by `(cohesion desc, size desc, internalEdgeCount desc, sortLabel asc)`.

This change leaves the skeleton intact and adds three discrete modifications:

- **Scoring**: a folder-alignment *bonus* on louvain candidates whose node-set is a subset of some folder's descendants (so the louvain strategy does not under-rank folder-aligned communities against ad-hoc ones).
- **Pinning**: a pre-pass that injects session-pinned folders as already-selected clusters *before* the greedy loop, so they occupy budget permanently and cannot be un-selected.
- **Labelling**: when a cluster is folder-aligned (either from `buildFolderCandidates` or from the scoring bonus above), the ASCII summary uses the folder's basename — not the synthetic cluster id, not the louvain representative title.

Post-Wave-B, `GraphNode.kind === 'folder'` is the authoritative folder predicate. Before Wave B, `folderPath` string-prefix was the only signal — this change assumes `unified-folder-file-nodes` B5 has landed (confirmed in Leo's kanban).

Constraints to respect:

- **No new `--auto` sub-flag for folder-awareness**: the behaviour is always on post-Wave-B. `--from-session` is the only new flag (for pinning).
- **No session-fetch inside `packages/graph-tools`**: the `graph-tools` package stays pure (no HTTP deps). The CLI layer (`bin/vt-graph.ts`) fetches and passes the collapseSet in. This matches the Leo-epic invariant: `@vt/graph-tools` depends on `@vt/graph-model` + `@vt/graph-state` as pure libraries, not on `@vt/graph-db-client`.
- **Verifier is CLI-driven, not unit-only**: per the ayu-orchestration-prompt-diff integration-cascading principle — a unit test that passes but the downstream CLI output is wrong is a weak signal. The verifier drives the real CLI against a real fixture vault.

## Goals / Non-Goals

**Goals:**

- `vt graph view --auto` prefers folder boundaries when a detected community aligns with a folder subtree, producing ASCII summaries labelled by folder basename.
- `vt graph view --auto --from-session <id>` (gated on Leo P6) honours the session's collapseSet: pinned folders are always collapsed, never expanded by the budget heuristic.
- Budget overrun on an oversized folder falls back gracefully: the folder is subdivided by intra-folder community detection, and the remaining visible nodes retain their folder label.
- Algorithm + CLI surface are independently testable: pure unit tests for scoring and pinning; a CLI-driven verifier agent that executes the real binary against a real fixture.

**Non-Goals:**

- Changing the budget heuristic itself (`DEFAULT_BUDGET=30`, the entity-count formula, the `isOversizedCluster` 90% cutoff). Out of scope.
- Persisting collapseSet across sessions. RAM-only per `view-session` capability.
- Exposing session awareness to the Louvain step for graph-level partitioning (e.g. running Louvain only over expanded nodes). Deferred — current design applies pinning *after* candidate generation.
- Multiple-session composition (`--from-session=a --from-session=b` union). Single session per invocation.

## Decisions

1. **Decision: Score folder-aligned cuts higher than ad-hoc community cuts.**
   Rationale: a folder basename like `projects/` is immediately meaningful to a user; a synthetic `cluster-7` label requires the reader to open the cluster to understand it. Cohesion is similar in both cases for well-structured vaults, so the current tiebreak already usually favours folders — but the louvain fallback can still pick a non-aligned cut when folder candidates fail to fit budget. This decision promotes folder-aligned louvain candidates *within* the louvain selection pass, not across strategies.
   Mechanism: in `compareCandidates`, after `cohesion` tiebreak, apply a bonus of `+0.05` to the effective cohesion of any candidate whose `nodeIds` are a strict subset of some folder's descendant set (i.e. `alignedFolderPath` is populated). Capped to prevent flipping clusters with meaningfully higher cohesion — the bonus is a tiebreaker, not a hammer.
   Alternative rejected: always prefer folder candidates even when oversized. Rejected because the current `isOversizedCluster` + greedy fallback logic already handles the "folder too big" case correctly; a hard preference would reintroduce the very budget-overrun cases we'd then need to patch.

2. **Decision: Session collapseSet folders are LOCKED closed; auto-budget never expands them.**
   Rationale: user intent dominates auto-heuristic. If a user pinned `archive/` closed, re-rendering at a different budget must never silently re-open it. The pin is a *constraint*, not a *preference*.
   Mechanism: `AutoViewOptions` gains `pinnedFolderIds?: readonly string[]`. Before `findCollapseBoundary` runs, a new pre-pass constructs a fake `Candidate` for each pinned folder (strategy `'folder-first'`, forced-selected, full descendant set), adds those node-ids to `selectedNodeIds`, and pre-reduces `entityCount`. The greedy loop then runs over the remaining budget. A pinned folder's descendants are excluded from the candidate pool for other candidates (via an already-selected set).
   Alternative rejected: allow auto to override pinned folders when budget is tight (e.g. expand `archive/` if it means showing 5 more visible nodes). Breaks user expectation of "pinned = sticky"; explicit override is an intentional unpin, not a side-effect of raising `--budget`.

3. **Decision: Folder predicate is `GraphNode.kind === 'folder'` (post-Wave-B).**
   Rationale: single source of truth. Wave B's `unified-folder-file-nodes` makes `GraphNode.kind` the authoritative type. Before Wave B, `folderPath` string parsing was the only available signal — fragile under any folder-rename flow. Post-Wave-B, the type system carries the signal end-to-end.
   Mechanism: `collapseBoundary.ts` receives `CollapseBoundaryNode`s that carry a derived `kind` field (sourced by `autoView.ts` from the post-Wave-B `GraphNode`). Folder-aligned subset detection iterates folder nodes and gathers their descendants via the existing `folderPath`-prefix walk (cheap, already used).
   Alternative rejected: path-ends-in-slash heuristic. Fragile to any future normalisation pass that strips trailing slashes; mixes rendering convention with semantic type.

4. **Decision: Verification is a CLI-driven verifier agent (dogfood pattern), not a pure unit test.**
   Rationale: per the ayu-orchestration-prompt-diff integration-cascading meta — "agent actually using the CLI it modified/created to try it out" produces a stronger signal than "unit test of pure function." A pure unit test can pass while the CLI wire-up is broken (flag not threaded, session fetch using stale port, ASCII renderer regresses). The verifier runs `vt view render --auto --budget=N --from-session=X` against a real fixture vault and asserts on the real ASCII output.
   Mechanism: FA-105 — a Sonnet-or-Codex leaf (headless, dB=0) with a scripted Verification block. The verifier consumes three capability edges: `vt view` (`cli-vault-control`), `/sessions/:id/state` (`view-session`), and `--from-session` (this change). A regression in any of the three fails the verifier.
   Alternative rejected: pure unit test alone. Still written (FA-101 + FA-102 ship with vitest coverage for the scoring and pre-pass functions), but the *gating* verification is the CLI integration.

5. **Decision: Fixture vault has known folder hierarchy + known cross-folder link topology.**
   Rationale: deterministic ASCII assertions. The test fixture contains fixed filenames, fixed folder layout, and a hand-crafted edge set that exercises: (a) folder-aligned cluster, (b) non-aligned louvain cluster, (c) folder-oversized-budget fallback, (d) session-pinned folder.
   Fixture layout (specified here so FA-100 has nothing to decide):
   ```
   fixtures/folder-aware-fixture/
     root-note.md                    ← links: projects/a, archive/old-1
     projects/
       index.md                      ← links: projects/a, projects/b, projects/c
       a.md                          ← links: b, c, archive/old-1
       b.md                          ← links: a, c
       c.md                          ← links: a, b
     archive/
       index.md                      ← links: old-1, old-2, old-3
       old-1.md                      ← links: old-2
       old-2.md                      ← links: old-3
       old-3.md                      ← (leaf)
     scratch/
       note-1.md                     ← links: scratch/note-2, projects/a
       note-2.md                     ← links: scratch/note-3
       note-3.md                     ← links: scratch/note-4
       note-4.md                     ← (leaf)
   ```
   Properties:
   - `projects/` is a tight folder-aligned community (4 nodes, 6 internal edges, 2 external).
   - `archive/` is a tight folder-aligned community (4 nodes, 5 internal edges, 1 external).
   - `scratch/` is a loose chain (4 nodes, 3 internal edges, 1 external to `projects/a`) — louvain may prefer to leave it expanded at low budget.
   - Total: 13 nodes. At `--budget=6`, both `projects/` and `archive/` should collapse → `root-note + projects/ + archive/ + 4 scratch nodes = 7 entities` … wait, that's 7 >6. At `--budget=8`, exactly the expected collapses fit.
   - When session pins `scratch/`, `scratch/` is always collapsed even at `--budget=20`.
   - When budget is tight enough to force folder-oversize fallback, `projects/` splits via louvain and the visible remnant retains the `projects/` label on its label prefix.
   Alternative rejected: reuse an existing vault (e.g. `voicetree-19-4/`). Non-deterministic — vault contents change between commits, ASCII diffs rot.

## Scoring Sketch

Pseudo-TS (for discussion; actual impl in FA-101):

```ts
// In buildLouvainCandidates, tag each candidate with its aligned folder (if any).
function detectAlignedFolder(nodeIds: string[], graph: NormalizedGraph): string | undefined {
  const commonPrefix = longestCommonFolderPrefix(nodeIds.map(id => graph.nodeById.get(id)?.folderPath ?? ''))
  if (commonPrefix.length === 0) return undefined
  const folderDescendants = nodeIdsUnderFolder(commonPrefix, graph)
  // Alignment = louvain cluster is a subset of folderDescendants (not necessarily equal —
  // allow partial: the cluster IS within the folder, just not covering it fully).
  return nodeIds.every(id => folderDescendants.has(id)) ? commonPrefix : undefined
}

// In compareCandidates, apply bonus only to louvain candidates that have alignedFolderPath.
function effectiveCohesion(c: Candidate): number {
  const BONUS = 0.05
  return c.strategy === 'louvain' && c.alignedFolderPath ? c.cohesion + BONUS : c.cohesion
}
```

## Pinning Pre-Pass Sketch

Pseudo-TS (for FA-102):

```ts
export function renderAutoView(vaultPath: string, options: AutoViewOptions = {}): {output, format} {
  const graph = buildAutoViewGraph(root)
  // ... existing setup ...

  // NEW: pinning pre-pass.
  const pinnedClusters = buildPinnedClusters(graph, options.pinnedFolderIds ?? [])
  const pinnedNodeIds = new Set(pinnedClusters.flatMap(c => c.nodeIds))
  const remainingBudget = budget - pinnedClusters.length
  const remainingEntityCount = graph.nodes.length - pinnedNodeIds.size + pinnedClusters.length

  // Run existing algorithm on (graph minus pinnedNodeIds), with reduced budget.
  const autoClusters = findCollapseBoundary(
    { rootName: graph.rootName, nodes: graph.nodes.filter(n => !pinnedNodeIds.has(n.id)) },
    remainingBudget,
    { selectedIds: options.selectedIds, focusNodeId: options.focusNodeId }
  )

  // Concatenate: pinned clusters first (sorted by basename), then auto clusters.
  const allClusters = [...pinnedClusters, ...autoClusters]
  // ... render as before ...
}
```

## Risks / Trade-offs

- **Folder-preference may exceed budget when a folder dwarfs the remaining budget.** The existing `isOversizedCluster` (>90% of graph) already filters extreme cases. For folders in the 50–90% range, the greedy loop may pick them *and* leave very few visible entities. Mitigation: FA-106's budget-overrun fallback test documents the threshold behaviour; if acceptance is poor, follow-up change tightens the oversize cutoff.
- **Pinning can push visible entities below any reasonable minimum.** A session that pins every top-level folder could yield a view with 3 clusters and 0 expanded nodes. Behaviour is correct (user asked for it); no special-case. If this becomes painful, a future `--min-visible=N` flag could warn.
- **Session fetch is a network hop the CLI didn't have before.** Adds ~50ms of cold-start latency per `vt graph view --from-session …` invocation. Acceptable per Leo's `cli-vault-control` "CLI auto-launches" UX tradeoff.
- **Label-by-basename collides across siblings.** `a/projects/` and `b/projects/` both render as `projects/`. Mitigation: if two pinned/aligned clusters share a basename, fall back to `parent/basename/` form. Spec requires this; test FA-103 covers it.
- **Wave-B dependency risk.** If Wave B ships with `GraphNode.kind` keyed differently than expected, FA-101 needs a one-line adapter. Confirmed Wave B5 shipped (`3b645780`); sanity-check during FA-101 kickoff.

## Migration Plan

1. **FA-100 (unblocked)** — author the fixture vault. No code change; deterministic input for everything downstream.
2. **FA-101 (unblocked)** — add folder-alignment scoring + `alignedFolderPath` field + `kind`-aware detection in `collapseBoundary.ts`. Pure unit tests only.
3. **FA-102 (unblocked)** — add `pinnedFolderIds` option and pre-pass in `autoView.ts`. Unit tests on the pre-pass; no CLI wiring yet.
4. **FA-103 (unblocked)** — change `formatCollapsedSummary` to emit folder basename when `alignedFolderPath` is set; add sibling-collision fallback to `parent/basename/`.
5. **FA-104 (BLOCKED on Leo P6)** — wire `--from-session <id>` into `bin/vt-graph.ts`: fetch session state via `GraphDbClient`, extract collapseSet, pass as `pinnedFolderIds` to `renderAutoView`.
6. **FA-105 (BLOCKED on Leo P5+P6)** — CLI-driven verifier agent. Full Verification block.
7. **FA-106 (unblocked)** — budget-overrun fallback test: fixture vault with an oversized folder, assert intra-folder subdivision + folder-label preservation.
8. **FA-107 (BLOCKED on Leo P5)** — integration test against a live daemon (spawn `vt-graphd`, mount fixture, POST session collapseSet, render, assert).

Rollback: each FA-card is a separate commit. FA-100..FA-103 are additive (no behaviour change for users who don't pin, because aligned-scoring bonus is a tie-breaker only). FA-104..FA-107 land only after gates open.

## Open Questions

- **Folder-alignment bonus magnitude.** Proposed `+0.05` on effective cohesion. Confirm empirically in FA-101 against the fixture vault; tune to the smallest value that consistently flips the fixture's `scratch/`-vs-`louvain-6` tie in favour of `scratch/`.
- **Sibling-collision label form.** Proposed `parent/basename/` (e.g. `a/projects/`, `b/projects/`). Alternative: full path (`a/deep/projects/`). Confirm in FA-103 — prefer minimum-disambiguating prefix.
- **Does `findCollapseBoundary` need to expose `alignedFolderPath` on the returned `CollapseCluster` to all callers, or only to the ASCII renderer?** Proposed: add it to the public type so the mermaid/json renderers can adopt folder-labels in a follow-up. Confirm in FA-101.
- **Should `--from-session` without Leo P6 fail loudly or silently fall back to no-pinning?** Proposed: fail with a clear error ("--from-session requires vt-graphd; run `vt vault show` to verify the daemon is reachable"). Confirm in FA-104.
- **Do we want a `--no-folder-aware` opt-out flag for debugging?** Proposed: no — the algorithm is additive and tie-breaker-only, so opt-out has no observable benefit. Re-open if a user hits surprising behaviour.

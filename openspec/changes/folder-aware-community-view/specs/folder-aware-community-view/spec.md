## ADDED Requirements

### Requirement: Auto-budget prefers folder-aligned collapse clusters
When `vt graph view --auto` selects collapse clusters to fit the budget, and a candidate cluster's node-set is a subset of some folder's descendant set (folder-aligned), the algorithm SHALL rank that cluster above a non-aligned cluster of comparable cohesion. Ranking SHALL NOT override strictly-higher cohesion cuts — the folder-alignment bonus is a tiebreaker, not a dominant factor.

#### Scenario: Folder-aligned louvain cluster preferred over ad-hoc
- **GIVEN** a graph where a louvain community exactly matches the descendant set of folder `projects/`
- **AND** a second louvain community of equal size that spans two unrelated folders
- **WHEN** `findCollapseBoundary` selects clusters at a budget that admits exactly one
- **THEN** the selected cluster is the `projects/`-aligned one
- **AND** its ASCII summary uses the folder basename `projects/` as the label

#### Scenario: Strictly-higher-cohesion ad-hoc cluster still wins
- **GIVEN** a folder-aligned candidate with cohesion 0.60
- **AND** a non-aligned louvain candidate with cohesion 0.80
- **WHEN** both are evaluated under the same budget
- **THEN** the non-aligned candidate is selected
- **AND** its label is the representative node's title (existing behaviour)

### Requirement: Session-pinned folders are rendered collapsed regardless of budget state
When `renderAutoView` is invoked with a non-empty `pinnedFolderIds` option (sourced from a session's collapseSet via `--from-session`), the pinned folders SHALL appear as collapsed cluster summaries in the rendered output, even if the current budget would otherwise leave them expanded.

#### Scenario: Pinned folder collapsed at generous budget
- **GIVEN** a graph of 10 nodes and a budget of 30 (ample)
- **AND** `pinnedFolderIds: ["archive/"]` where `archive/` contains 3 nodes
- **WHEN** the view renders
- **THEN** `archive/` appears as a single collapsed cluster summary
- **AND** its 3 descendant nodes do NOT appear as individual entries in the spine

#### Scenario: No pinning, generous budget
- **GIVEN** a graph of 10 nodes and a budget of 30
- **AND** `pinnedFolderIds: []` (default)
- **WHEN** the view renders
- **THEN** no clusters are collapsed (visible entities ≤ budget)
- **AND** all 10 nodes appear expanded

### Requirement: Auto-budget SHALL NOT expand a session-pinned folder
The greedy budget loop SHALL NOT select a cluster that would require expanding a session-pinned folder. Pinned folders are pre-folded into the selected set before budget allocation and their descendant node-ids are excluded from all other candidate pools.

#### Scenario: Budget pressure does not unpin
- **GIVEN** a session has pinned `archive/` closed
- **AND** the user re-runs `vt graph view --auto --budget=100 --from-session <id>` (budget now exceeds total node count)
- **WHEN** the view renders
- **THEN** `archive/` remains collapsed
- **AND** its internal nodes do not appear expanded anywhere in the output

#### Scenario: Pinned folder nodes excluded from other candidates
- **GIVEN** `archive/` is pinned AND an adjacent folder `archive-old/` contains cross-links to `archive/`
- **WHEN** candidate clusters are built
- **THEN** no candidate includes any node under `archive/`
- **AND** no candidate spans both `archive/` and `archive-old/`

### Requirement: `vt graph view --auto --from-session <sessionId>` honors session collapseSet
Once `decouple-ui-from-graph-server` P5 (`GraphDbClient`) and P6 (`vt view` CLI conventions) have landed, `vt graph view` SHALL accept a `--from-session <sessionId>` flag. When present, the CLI SHALL fetch the session's collapseSet via `GraphDbClient.getSessionState(sessionId)` and pass it to `renderAutoView` as `pinnedFolderIds`. Folder IDs in the collapseSet are filtered to those that correspond to `GraphNode.kind === 'folder'` entries — non-folder ids are ignored with a stderr warning.

#### Scenario: Session collapseSet applied
- **GIVEN** a running `vt-graphd` with session `abc` having collapseSet `["/vault/projects/"]`
- **WHEN** the user runs `vt graph view --auto --from-session abc --vault /vault`
- **THEN** the CLI hits `GET /sessions/abc/state` on the daemon
- **AND** extracts `projects/` as a pinned folder
- **AND** the rendered output shows `projects/` as a collapsed cluster

#### Scenario: Daemon unreachable with --from-session
- **WHEN** the user runs `vt graph view --auto --from-session abc` but no daemon is running and auto-launch fails
- **THEN** the CLI exits with non-zero
- **AND** prints an error identifying the daemon as unreachable
- **AND** does NOT fall back silently to no-pinning

#### Scenario: Non-folder id in collapseSet is ignored
- **GIVEN** a collapseSet containing `["/vault/projects/", "/vault/projects/a.md"]` (second is a file)
- **WHEN** the CLI processes the collapseSet
- **THEN** only `/vault/projects/` is used as a pinned folder
- **AND** a warning is printed to stderr naming the ignored non-folder id

### Requirement: ASCII output for collapsed folders uses folder basename
Collapsed clusters that are folder-aligned (either from the folder-first strategy or from an aligned louvain cluster) SHALL render their summary label as the folder's basename with a trailing slash (e.g. `▢ projects/ [collapsed: …]`), NOT as a synthetic cluster id, NOT as the representative node's title.

#### Scenario: Folder-first cluster labelled by basename
- **GIVEN** a cluster selected by the folder-first strategy for folder `projects/`
- **WHEN** its summary is formatted
- **THEN** the label is `projects/`
- **AND** the label is NOT `cluster-1`, NOT the title of any descendant node

#### Scenario: Sibling-basename collision disambiguated
- **GIVEN** two pinned clusters aligned to folders `a/notes/` and `b/notes/`
- **WHEN** both render in the same view
- **THEN** their labels are `a/notes/` and `b/notes/` (minimum-disambiguating prefix)
- **AND** neither label is the bare `notes/`

### Requirement: Budget overrun on oversized folder falls back to intra-folder community detection
When a folder-aligned candidate exceeds `isOversizedCluster` (>90% of graph) OR consumes so much budget that folder-first selection cannot fit within the budget, the algorithm SHALL fall back to running louvain community detection over the folder's descendant subgraph. The visible remnant (nodes not collapsed by the fallback) SHALL retain the folder's basename as a prefix on their individual labels OR appear under a `▢ folder-name/` header that groups them.

#### Scenario: Single oversized folder
- **GIVEN** `projects/` contains 95% of the graph's nodes
- **WHEN** `findCollapseBoundary` is called with a typical budget
- **THEN** the folder-first strategy does not select `projects/` (oversized filter)
- **AND** the louvain strategy runs over `projects/`'s subgraph
- **AND** the resulting clusters' labels reference `projects/` as their anchor folder

#### Scenario: Folder fits but no other budget headroom
- **GIVEN** a graph of 32 nodes where `projects/` contains 28 of them
- **AND** budget is 5
- **WHEN** the view renders
- **THEN** `projects/` collapses as a single folder-aligned cluster
- **AND** the 4 non-projects nodes remain visible
- **AND** the visible budget is `1 (summary) + 4 (visible) = 5` — within budget

### Requirement: Folder predicate uses `GraphNode.kind === 'folder'`
The algorithm SHALL identify folder candidates using `GraphNode.kind === 'folder'` as the authoritative predicate. Path-string heuristics (e.g. trailing slash) SHALL NOT be used as the primary signal. The `folderPath` field on `CollapseBoundaryNode` remains used for descendant-set construction via prefix walk but SHALL NOT be the source of truth for "is this a folder".

#### Scenario: Folder node drives candidate enumeration
- **WHEN** `buildFolderCandidates` runs over a post-Wave-B graph
- **THEN** it iterates nodes where `kind === 'folder'`
- **AND** for each folder node it gathers descendants by `folderPath`-prefix match against other nodes
- **AND** emits one candidate per folder with ≥2 descendants that is not oversized

#### Scenario: Stray trailing-slash path is not a folder
- **GIVEN** a graph with a file whose `relPath` ends in `/` due to a normalisation bug upstream
- **AND** that node's `kind === 'file'` (correct semantic)
- **WHEN** folder candidates are built
- **THEN** that node is NOT treated as a folder
- **AND** no candidate is emitted for it

### Requirement: Verification via CLI-driven fixture-based verifier
The change SHALL ship with an agent-runnable verifier that drives `vt graph view --auto` against a fixture vault with a deterministic folder hierarchy and cross-folder link topology, and asserts on the ASCII output. The verifier SHALL be written as a standalone script (callable from a CI job or from a human operator) and SHALL be the gating verification for the change (in addition to pure unit tests).

#### Scenario: Verifier passes on the fixture
- **GIVEN** the fixture vault at `packages/graph-tools/fixtures/folder-aware-fixture/` with the layout specified in design.md
- **WHEN** the verifier runs `vt graph view --auto --budget=8 --vault <fixture>`
- **THEN** the output contains a `▢ projects/` line
- **AND** the output contains a `▢ archive/` line
- **AND** individual scratch nodes are expanded (not collapsed into a cluster)

#### Scenario: Verifier passes pinned session (post-Leo-gates)
- **GIVEN** a running daemon with session `test` having collapseSet `["<fixture>/scratch/"]`
- **WHEN** the verifier runs `vt graph view --auto --budget=30 --from-session test --vault <fixture>`
- **THEN** the output contains a `▢ scratch/` line even at generous budget
- **AND** no `scratch/note-*` entries appear individually

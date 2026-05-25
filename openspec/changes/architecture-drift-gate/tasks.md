## 1. Spec language decisions

- [x] 1.1 Confirm Mermaid dialect: `flowchart` (proven, supports `click` directives, GitHub renders inline). Document the chosen Mermaid version pin in design.md if a runtime parser dep is added.
- [x] 1.2 Decide parser strategy: prefer hand-rolled extractor using existing repo Mermaid via `mermaid.parse()` + `flowDb`. Fall back to `@emily/mermaid-ast` (JSR) only if hand-rolled proves brittle. Document the choice.
- [x] 1.3 Define the refinement frontmatter for descendant `architecture.md` files: YAML `refines: <parent-node-id>` at the top of the file.

## 2. Author the root architecture.md

- [x] 2.1 Author `/architecture.md` describing the existing 6-7 process topology (Electron main, Electron renderer, vt-graphd, tmux-server, vt-mcpd, vt CLI) with `click` bindings to actual entry files / directories and labeled edges (`IPC`, `HTTP /graph/*`, `HTTP /mcp/*`, `spawn + socket`, ...).
- [x] 2.2 Walk the existing `voicetree-global-architecture-2026-05-25.md` ASCII as the reference. Resolve any discrepancy by reading current code (file paths must be verified; do not copy stale paths blindly).
- [x] 2.3 Run the validator manually against the authored file to verify the spec is self-consistent.

## 3. Validator implementation

- [x] 3.1 `parseArchitectureMd(absPath): DiagramSpec` — pure function returning `{ nodes, edges, clickPaths, refinesParentNodeId }`. Black-box tested with fixture markdown files in `__tests__/` next to the validator.
- [x] 3.2 `discoverArchitectureFiles(repoRoot): ParsedArchitectureFile[]` — walks the tree using the same excludes as `_shared/discovery/discover-packages.ts`, returns all `architecture.md` paths parsed once.
- [x] 3.3 `buildRefinementTree(parsedFiles): RefinementTree` — joins child files to parent node IDs by the `refines:` frontmatter. Asserts every `refines:` target exists in the parent file.
- [x] 3.4 `architecture-drift.test.ts` at `packages/measures/src/health/coupling/` runs all assertions over the live repo. Uses the existing `_shared/writers/report-writer` `recordHealthMetric` pattern that the other coupling tests use.
- [x] 3.5 CheckDef wrapper at `packages/measures/src/checks/tier_1/structure/architecture-drift.ts` following the shape of `relative-import-depth.ts`.

## 4. Structural assertions (day-1 surface)

- [x] 4.1 Every node has a `click` directive.
- [x] 4.2 Every click target exists on disk (file OR directory, both accepted).
- [x] 4.3 Every edge has a non-empty label (the channel name).
- [x] 4.4 No orphan nodes — every node has at least one edge in or out within its own file.
- [x] 4.5 Node IDs are unique within a single architecture.md.
- [x] 4.6 Every `refines:` declaration in a descendant file matches exactly one node ID in the nearest ancestor `architecture.md`.
- [x] 4.7 Every click target in a descendant file is inside the parent node's click-target directory subtree.
- [x] 4.8 Every static source import/export edge between code-backed architecture nodes has a same-direction Mermaid edge.

## 5. Failure messages

- [x] 5.1 Each failure type emits a message that names the offending node ID, edge endpoints, or file path AND tells the reader how to resolve it (either fix the diagram or fix the code).
- [x] 5.2 No "violation" without an explicit location. No generic "drift detected" — always point at the specific node/edge/file.

## 6. Verification

- [x] 6.1 Validator passes against the authored `/architecture.md`.
- [x] 6.2 Validator fails with a precise drift message when a click target is intentionally renamed in a test fixture (and passes when the diagram is updated to match).
- [x] 6.3 Validator fails when a Mermaid edge is intentionally unlabeled and when source code intentionally adds an undeclared static import edge.
- [x] 6.4 `npm run test` includes the new check in tier-1 and the existing tier-1 gates still pass.
- [x] 6.5 Honest report: in the PR description, surface any approximation, fragile parser fallback, convention not enforced by assertions, or assertion that depends on a heuristic.

## 7. Out of scope (do NOT do in this change)

- [ ] 7.1 Migrating any hard-coded constants in existing `health/coupling/` tests to derive from architecture.md. That is a Phase 2 change.
- [ ] 7.2 Channel-semantic verification (reading the click target to verify the labeled channel actually exists in code). That is a tier-2 future change.
- [ ] 7.3 Broad forbidden-import enforcement generated from the edge graph for all repo packages. Tier-2.
- [ ] 7.4 Authoring any descendant `architecture.md` files. Day 1 is root-only.
- [ ] 7.5 Replacing dependency-cruiser, ESLint boundary rules, or any other existing enforcement.

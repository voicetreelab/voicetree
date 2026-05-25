## Context

VoiceTree's high-level architecture is described in two places that drift:
- **Human-readable**: ASCII diagrams in scattered markdown notes (e.g. `voicetree-global-architecture-2026-05-25.md`).
- **Machine-checked**: hard-coded TypeScript constants inside the eleven tests in `packages/measures/src/health/coupling/` (`SCANNED_PACKAGE_NAMES`, `ALLOWED_GRAPH_DB_SERVER_IMPORT_FILES`, `GRAPH_DB_SERVER_CONSUMER_SOURCE_ROOTS`, ...).

The two answers to "what is the architecture?" disagree by construction because they are maintained independently. Reviewers see neither at PR time.

The landscape research (summarized in the parent voicetree node) found:
- `ts-arch` and `ArchUnitTS` are the closest existing tools for "diagram-as-spec" — both PlantUML, both slice-level.
- No existing tool does Mermaid + file-level binding via `click` directives.
- `mermaid-ast` (JSR) exposes a typed AST including `click` directives. Mermaid's own parser via `mermaid.parse()` + `flowDb` is reachable without the wrapper.
- VoiceTree already has `packages/measures/src/_shared/graph/import-graph.ts` producing `{ files, edges }` from the TS compiler API. Reusing that primitive removes the need for ts-morph.

## Goals / Non-Goals

**Goals:**
- One Mermaid diagram (or a tree of them) is the executable contract for VoiceTree's high-level architecture.
- Day-1 surface enforces STRUCTURAL drift only (does the diagram describe a real codebase?). Fast, lint-shaped, fits tier 1.
- Reuse existing `_shared` primitives. No new TypeScript AST walker.
- Validator is pure functions. Test is black-box over fixture files.
- Architecture spec lives at the repo root and is visible inline on GitHub PRs.

**Non-Goals:**
- Behavioral drift (does the code actually wire channels the way the diagram says?). Tier-2 source-walking, not in this change.
- Forbidden-import enforcement derived from the edge graph. Separate Phase 2 change.
- Migrating existing health/coupling test constants to derive from architecture.md. Phase 2.
- Authoring child `architecture.md` files at depth >0 on day 1. The validator supports them; nothing requires us to ship one immediately.
- Replacing dependency-cruiser, ESLint boundary rules, or any existing enforcement.

## Decisions

### D1. One Mermaid block per file; fractal via separate files

**Choice:** Each `architecture.md` contains exactly ONE Mermaid `flowchart` block. Multi-level architecture is expressed by placing additional `architecture.md` files inside subdirectories, each declaring its parent node id via YAML frontmatter (`refines: <parent-node-id>`).

**Rationale:**
- Co-locates each level of detail with the code it describes: working in `packages/systems/graph-db-server/`, you see that scope's diagram in the same directory.
- Each file stays small and renders cleanly.
- The bridge between levels is explicit (one frontmatter line) rather than implicit (subgraph-id convention).
- Matches C4's hierarchy model (System → Container → Component) which is well-established prior art for this kind of layered architecture description.

**Alternatives considered:**
- Two Mermaid blocks (process view + package view) in one root file. Rejected: the join between blocks would have to be a subgraph-id-equals-node-id convention, which is implicit and brittle; reading at depth still requires the root file.
- One mega-Mermaid with nested subgraphs. Rejected: crowded past ~6 processes + ~30 packages; Mermaid's nested subgraph rendering degrades; edge routing becomes spaghetti.
- Two separate files at root (architecture-processes.md + architecture-packages.md). Rejected: implicit cross-reference reintroduces sync drift between files.

### D2. `click NodeId "path"` is the node→code binding

**Choice:** Mermaid's official `click` directive carries the file or directory path that represents each node. The validator extracts these from the parsed diagram and asserts each path exists on disk.

**Rationale:**
- `click` is part of the Mermaid spec, not a hack. GitHub renders it as a clickable link, so the diagram becomes a navigable map of the codebase.
- It allows nodes to bind to specific entry files (e.g. `webapp/src/shell/edge/main/runtime/electron/app/main.ts`) rather than just folders by naming convention. This is the meaningful upgrade over ts-arch's slice-level binding.
- Click targets MAY be directories (for nodes like the renderer that don't have a single entry file). The validator accepts both file and directory paths.

### D3. Edge labels carry the channel name; static source edges must be declared

**Choice:** Every Mermaid edge MUST have a non-empty label (e.g. `|IPC|`, `|HTTP /graph/*|`, `|spawn + socket|`). Day-1 assertions verify the label is present and non-empty. For code-backed click targets, the validator also reads static import/export edges between those clicked source scopes and requires each cross-node source edge to have a same-direction Mermaid edge. It does NOT verify the target file actually exposes the named channel in code.

**Rationale:**
- Channel-semantic verification (read the target file, find route declarations matching the label) requires source-walking and per-channel parsers. That is an order of magnitude more code than structural drift detection.
- Structural drift includes a source dependency being added between existing architecture nodes without updating the executable diagram. Static import graph comparison catches that cheaply without attempting channel-specific semantic analysis.
- Tier 1 must stay fast. Static import extraction over the clicked scopes is cheap enough; channel-semantic verification remains out of scope.

**Open for later:** A tier-2 follow-up can grep target files for declared channels.

### D4. Reuse `_shared/graph/import-graph.ts`; no new graph builder

**Choice:** The validator consumes the existing `buildImportGraph()` primitive from `packages/measures/src/_shared/graph/import-graph.ts` to compare static source imports against diagram edges. The shared import graph primitive now accepts file roots and TSX files, so architecture click targets can be files or directories outside package `src/` while preserving the same narrow public graph API. No new TS-compiler walk. No ts-morph.

**Rationale:**
- The existing `{ files: SourceFile[], edges: Edge[] }` shape is exactly what we need.
- Eleven existing coupling tests already consume this primitive — following the established pattern keeps measures architecturally consistent.
- Avoids adding ts-morph (or any new TS-compilation surface) for the same job the repo already has a clean primitive for.

### D5. Parser: Mermaid syntax gate plus hand-rolled contract extractor

**Choice:** Use Mermaid's official `mermaid.parse()` as the syntax gate, then use a small hand-rolled extractor for the contract fields VoiceTree enforces: nodes, edges, edge labels, and `click` directives. The measures workspace pins `mermaid@11.15.0`; the Node parser path also initializes a minimal `jsdom@27.4.0` window before loading Mermaid because Mermaid's sanitizer expects browser DOM globals. Adopt `@emily/mermaid-ast` (JSR) only if the hand-rolled extractor proves brittle in practice.

**Rationale:**
- Mermaid's public `parse()` API is appropriate for accepting/rejecting the diagram syntax.
- Mermaid's `flowDb` is not a stable public API and is awkward in Node because the sanitizer assumes a DOM. Treating `parse()` as the syntax gate keeps the official parser in the loop without coupling the health check to internal DB shapes.
- The contract extractor is deliberately narrow and only supports the checked dialect this OpenSpec authorizes: one `flowchart` block, ordinary node declarations, `-->` edges, `|label|` edge labels, and `click <NodeId> "<path>"` directives.
- If the hand-rolled approach breaks across a Mermaid upgrade, swapping to `mermaid-ast` is a one-file change.

**Risk:** Mermaid's flowchart grammar is still JISON, not Langium. Langium migration is in progress for other diagram types. Pin the Mermaid version used by the validator and re-evaluate at each upgrade.

### D6. Refinement frontmatter

**Choice:** Each descendant `architecture.md` has YAML frontmatter with `refines: <parent-node-id>`. The parent file is the nearest ancestor `architecture.md` in the directory tree.

**Rationale:**
- One declarative line per child file. Explicit, parseable, fails loudly when the parent node id is wrong.
- "Nearest ancestor" avoids requiring the child to know its parent's file path — the directory tree provides that.
- YAML frontmatter is the conventional carrier for markdown metadata.

**Constraint:** A descendant file's click targets MUST all be inside the parent node's click-target directory subtree. This makes the refinement structurally consistent with the parent's binding and prevents a descendant from describing code that doesn't belong to its claimed parent.

## Risks

1. **Mermaid JISON parser instability.** Mitigation: pin Mermaid version; hand-rolled extractor isolates the surface; switching to `mermaid-ast` is a single-file change if needed.

2. **Reviewer fatigue when the diagram must be edited.** Mitigation: every validator failure message points at the exact missing or extra node/edge/file and either suggests the diagram edit OR points at the code change that would reconcile.

3. **Day-1 surface does NOT catch "added a new daemon, diagram unchanged."** A test that knows about every process must enumerate them. Day 1 only catches drift in things the diagram already mentions. Mitigation: optional follow-up convention rule ("every `packages/systems/*/src/main.ts` must appear in some click directive"). Not on day 1 to keep scope tight; flagged in the "Open for later" list.

4. **Click target is a directory — what counts as "exists"?** Decision: directory existence is sufficient; the validator does not assert anything about the contents of a directory click target. This avoids prescribing internal structure to consumers.

5. **The fractal model is unused on day 1.** Designing it in from the start is cheap (~20 LOC for tree walk and cross-file assertions) but adds surface that no current spec exercises. Mitigation: the assertions for descendant files only fire when descendant files exist; day-1 root-only operation runs only the per-file structural checks.

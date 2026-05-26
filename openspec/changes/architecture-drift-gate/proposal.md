## Why

VoiceTree has eleven architectural-enforcement tests in `packages/measures/src/health/coupling/` (cross-package-coupling, package-boundaries, cross-package-cycles, system-package-coupling, dsm-matrix, ...). Each carries its own hard-coded specification of what packages exist and what is allowed to import what. The HUMAN-READABLE description of the architecture lives in scattered ASCII diagrams inside markdown notes. These two drift independently: documentation rots while code stays stale.

We want a single, human-readable source of truth that the gates CONSUME, not duplicate. Mermaid is the right format because GitHub renders it inline in PRs, so the diagram is in the review.

## What Changes

- Add `/architecture.md` at the repo root containing one Mermaid `flowchart` block describing VoiceTree's process topology (Electron main, Electron renderer, vt-graphd, tmux-server, vt-mcpd, vt CLI). Each node has a `click <NodeId> "path"` directive binding it to its entry file or directory. Each edge has a label naming the channel (`IPC`, `HTTP /graph/*`, `spawn + socket`, ...).
- Add a tier-1 architecture-drift gate at `packages/measures/src/checks/tier_1/structure/architecture-drift.ts` (CheckDef wrapper) backed by `packages/measures/src/health/coupling/architecture-drift.test.ts` (the actual logic).
- The validator parses one or more `architecture.md` files (root + optional descendant refinement files), asserts internal consistency of each diagram, asserts every click target exists on disk, and asserts every descendant file's `refines:` target matches a node in the nearest ancestor `architecture.md`.
- Reuse the existing `_shared/graph/import-graph.ts` and `_shared/discovery/discover-packages.ts` primitives. No new graph builder. No ts-morph. No new TypeScript AST walker.
- Day 1 ships with the root `/architecture.md` only. The validator supports descendant files from day 1 but no descendants are authored yet — they are added lazily as packages develop architectural complexity worth depicting.

## Capabilities

### New Capabilities

- `architecture-drift-gate`: A tier-1 measure that treats one or more `architecture.md` Mermaid diagrams as the executable contract for VoiceTree's high-level process and package topology. Fails the gate when the diagram and codebase disagree on what exists, what refines what, or whether every node has a binding. Supports a fractal layout where each directory may contain its own `architecture.md` that refines a node from a parent file.

### Modified Capabilities

<!-- No accepted baseline specs exist in openspec/specs yet. -->

Phase 2 (a separate future change, NOT in scope here) will migrate hard-coded constants in existing `health/coupling/` tests to derive from the architecture.md spec, so each test owns its enforcement logic while the architecture description lives in one place.

## Impact

- **Repo root**: adds `/architecture.md`.
- **Measures**: adds two files (one test, one CheckDef wrapper). Reuses existing `_shared` primitives.
- **Tier 1**: one new check, runs as part of the existing tier-1 structure gate.
- **No CI workflow changes**: slots into the existing tier-1 wiring.
- **No new infrastructure**.
- **No existing test changes**: this change is purely additive. Phase 2 will be a separate change.

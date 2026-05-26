## ADDED Requirements

### Requirement: Treat architecture.md Mermaid diagrams as the high-level architecture contract

The system SHALL accept one or more `architecture.md` files (root and optional descendants in the directory tree) as the executable specification of VoiceTree's high-level process and package topology. Each `architecture.md` SHALL contain exactly one Mermaid `flowchart` block. The Mermaid block SHALL declare nodes representing processes, services, or packages; edges representing channels or relationships with labels naming the channel; and `click <NodeId> "<path>"` directives binding each node to a file or directory on disk.

#### Scenario: Root architecture.md describes the process topology

- **WHEN** `/architecture.md` exists at the repo root
- **AND** it contains a Mermaid `flowchart` block with nodes for the long-running processes (Electron main, Electron renderer, vt-graphd, tmux-server, vt-mcpd, vt CLI)
- **AND** every node has a `click <NodeId> "<path>"` directive whose path exists on disk
- **AND** every edge has a non-empty label naming a channel
- **AND** every node has at least one incoming or outgoing edge
- **AND** all node IDs in the file are unique
- **THEN** the architecture-drift gate SHALL accept the file as the root specification and pass

#### Scenario: Descendant architecture.md refines a parent node

- **WHEN** `/packages/systems/graph-db-server/architecture.md` exists
- **AND** its YAML frontmatter contains `refines: graphd` where `graphd` is a node ID in the nearest ancestor `architecture.md`
- **AND** every click target in the descendant's Mermaid block is inside the parent `graphd` node's click-target directory subtree
- **AND** the descendant's Mermaid block independently satisfies the structural assertions (per-file consistency)
- **THEN** the architecture-drift gate SHALL accept the descendant as a refinement of the `graphd` node and pass

### Requirement: Fail the tier-1 gate on structural drift

The system SHALL fail the tier-1 architecture-drift check when any of the following conditions is detected:

- A node in an `architecture.md` has no `click` directive.
- A `click` directive's path does not exist on disk (neither as file nor as directory).
- An edge has no label or has an empty label.
- A node has no incoming or outgoing edges within its own file (orphan).
- Two nodes in the same `architecture.md` share an ID.
- A descendant file's `refines:` target does not match any node ID in the nearest ancestor `architecture.md`.
- A descendant file's click target paths fall outside the parent node's click-target directory subtree.
- An `architecture.md` contains zero Mermaid `flowchart` blocks or more than one.
- A static source import/export edge crosses from one code-backed architecture node's click target to another code-backed architecture node's click target and the same-direction Mermaid edge is not declared.

Every failure SHALL emit a message that names the offending node ID, edge endpoints, or file path AND tells the reader which side to reconcile (edit the diagram, or edit the code).

#### Scenario: Click target file is missing

- **WHEN** `/architecture.md` declares `click graphd "packages/systems/graph-db-server/src/main.ts"`
- **AND** the file `packages/systems/graph-db-server/src/main.ts` does not exist on disk
- **THEN** the architecture-drift gate SHALL fail
- **AND** the failure message SHALL name the node id `graphd`, the declared click target path, and instruct the reader to either restore the file or update the diagram

#### Scenario: Diagram has an unlabeled edge

- **WHEN** an `architecture.md` contains an edge `renderer --> graphd` with no label between the arrow
- **THEN** the architecture-drift gate SHALL fail
- **AND** the failure message SHALL identify the unlabeled edge by its endpoint node IDs

#### Scenario: Descendant refines a non-existent parent node

- **WHEN** `/packages/foo/architecture.md` declares `refines: nonexistent_node` in its frontmatter
- **AND** no node with id `nonexistent_node` exists in the nearest ancestor `architecture.md`
- **THEN** the architecture-drift gate SHALL fail
- **AND** the failure message SHALL name the descendant file path and the unresolved parent node id

#### Scenario: Descendant click target escapes the parent's subtree

- **WHEN** `/packages/systems/graph-db-server/architecture.md` refines node `graphd`
- **AND** `graphd`'s click target in the root file is `packages/systems/graph-db-server/`
- **AND** the descendant contains `click foo "packages/systems/agent-runtime/src/some-file.ts"`
- **THEN** the architecture-drift gate SHALL fail
- **AND** the failure message SHALL name the descendant file, the offending click target, and the parent subtree it was expected to live inside

#### Scenario: Source import creates an undeclared architecture edge

- **WHEN** `/architecture.md` declares nodes `renderer` and `graphd` with click targets that point at source files or directories
- **AND** the Mermaid block does not contain a same-direction `renderer --> graphd` edge
- **AND** a source file inside the `renderer` click target statically imports or exports a source file inside the `graphd` click target
- **THEN** the architecture-drift gate SHALL fail
- **AND** the failure message SHALL name the importing source file, the imported source file, and the undeclared architecture edge

### Requirement: Reuse existing measures primitives; no new graph builder

The validator SHALL be implemented as pure functions inside `packages/measures/src/health/coupling/architecture-drift.test.ts`, wrapped as a CheckDef at `packages/measures/src/checks/tier_1/structure/architecture-drift.ts` following the shape of the existing tier-1 structure checks (`relative-import-depth.ts`, `orange-gate.ts`).

The implementation SHALL NOT introduce a new TypeScript AST walker. Codebase-graph data SHALL be consumed from `packages/measures/src/_shared/graph/import-graph.ts`, including explicit source-root support for architecture click targets.

#### Scenario: Validator integrates with existing measures conventions

- **WHEN** the validator is implemented
- **THEN** no new TypeScript AST walker is added to the codebase
- **AND** the CheckDef at `packages/measures/src/checks/tier_1/structure/architecture-drift.ts` follows the existing `CheckDef` shape used by `relative-import-depth.ts`
- **AND** the test file under `packages/measures/src/health/coupling/` uses the existing `recordHealthMetric` writer pattern shared with other coupling tests
- **AND** the only new external dependency added (if any) is a Mermaid parser; no ts-morph

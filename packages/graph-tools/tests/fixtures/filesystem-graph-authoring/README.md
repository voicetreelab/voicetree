# Filesystem Graph Authoring Fixtures

Reusable fixture corpus for the filesystem-native `vt graph create` work.

The markdown files in this tree are source inputs, not already-authored graph outputs.
They intentionally omit parent wikilinks unless a case is specifically about malformed structure.
Relationship fixtures use manifest files so tests can prove that structure is derived from the manifest.

## Layout

### `valid/single-node/`

- `solo-import.md`: smallest valid markdown input with explicit frontmatter and no manifest

### `valid/multi-node/`

- `root-brief.md`, `evidence-cluster.md`, `rollout-checklist.md`: valid node inputs
- `structure.ascii.tree.txt`: ASCII tree manifest for the same node set
- `structure.mermaid.mmd`: Mermaid manifest for the same node set

### `fixable/missing-frontmatter/`

- `rough-capture.md`: valid body shape but no frontmatter, intended for auto-fix coverage

### `rejectable/duplicate-target/`

- `duplicate-root.md`, `shared-detail.md`: valid node inputs
- `structure.ascii.tree.txt`: references `shared-detail` twice from the same parent

### `rejectable/missing-ref/`

- `missing-ref-root.md`, `present-detail.md`: valid node inputs
- `structure.ascii.tree.txt`: references `missing-target`, which has no matching markdown file

### `rejectable/oversized-node/`

- `oversized-brief.md`: one markdown node whose body exceeds the 70-line limit and has clear `##` split boundaries

## Intended Consumers

- `packages/graph-tools/tests/**`
- `webapp/src/shell/edge/main/cli/**`
- later validation, fix, and QA phases for filesystem-native authoring

## Naming Rules

- Manifest labels match markdown basenames without the `.md` suffix.
- Each case isolates one primary behavior so tests do not need to disentangle multiple failures.
- Rejectable fixtures include otherwise-valid markdown so the manifest or size violation is the only expected failure.

# Folder-Aware Fixture Vault

This fixture vault materializes Decision 5 from `openspec/changes/folder-aware-community-view/design.md` for deterministic graph-tools tests.

## Invariants

- 13 content nodes across 3 folders: `projects`, `archive`, and `scratch`
- 4 cross-folder edges:
  - `root-note -> projects/a`
  - `root-note -> archive/old-1`
  - `projects/a -> archive/old-1`
  - `scratch/note-1 -> projects/a`
- Leaf nodes: `archive/old-3` and `scratch/note-4`

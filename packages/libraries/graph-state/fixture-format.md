# graph-state test-fixture format (BF-138 ↔ BF-141)

> Consumed by BF-141 (L0-D test fixture design) and every L1 verification task
> (BF-143 golden fixtures, BF-144..BF-152 command tests, BF-153 parity harness,
> BF-154 equivalence matrix, BF-155 F6 parity, BF-156 invariant fuzzer,
> BF-157 perf bench).

## Goals

- **One format for two question classes:** "Does project() produce the right
  ElementSpec for State X?" AND "Does applyCommand(X, cmd) produce State Y?"
- **Trivially loadable:** JSON only. `JSON.parse()` + a 20-line loader is enough.
- **Stable on disk:** sorted keys, deterministic edge IDs, no timestamps
  (so diffs show real regressions).
- **Referenceable:** fixtures have IDs (filename = fixture ID). L1 tests
  import by name.

## Directory layout

```
packages/graph-state/fixtures/
├── snapshots/         # standalone State snapshots (input for project())
│   ├── 001-empty.json
│   ├── 002-three-nodes-flat.json
│   ├── 010-one-folder-expanded.json
│   ├── 011-one-folder-collapsed.json
│   ├── 020-f6-aggregation-basic.json
│   └── ...
├── sequences/         # State0 + Command list + expected State_n
│   ├── 100-collapse-then-expand-round-trip.json
│   ├── 110-add-node-emits-delta.json
│   └── ...
└── projections/       # (optional) pre-computed ElementSpec for a snapshot
    ├── 001-empty.json
    ├── 010-one-folder-expanded.json
    └── ...
```

L1 may add subfolders (e.g. `perf/`, `fuzz-seeds/`) additively.

## Snapshot file — `snapshots/<id>.json`

A single State serialised to JSON. Sets become sorted arrays; Maps become
sorted `[k,v][]`; fp-ts `Option` becomes `{ _tag: "None" } | { _tag: "Some", value }`.

```jsonc
{
  "$schema": "graph-state/snapshot@1",
  "id": "010-one-folder-expanded",
  "description": "One vault root /tmp/vault, folder tasks/ expanded, no selection.",
  "state": {
    "graph": {
      "nodes": {
        "/tmp/vault/tasks/BF-117.md": {
          "outgoingEdges": [
            { "targetId": "/tmp/vault/tasks/BF-118.md", "label": "" }
          ],
          "absoluteFilePathIsID": "/tmp/vault/tasks/BF-117.md",
          "contentWithoutYamlOrLinks": "...",
          "nodeUIMetadata": {
            "color":    { "_tag": "None" },
            "position": { "_tag": "Some", "value": { "x": 100, "y": 200 } },
            "additionalYAMLProps": [],
            "isContextNode": false
          }
        }
      },
      "incomingEdgesIndex": [
        ["/tmp/vault/tasks/BF-118.md", ["/tmp/vault/tasks/BF-117.md"]]
      ],
      "nodeByBaseName":        [["BF-117.md", ["/tmp/vault/tasks/BF-117.md"]]],
      "unresolvedLinksIndex":  []
    },
    "roots": {
      "loaded":     ["/tmp/vault"],
      "folderTree": [ /* FolderTreeNode[] exactly as @vt/graph-model produces */ ]
    },
    "collapseSet": [],
    "selection":   [],
    "layout": {
      "positions": [["/tmp/vault/tasks/BF-117.md", { "x": 100, "y": 200 }]]
    },
    "meta": { "schemaVersion": 1, "revision": 0 }
  }
}
```

### Serialization rules

| Runtime type                    | On-disk form                                      |
|---------------------------------|---------------------------------------------------|
| `ReadonlySet<T>`                | `T[]`, sorted lexicographically                   |
| `ReadonlyMap<K, V>`             | `[K, V][]`, sorted by K                           |
| `fp-ts Option<T>`               | `{ _tag: "None" } \| { _tag: "Some", value: T }`  |
| `undefined` optional field      | Omit key entirely                                 |

A loader (~20 lines) inflates these back to Set/Map/Option.

## Sequence file — `sequences/<id>.json`

```jsonc
{
  "$schema": "graph-state/sequence@1",
  "id": "100-collapse-then-expand-round-trip",
  "description": "Collapsing then expanding a folder returns identical State (revision aside).",
  "initial": "010-one-folder-expanded",              // or inline State under "initialState"
  "commands": [
    { "type": "Collapse", "folder": "/tmp/vault/tasks/" },
    { "type": "Expand",   "folder": "/tmp/vault/tasks/" }
  ],
  "expected": {
    "finalSnapshot":  "010-one-folder-expanded",     // OPTIONAL: sameness assertion
    "revisionDelta":  2,                              // OPTIONAL: monotonic check
    "deltas": [                                       // OPTIONAL: assert per-step Delta
      { "revision": 1, "collapseAdded":   ["/tmp/vault/tasks/"] },
      { "revision": 2, "collapseRemoved": ["/tmp/vault/tasks/"] }
    ]
  }
}
```

`initial` is EITHER a reference to a snapshot file (by ID, no extension) OR an
inline `initialState` with the same shape as the snapshot's `.state`.

`expected` fields are all OPTIONAL; tests assert whichever subset they care
about. A command-level equivalence test might assert only `deltas`; a round-
trip test might assert only `finalSnapshot`.

## Projection file — `projections/<id>.json` (optional)

```jsonc
{
  "$schema": "graph-state/projection@1",
  "id": "010-one-folder-expanded",
  "sourceSnapshot": "010-one-folder-expanded",
  "elementSpec": {
    "nodes": [ { "id": "/tmp/vault/tasks/",       "kind": "folder", "data": {} },
               { "id": "/tmp/vault/tasks/BF-117.md", "parent": "/tmp/vault/tasks/",
                 "kind": "node", "label": "BF-117", "data": {} } ],
    "edges": [],
    "revision": 0
  }
}
```

Used by BF-143 (golden) and BF-153 (parity). Regenerate whenever project()
behavior intentionally changes (commit the diff as part of the PR).

## Loader contract (20-line sketch; impl in BF-141 or BF-142)

```ts
// Loader returns runtime State with Set/Map/Option rehydrated.
export function loadSnapshot(path: string): State
export function loadSequence(path: string): { initial: State; commands: readonly Command[]; expected: ExpectedSpec }
export function loadProjection(path: string): ElementSpec
```

Trivial: read file, `JSON.parse`, walk known fields, convert arrays→Set/Map.
No schema validator needed at v1; rely on TS types + a narrow test at
`packages/graph-state/tests/fixture-loader.test.ts`.

## Mandatory fixture coverage (for BF-141)

At minimum, BF-141 must produce:
1. **2 empty-ish cases** — empty state, single-node state.
2. **2 flat cases** — 3-node + 5-node, no folders.
3. **4 folder cases** — one folder expanded, same folder collapsed,
   two sibling folders, nested folders with the inner one collapsed.
4. **2 F6 aggregation cases** — external → folder/, folder/ → external,
   both verifiable against `computeSyntheticEdgeSpecs`.
5. **9 single-command sequences** — one per applyCommand variant
   (Collapse, Expand, Select, Deselect, AddNode, RemoveNode, AddEdge,
   RemoveEdge, Move). Each starts from a named snapshot.
6. **2 round-trip sequences** — Collapse+Expand, Select+Deselect.
7. **1 multi-command sequence** — LoadRoot → AddNode → Collapse → Select,
   for command-equivalence testing (BF-154).

Total ≥ 20 fixtures. Naming: `<category-prefix>-<slug>.json`.

## Stability & determinism

- All arrays derived from Sets/Maps MUST be sorted.
- Synthetic edge IDs (F6) are already deterministic (`computeSyntheticEdgeSpecs`).
- Timestamps MUST be omitted from `meta.mutatedAt` in fixtures (only
  live-app snapshots include it).
- Byte-exact equality is the primary assertion. A fixture diff in review is
  a meaningful review artifact.

## Versioning

- `$schema` fields are namespaced (`graph-state/snapshot@1`). Additive
  changes keep `@1`; breaking changes increment.
- Fixture files carry their version; the loader refuses unknown majors.

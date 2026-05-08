# graph-state fixtures

These fixtures implement BF-141 on top of the BF-138 format in [fixture-format.md](../fixture-format.md). The loader lives at [src/fixtures.ts](../src/fixtures.ts) and is re-exported from `@vt/graph-state`.

Loader entrypoints:

```ts
import { loadFixture, loadSequence, loadSnapshot } from '@vt/graph-state'
```

What is committed here:

- `snapshots/` contains canonical serialized `State` inputs for `project()`
- `sequences/` contains canonical serialized command sequences for `applyCommand()`
- `projections/` is reserved for BF-143 and later; BF-141 leaves it empty

Naming and lookup:

- Files keep their numeric prefix for stable ordering, for example `021-nested-folder.json`
- `loadFixture()` accepts either the full ID (`021-nested-folder`) or the alias without the numeric prefix (`nested-folder`)

Coverage highlights:

- Snapshots include empty, single-node, flat, folder, nested-folder, all-collapsed, mixed-collapse, with-selection, with-layout-positions, context-node, and real-vault cases
- Sequences cover all 11 command variants plus round-trip and multi-command flows
- The real-vault fixture is sourced from `brain/working-memory/tasks/folder-nodes` but canonicalized to `/tmp/graph-state-fixtures/real-vault-folder-nodes` so the committed JSON stays stable across machines

Verification scripts:

- `scripts/fixture-smoke.ts`
- `scripts/fixture-command-coverage.ts`
- `scripts/fixture-field-coverage.ts`
- `scripts/fixture-vault-roundtrip.ts`

Manual CLI spot checks:

```bash
jq '{id, collapseSet: .state.collapseSet, selection: .state.selection, positionCount: (.state.layout.positions | length)}' \
  packages/graph-state/fixtures/snapshots/040-mixed-collapse.json

jq '{id, unresolvedLinksIndex: .state.graph.unresolvedLinksIndex}' \
  packages/graph-state/fixtures/snapshots/041-context-node-unresolved-link.json

jq '{id, commands: [.commands[].type], expected: .expected}' \
  packages/graph-state/fixtures/sequences/113-multi-command-load-add-collapse-select.json

npx tsx -e "import { loadFixture } from './packages/graph-state/src/index.ts'; console.log(loadFixture('nested-folder').state.roots.folderTree.length)"
```

The four scripted checks are the automated form of those same shell-level checks: load everything, verify command coverage, verify populated state fields, and round-trip the canonicalized real-vault fixture.

Regeneration:

```bash
npx tsx packages/graph-state/scripts/generate-fixtures.ts
```

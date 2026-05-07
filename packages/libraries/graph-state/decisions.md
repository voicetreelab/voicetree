# BF-138 Decisions — Unified data-layer contract

> Context: cytoscape-ui-decoupling epic (BF-104 Phase 4). Contract designed at L0-A. All decisions numbered; implementation lands L1. Style mirrors `folder-nodes/design.md`.

## Context

- North-star: `vt-graph live view --collapse tasks --select BF-117` against a running Electron app returns ASCII that is semantically identical to what the human sees. Both paths go through the same data layer.
- Parent: `packages/graph-model/` owns pure graph primitives today (Graph, GraphNode, GraphDelta, FolderTreeNode, folderCollapse helpers). We build ON TOP of it — no duplication of Graph types.
- F6 aggregation (folder-nodes/design.md decision 3) is a law: project() on a State with a non-empty collapseSet must emit synthetic edges matching `computeSyntheticEdgeSpecs` (@vt/graph-tools/folderCollapse).

## Decision 0 — Package location: NEW `@vt/graph-state`, not graph-model extension

**Decision.** Contract lives in a new package `packages/graph-state/`.

**Rationale.** `@vt/graph-model` is already wide: filesystem watchers, settings IO, project management, ripgrep search, vault allowlist, etc. Adding "unified State + Command + projection" to it would further confuse the layer boundary. `@vt/graph-state` sits strictly between graph-model (pure Graph) and the cytoscape shell, and it is a pure state-machine module. It depends on graph-model for the underlying types but adds no FS coupling. L1 tasks (BF-142..BF-163) already assume this name.

**Alternatives considered.**
- Reuse `@vt/graph-model` — rejected: muddles layers; graph-model's scope is FS ↔ Graph, not UI-state.
- Reuse `@vt/graph-tools` — rejected: graph-tools is a CLI surface; it depends on graph-state conceptually, not vice versa.
- New `@vt/graph-view` — rejected: name implies rendering; graph-state is pre-projection.

## Decision 1 — Selection lives in State (not render-only)

**Decision.** `State.selection: ReadonlySet<NodeIdAndFilePath>`.

**Rationale.** The north-star case `vt-graph live view --select BF-117` requires the CLI to dispatch a Select command that the running app's projection honors. If selection lives in the cytoscape shell only, a CLI caller cannot drive it. Putting selection in State also lets Playwright tests assert selection via snapshot diff instead of DOM queries.

**Alternatives considered.**
- Render-only selection (cytoscape-owned) — rejected: breaks CLI-drives-UI story; today's divergence between cy-state and logical-state is the exact bug we're trying to kill.
- Per-shell selection with state mirror — rejected: two truths → same divergence class.

## Decision 2 — Layout in State, with explicit persistence boundary

**Decision.** `State.layout` holds `positions: ReadonlyMap<id, Position>`, `zoom?`, `pan?`, `fit?`. Positions are authoritative; zoom/pan/fit are OPTIONAL and MAY be rehydrated from a shell-local store.

**Rationale.** Positions are already persisted on disk (`.positions.json`) and the sidebar / editor mirror them today. Moving them into State gives the CLI a reason to exist (`vt-graph live view` can render positioned ASCII / Mermaid with real coordinates). Zoom/pan/fit are less useful over IPC but cheap to carry; marking them optional keeps shells free to ignore them.

**Alternatives considered.**
- Layout 100% render-only — rejected: CLI cannot reproduce what the user sees; fails north-star.
- Layout 100% persisted including zoom — rejected: user-visible flicker from IPC lag if we try to drive zoom via Delta. Keep zoom ephemeral-but-snapshot-readable.

## Decision 3 — Hover is render-only (NOT in State)

**Decision.** Hover is absent from `State`. It remains a shell-local concern (cytoscape listens to `mouseover`, toggles classes).

**Rationale.** Hover fires dozens of times per second on move; routing it through State+Delta+IPC is needless latency and no consumer needs it outside the shell. The CLI has no cursor.

**Alternatives considered.**
- Hover-in-State — rejected for cost; render-only is the default render-layer concern and there is no cross-consumer use case.

## Decision 4 — Change-notification model: subscribe-with-delta (primary) + snapshot-with-token (secondary)

**Decision.** Primary: shells subscribe to a `(delta: Delta) => void` stream; each delta carries a monotonic `revision` and the triggering `Command`. Secondary: stateless consumers (CLI) call `getLiveState()` + compare `state.meta.revision` via `ChangeToken` to decide whether to re-poll.

**Rationale.**
- Deltas are compact and preserve the same delta-type shape the UI already renders (`applyGraphDeltaToUI`). Reuses `GraphDelta` for node/edge mutation; adds thin fields for collapseSet / selection / roots / positions. Zero new concepts for the existing shell.
- Tokens suit the CLI: one-shot `vt-graph live view` doesn't want a subscription, just "what is true now." Token comparison gates re-poll without maintaining state.
- Both modes are expressible over a single IPC channel — `subscribeLive` is OPTIONAL on `LiveTransport`, so a CLI that only needs snapshots never pays for streaming.

**Alternatives considered.**
- Pure snapshot + diff by consumer — rejected: forces every UI to deep-diff Graph on every frame; wastes cycles; loses Command attribution.
- Pure event log (Redux-style) — rejected: equivalent information to delta, but forces consumers to re-project; throws away the `project()` seam we want.
- Reactive observables (RxJS) — rejected: heavy dep for what is effectively "fn(delta)". Shells can wrap as needed.

## Decision 5 — IPC transport: MCP (v1), transport-agnostic `LiveTransport`

**Decision.** v1 ships over MCP (we already run an MCP server at port 3002 for agent tools). The contract defines `LiveTransport` as a plain interface; swapping to unix socket or HTTP later does not break L1 consumers.

**Rationale.**
- MCP is already wired end-to-end (VOICETREE_MCP_PORT=3002). Adding two tools (`getLiveState`, `dispatchLiveCommand`) is small and reuses agent auth.
- File-based transport (write snapshot to disk, re-read) — too slow for delta streaming; stale reads likely; loses revision ordering.
- Unix socket / HTTP — more setup; useful later if we need cross-process performance.
- The `LiveTransport` seam is the indirection. An L1 agent swapping transports changes one file.

**Alternatives considered.**
- File-only transport — rejected: can't stream deltas, stale reads guaranteed.
- Raw stdin/stdout — rejected: conflicts with electron child-process management.
- gRPC — rejected: transport heavy for single-user desktop app.

## Decision 6 — Persistence boundary (per-field)

**Decision.** What survives app restart:

| Field                     | Persists? | Where                                      |
|---------------------------|-----------|--------------------------------------------|
| `graph` (nodes + edges)   | Yes       | Filesystem (markdown is source of truth)   |
| `roots.loaded`            | Yes       | `voicetree-config.json` lastDirectory      |
| `collapseSet`             | Yes       | Existing collapseState store (unchanged)   |
| `selection`               | No        | Session-only                               |
| `layout.positions`        | Yes       | Existing `.positions.json` (unchanged)     |
| `layout.zoom` / `pan`     | No        | Session-only (may be cached per-vault L2)  |
| `layout.fit`              | No        | Ephemeral                                  |
| `meta.revision`           | No        | Resets to 0 on startup                     |

**Rationale.** Mirrors existing behavior exactly; no migration needed at L1. L2 may add per-vault zoom persistence — that is additive (new optional field), doesn't break v1 consumers.

**Alternatives considered.**
- Persist selection across restart — rejected: UX noise; users don't expect it.
- Persist revision — rejected: revision is an in-memory optimisation; cross-session it is meaningless.

## Decision 7 — Additive-friendly rules (how L1 extends safely)

**Decision.** The contract may be extended in these ways WITHOUT rebumping major version / re-spawning L0-A:
1. Add a new Command variant to the `Command` union (discriminated by `type`).
2. Add a new OPTIONAL field to `State`, `Delta`, `NodeElement`, `EdgeElement`, `StateLayout`.
3. Add a new method to `LiveTransport` marked optional.
4. Add a new `kind` value to `NodeElement.kind` / `EdgeElement.kind` behind a forward-compat fallback.

Breaking-change scenarios that DO require a v2 amendment task (new L0 card):
- Changing a REQUIRED field's type.
- Removing or renaming a Command type discriminator.
- Changing the `project()` return shape.

**Rationale.** L1 spawns ~18 agents in parallel; forcing every additive change through the L0 queue would stall the epic. Restricting additivity to "new optional fields / new union arms" keeps existing consumers forward-compatible.

## Decision 8 — `project()` return shape is cytoscape-neutral but cytoscape-shaped

**Decision.** `ElementSpec` has `nodes: NodeElement[]` + `edges: EdgeElement[]`, mirroring cytoscape's `ElementDefinition` keys (`id`, `parent`, `source`, `target`, `data`, `position`, `classes`) but typed in @vt/graph-state, not against `@types/cytoscape`.

**Rationale.** Two consumers:
- cytoscape shell wants `cy.add(elementSpec.nodes.concat(elementSpec.edges))` to Just Work. Shape match avoids a per-element adapter.
- CLI wants the same list to ASCII-format or JSON-dump. Neutral typing means the CLI doesn't pull in cytoscape or @types/cytoscape.
The `kind` field is our own — cytoscape has no notion of "folder-collapsed"; we need it for CLI glyph selection (▣/▢/⊟) without reconstructing from `classes`.

**Alternatives considered.**
- Return `cytoscape.ElementDefinition[]` directly — rejected: pulls cytoscape type dep into graph-state, violates decoupling.
- Return Graph + deriving-in-shell — rejected: duplicates folderCollapse / F6 logic per shell. The whole point of project() is one place.

## Open questions (defaulted; revisit as L1 lands)

1. **Does project() memoize across revisions?** Default: NO at the contract level; BF-143 may add a memoized wrapper. Consumers must not assume identity stability.
2. **Should Delta carry inverse for undo?** Default: NO; we have `@vt/graph-model` undo-store today, don't duplicate. Revisit if L2 moves undo into graph-state.
3. **Should `Select` with `additive: undefined` replace (default) or add?** Default: REPLACE when `additive !== true`. Mirrors cytoscape default click behavior.
4. **Are folder entities part of `State.graph` or derived?** Default: DERIVED inside `project()` from `collapseSet` + `roots.folderTree`; `State.graph.nodes` stays as today (file-path node IDs only). Keeps graph-model's invariants intact.

## Appendix A — Consumer walkthrough (cytoscape shell)

```ts
// ≤30 lines; no layer-crossing (no cy.* outside project() seam)
import type { State, Command, Delta, ElementSpec, LiveTransport, GraphStateAPI } from '@vt/graph-state'
import type { Core } from 'cytoscape'

export function mountCytoscape(cy: Core, api: GraphStateAPI, live: LiveTransport): () => void {
    // 1. Hydrate from live snapshot.
    let state: State
    live.getLiveState().then((s) => {
        state = s
        const spec: ElementSpec = api.project(state)
        cy.add([...spec.nodes, ...spec.edges])
    })

    // 2. Shell dispatches user gestures AS commands. Never touches cy.* for state.
    cy.on('tap', 'node', (e) => {
        const id = e.target.id()
        const cmd: Command = { type: 'Select', ids: [id] }
        live.dispatchLiveCommand(cmd) // server is source of truth
    })

    // 3. Re-render on delta.
    let unsub: () => void = () => {}
    live.subscribeLive?.((d: Delta) => {
        state = applyShellMirror(state, d)               // thin local mirror
        const spec: ElementSpec = api.project(state)
        cy.batch(() => reconcile(cy, spec))              // shell-local diff
    }).then((u) => { unsub = u })

    return () => unsub()
}
```

## Appendix B — Consumer walkthrough (`vt-graph live view`)

```ts
// ≤30 lines; stateless, no subscription
import type { State, Command, ElementSpec, LiveTransport, GraphStateAPI } from '@vt/graph-state'

export async function liveView(
    api: GraphStateAPI, live: LiveTransport,
    flags: { readonly collapse: readonly string[]; readonly select: readonly string[] }
): Promise<string> {
    // 1. Drive any pre-view state mutations through the live server.
    for (const f of flags.collapse)  await live.dispatchLiveCommand({ type: 'Collapse', folder: f })
    if (flags.select.length > 0)    await live.dispatchLiveCommand({ type: 'Select',   ids: flags.select })

    // 2. Snapshot current state and project to elements.
    const state: State = await live.getLiveState()
    const spec:  ElementSpec = api.project(state)

    // 3. Render ASCII from the neutral spec. No cytoscape, no DOM.
    return renderAscii(spec)
}
```

Both consumers touch `State` / `Command` / `ElementSpec` only — no `cy.*` leaks on the CLI side, no `fs.*` or Graph-internal leaks on either side.

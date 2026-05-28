## Context

VoiceTree's webapp renders a cytoscape graph of context nodes plus floating terminal windows anchored to specific nodes via `attachedToContextNodeId`. The top-left `TerminalTreeSidebar` is an independent view subscribed directly to `TerminalStore`; its tree structure mirrors agent parent/child, not folder structure.

Folder collapse already flows through:
1. `graph-state` projection (`packages/libraries/graph-state/src/project.ts`) computes the visible graph by applying `filterByCollapse(folders, state.collapseSet, state.graph.nodes)`. Nodes inside a collapsed folder are flagged `hiddenByCollapse: true` and elided from the projected node list.
2. `webapp/src/shell/edge/UI-edge/graph/view/folderCollapse.ts` calls `applyGraphDeltaToUI` whenever the user toggles a folder.
3. `applyGraphDeltaToUI` updates the cytoscape DOM — but it does *not* know about floating-window terminals.

The visual gap: floating terminal windows are absolutely-positioned DOM elements layered above the cytoscape canvas. They are not cytoscape nodes, so the projection's hide/show pass never touches them. After a collapse, the floating window remains where its anchor used to be, hovering over an empty canvas region.

## Goals / Non-Goals

**Goals:**
- Floating terminal windows whose anchor context node is currently `hiddenByCollapse` are visually hidden (CSS only).
- Folder re-expand restores those floating windows to their prior position/size/minimized state.
- Activating a hidden terminal from the sidebar auto-expands the ancestor collapsed folder so the window is reachable.
- `TerminalStore` and `AgentTabsStore` are *not* mutated by collapse — the sidebar tree remains stable.
- "Anchor truly deleted" continues to close the terminal (existing behavior, not altered).

**Non-Goals:**
- Reflecting terminal visibility in the projected graph model (`graph-state`) itself. Floating windows stay a UI-layer concern.
- Repositioning or reflowing floating windows when their anchor is hidden — only display:none, position is preserved.
- Persisting "hidden-by-collapse" across app restarts (the collapseSet persists; visibility is derived).
- Anything about the in-canvas headless badge / minimized-on-node-glyph (orthogonal feature, already collapse-aware via cytoscape).

## Decisions

### D1. Hide via CSS `display: none` on the floating window root, not via store removal

**Choice:** Toggle `style.display` on the floating window root element when its anchor enters/leaves the collapsed set. Do not touch `TerminalStore`.

**Rationale:**
- Keeps `TerminalTreeSidebar` correct for free (it subscribes to `TerminalStore`).
- Preserves window position, size, scroll state, xterm buffer, and DOM identity — no teardown/rebuild cost on every folder toggle.
- Single source of truth for "is this floating window currently visible?": derived from the projection, not stored.

**Alternatives considered:**
- *Remove from `TerminalStore` on collapse, re-add on expand.* Rejected — would clear the sidebar entry, breaking the requested behavior, and would force full window teardown/re-create (loss of buffer state).
- *Move floating window into a hidden DOM container.* Rejected — adds DOM-tree manipulation for no observable gain over `display: none`.

### D2. Drive the sync from `folderCollapse.ts` after `applyGraphDeltaToUI`

**Choice:** Add a `syncFloatingTerminalVisibilityFromProjection(projectedGraph)` step invoked from the same call sites that already invoke `applyGraphDeltaToUI` on folder toggle (and any future projection-change call site).

**Rationale:**
- The projection already encodes the answer (`hiddenByCollapse` + which nodes survive `filterByCollapse`). Reusing it avoids re-deriving "is this node inside a collapsed ancestor?" anywhere else.
- Co-locating the visibility sync with the existing collapse-driven re-render means we cannot drift — every code path that triggers collapse-projection will also trigger floating-window sync.
- No new subscription, no new event bus.

**Alternatives considered:**
- *Subscribe floating windows directly to `folderVisibilityStore` / `collapseSet`.* Rejected — pushes folder-state knowledge into the per-window code, and risks ordering bugs where the window reacts before the cytoscape view does.
- *Project floating windows into `graph-state` as first-class entities.* Rejected — pushes a UI-only concern into a shared model package; not worth the surface area until a second consumer exists.

### D3. "Hidden by collapse" vs "node deleted" comes from the projection signal, not from absence in the cy view

**Choice:** Determine "hidden by collapse" via the projection's `hiddenByCollapse: true` (or equivalent: the node exists in `state.graph.nodes` but not in the projected nodes after `filterByCollapse`). "Truly deleted" means the node is absent from `state.graph.nodes` entirely.

**Rationale:**
- Hiding a floating window whose anchor was just deleted from the vault would silently leak the window. Existing terminal-close path must keep firing.
- The model layer already makes this distinction cleanly; the UI just consumes it.

**Alternatives considered:**
- *Treat "node not in cytoscape" as the sole signal.* Rejected — conflates deletion with collapse, leading to stranded floating windows for genuinely deleted nodes.

### D4. Sidebar click on a hidden-by-collapse terminal auto-expands its ancestor folder

**Choice:** In `TerminalTreeSidebar`'s select handler, after `restoreTerminal` / minimize handling, check whether the terminal's `attachedToContextNodeId` is currently hidden by collapse. If so, dispatch a folder-expand command for the nearest collapsed ancestor before navigating.

**Rationale:**
- The user clicked a sidebar row to *reach* that terminal. Silently leaving the window hidden produces a click-with-no-feedback bug.
- Restoring the window without expanding the folder would leave a floating window over an empty canvas region — exactly the bug we are fixing.
- Auto-expand maintains the "the sidebar always navigates you to the thing" invariant.

**Alternatives considered:**
- *Leave hidden — just gold-outline the row.* Rejected per above.
- *Restore window only.* Rejected — re-introduces the orphaned-window problem.
- *Prompt the user.* Rejected — adds friction; the user already expressed intent by clicking.

### D5. Restore on expand uses the terminal's prior minimized state, not "always visible"

**Choice:** When a folder expands and a previously hidden floating window becomes eligible, restore the element to its pre-hide state: if `isMinimized` was true, keep the minimized glyph; otherwise show the floating window.

**Rationale:** Minimization is an orthogonal user choice. Folder expand should not un-minimize.

## Risks / Trade-offs

- **Risk: ordering bug between cytoscape DOM update and floating window display toggle.** → Run the floating-window sync *after* `applyGraphDeltaToUI` completes in the same call (synchronous), so the user never sees a frame with anchor-present-but-window-hidden or vice versa.
- **Risk: floating window references a stale anchor element after a layout change while hidden.** → On show-from-hidden, re-resolve the anchor position from the projection before unhiding (existing anchoring code should already handle this on `restoreTerminal`; verify in implementation).
- **Risk: ancestor-folder auto-expand from sidebar triggers a flurry of projection updates if multiple ancestors are collapsed.** → Compute the minimal set of folders to expand (the chain of collapsed ancestors up to the first expanded one), then issue a single batch expand if `setFolderStateBatch` is available; otherwise issue them in one transaction.
- **Trade-off: visibility is derived, not stored.** Means a future bug in the projection silently affects window visibility. Acceptable because the alternative (storing it) creates the source-of-truth split that JOINT-4 already demonstrated is harmful.

## Open Questions

(Resolved by the proposal, listing for completeness — none currently blocking.)

- ~~Should sidebar click auto-expand the folder?~~ → **Yes** (D4).
- ~~Should folder expand auto-un-minimize a previously-minimized window?~~ → **No** (D5).
- ~~Should we hide via `display:none` or DOM-detach?~~ → **`display:none`** (D1).

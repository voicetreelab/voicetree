## Why

When a user collapses a folder in the graph view, its context nodes disappear from the projected cytoscape graph, but the floating-window terminals anchored to those nodes via `attachedToContextNodeId` stay rendered over the now-empty canvas region. The result is orphaned terminal windows floating without a visible anchor, which is visually confusing and clutters the workspace.

The top-left `TerminalTreeSidebar` is *correctly* decoupled from graph visibility — it reads `TerminalStore` directly and keys its tree off agent parent/child relationships. We want that sidebar to keep showing every terminal so the user never loses access. The only thing to fix is the *canvas-floating* representation.

## What Changes

- Floating terminal windows whose `attachedToContextNodeId` resolves to a context node currently hidden-by-collapse are visually hidden (CSS `display: none` on the floating window element). The terminal record in `TerminalStore` is **not** touched.
- When the user expands the parent folder again, the floating window auto-restores to its previous state (position, size, minimized-or-not).
- When the user activates such a hidden terminal from the sidebar, the parent folder is auto-expanded so the window becomes visible at its anchor.
- The hide/show toggle is driven from the same projection-delta seam that already reacts to folder-collapse (`applyGraphDeltaToUI` flow), using the projection's `hiddenByCollapse` signal to distinguish "anchor hidden by collapse" from "anchor truly deleted" (which keeps existing terminal-close behavior).

## Capabilities

### New Capabilities
- `floating-terminal-folder-visibility`: governs the projection-driven visibility of floating-window terminals whose anchor context node sits inside a collapsed folder. Covers the hide-on-collapse, restore-on-expand, sidebar-click-auto-expand behaviors, and the distinction from anchor deletion.

### Modified Capabilities
<!-- No existing specs in repo yet; nothing to modify. -->

## Impact

- **Code**: primarily `webapp/src/shell/edge/UI-edge/graph/view/folderCollapse.ts` (new visibility sync step) and a small helper in `webapp/src/shell/edge/UI-edge/floating-windows/terminals/` to toggle floating-window display. Read-only consumers: `TerminalStore` (lookup by `attachedToContextNodeId`), `graph-state` projection (`hiddenByCollapse`).
- **No store mutation**: `TerminalStore` and `AgentTabsStore` remain unchanged so `TerminalTreeSidebar` is untouched.
- **Sidebar UX**: clicking a row whose terminal is currently hidden-by-collapse must trigger a folder-expand action (new wire-up from sidebar select handler).
- **No new packages, no schema changes, no IPC contract changes.**

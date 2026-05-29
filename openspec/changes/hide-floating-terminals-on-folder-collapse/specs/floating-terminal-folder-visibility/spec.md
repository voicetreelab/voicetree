## ADDED Requirements

### Requirement: Hide floating terminal window when its anchor context node is hidden by folder collapse

The system SHALL set the floating window root element to `display: none` (or equivalent CSS hide) for every terminal whose `attachedToContextNodeId` resolves to a context node that is currently `hiddenByCollapse: true` in the graph projection. The terminal's record in `TerminalStore` SHALL NOT be removed or otherwise mutated by this hide.

#### Scenario: User collapses a folder containing a terminal-anchored context node
- **WHEN** the user collapses a folder that contains a context node `N`, and a terminal `T` exists with `T.attachedToContextNodeId === N.id`
- **THEN** `T`'s floating window root element has `display: none`
- **AND** `T` is still present in `TerminalStore.getTerminals()`
- **AND** `T` is still rendered as a row in `TerminalTreeSidebar`

#### Scenario: Already-hidden terminal in a folder that gets collapsed
- **WHEN** terminal `T` is minimized (badge on node) and the user collapses the folder containing `T`'s anchor
- **THEN** the minimized badge for `T` is also hidden along with the cytoscape node
- **AND** `T.isMinimized` remains true in store state (no change)

### Requirement: Restore floating terminal window when its anchor folder expands

The system SHALL restore the prior visibility of any floating window whose anchor context node transitions from `hiddenByCollapse: true` to visible in the projection. "Prior visibility" means: if the terminal was minimized before the collapse, keep it minimized; otherwise show the floating window.

#### Scenario: Folder expands and reveals a previously-floating terminal
- **WHEN** terminal `T` had a visible (non-minimized) floating window before its anchor's folder was collapsed
- **AND** the user expands that folder
- **THEN** `T`'s floating window root element has its `display` style restored (visible)
- **AND** `T`'s anchored position re-resolves correctly relative to the now-visible cytoscape node

#### Scenario: Folder expands and reveals a previously-minimized terminal
- **WHEN** terminal `T` was minimized (badge on node) before its anchor's folder was collapsed
- **AND** the user expands that folder
- **THEN** `T`'s minimized badge is visible on the now-visible cytoscape node
- **AND** the floating window itself remains hidden (minimized state preserved)

### Requirement: Distinguish "hidden by collapse" from "anchor deleted"

The system SHALL hide a floating window only when its anchor is `hiddenByCollapse`, not when the anchor is absent from `state.graph.nodes` entirely. Anchor-deleted terminals continue to follow the existing terminal-close path.

#### Scenario: Anchor context node is deleted from the project
- **WHEN** a context node `N` is removed from `state.graph.nodes` (file deleted, not folder collapsed)
- **AND** a terminal `T` had `T.attachedToContextNodeId === N.id`
- **THEN** `T` follows the existing close path (closeTerminalById / equivalent)
- **AND** `T` is NOT merely hidden via `display: none`

### Requirement: TerminalStore and AgentTabsStore remain untouched by collapse-driven visibility changes

The system SHALL NOT remove, re-key, or reorder entries in `TerminalStore` or `AgentTabsStore` in response to folder collapse or expand events. Sidebar membership, badges, activity counts, and active-terminal selection are unaffected.

#### Scenario: Collapse does not change sidebar row count
- **WHEN** the user collapses any folder
- **THEN** `getTerminals().size` is unchanged
- **AND** the rendered rows in `TerminalTreeSidebar` are unchanged in identity, order, and active highlight

### Requirement: Clicking a hidden-by-collapse terminal in the sidebar auto-expands its ancestor folder(s)

When the user activates a terminal `T` from `TerminalTreeSidebar` and `T`'s anchor context node is currently hidden by collapse, the system SHALL expand the minimal set of collapsed ancestor folders required to make the anchor visible, then proceed with the normal activation (restore + navigate).

#### Scenario: Sidebar click on a terminal hidden by single collapsed folder
- **WHEN** terminal `T`'s anchor sits inside folder `F`, `F` is collapsed, and the user clicks `T`'s row
- **THEN** folder `F` is expanded (folderVisibilityStore + projection updated)
- **AND** `T`'s floating window is restored to its prior (visible/minimized) state
- **AND** `T` is set as the active terminal and the graph view navigates to it

#### Scenario: Sidebar click on a terminal hidden by nested collapsed folders
- **WHEN** terminal `T`'s anchor sits inside `F1 > F2`, both `F1` and `F2` are collapsed, and the user clicks `T`'s row
- **THEN** both `F1` and `F2` are expanded (batch if `setFolderStateBatch` is available)
- **AND** `T` becomes visible per the single-folder scenario above

### Requirement: Visibility sync runs synchronously with collapse-driven projection updates

The floating-window visibility sync SHALL run synchronously in the same call frame as `applyGraphDeltaToUI` when the trigger is a folder-collapse projection update, so the user never observes a frame in which the cytoscape node is visible but its floating window is hidden, or vice versa.

#### Scenario: No flicker on collapse
- **WHEN** the user collapses a folder
- **THEN** between the pre-collapse frame and the post-collapse frame, no intermediate frame shows the cytoscape node hidden with its floating window still visible (or vice versa)

/**
 * BEHAVIORAL SPEC — folder-state enum bug: "new folder renders EXPANDED yet invisible".
 *
 * Black-box regression for the file-tree sidebar's graph-collapse affordance.
 *
 * A folder that is UNLOADED (the "new folders unloaded by default" gate) has no
 * presence in the graph, so it has no expand/collapse state. The sidebar's
 * graph-collapse icon is a binary derived purely from the collapsed-folder set:
 * a folder not in that set paints the `expanded` class. Before the fix the icon
 * rendered for unloaded folders too, so an unloaded folder visibly read
 * "expanded in graph" while appearing nowhere in the graph — the exact
 * "expanded yet invisible" contradiction the user reported.
 *
 * Fix: FolderTreeNode.tsx gates the graph-collapse icon on `loadState === 'loaded'`.
 *
 * This spec proves the black box end-to-end:
 *   1. an unloaded child folder shows the not-loaded indicator but NO graph-collapse icon;
 *   2. after loading it, the graph-collapse icon appears — so the affordance is
 *      gated on load state, not removed outright.
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import {
    test,
    expect,
    folderRow,
    expandFolderIfNeeded,
} from './electron-filetree-load-child.fixtures';
import { clickVisibleElementCenter, openFolderTreeSidebar } from './folder-spec-e2e-helpers';

test('an unloaded folder shows no graph collapse/expand icon until it is loaded', async ({ appWindow, fixture }) => {
    await openFolderTreeSidebar(appWindow);
    await expandFolderIfNeeded(appWindow, fixture.projectPath, fixture.parentPath);
    await expandFolderIfNeeded(appWindow, fixture.parentPath, fixture.childPath);

    const childRow = folderRow(appWindow, fixture.childPath);
    const loadIndicator = childRow.locator('.folder-tree-load-indicator');
    const graphCollapseIcon = childRow.locator('.folder-tree-graph-collapse-icon');

    // Precondition: the child folder is present in the sidebar but UNLOADED.
    await expect(childRow).toBeVisible();
    await expect(childRow.locator('.folder-tree-load-indicator.not-loaded')).toBeVisible();

    // CORE REGRESSION: an unloaded folder has no graph presence, so it must not
    // offer a graph collapse/expand affordance (which would default to "expanded").
    await expect(graphCollapseIcon).toHaveCount(0);

    // Positive control: load the folder, then the affordance appears — proving
    // the icon is gated on load state rather than globally suppressed.
    await clickVisibleElementCenter(appWindow, loadIndicator);
    await expect(childRow.locator('.folder-tree-load-indicator.loaded')).toBeVisible({ timeout: 15000 });
    await expect(graphCollapseIcon).toHaveCount(1);
});

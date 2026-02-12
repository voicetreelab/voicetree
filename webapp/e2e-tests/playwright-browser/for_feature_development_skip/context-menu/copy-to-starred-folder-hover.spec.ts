/**
 * E2E tests for "Copy to..." (Add to Starred Folder) feature
 *
 * Tests that:
 * - 1: "More" submenu appears with "Copy to..." option on hover
 * - 2: Hovering "Copy to..." shows nested submenu with starred folders
 * - 3: Starred folder items are clickable and trigger copy action
 *
 * BUG REPRODUCTION: The "Copy to..." item has getSubMenuItems for dynamically
 * loading starred folders, but createSubMenuElement in menuItemDom.ts does NOT
 * handle nested submenus (items with getSubMenuItems inside a submenu).
 * The hover handler that loads and shows dynamic submenus is only wired up
 * in createHorizontalMenuElement (top-level items), not in createSubMenuElement.
 */

import { test, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  selectMockProject,
  sendGraphDelta,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils';
import type { GraphDelta } from '@/pure/graph';

/** Starred folders returned by the mock */
const MOCK_STARRED_FOLDERS: readonly string[] = [
  '/Users/test/Documents/project-a',
  '/Users/test/Documents/project-b',
  '/Users/test/Documents/notes',
];

test.describe('Copy to Starred Folder', () => {
  test.beforeEach(async ({ page }) => {
    // Set up mock Electron API with starred folder support
    await setupMockElectronAPI(page);

    // Patch in the starred folders mock methods (not in default mock)
    await page.addInitScript((folders: readonly string[]) => {
      const api = (window as unknown as { electronAPI: {
        main: Record<string, unknown>;
      } }).electronAPI;
      if (api?.main) {
        api.main.getStarredFolders = async (): Promise<readonly string[]> => folders;
        api.main.copyNodeToFolder = async (
          _nodeId: string,
          _folder: string,
        ): Promise<{ success: boolean; targetPath: string }> => ({
          success: true,
          targetPath: `${_folder}/copied-node.md`,
        });
      }
    }, MOCK_STARRED_FOLDERS as string[]);

    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);

    // Add a test node to the graph
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'copy-to-test.md',
          contentWithoutYamlOrLinks: '# Copy To Test\nThis node tests the copy-to starred folder feature.',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 500, y: 300 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false,
          },
        },
        previousNode: { _tag: 'None' } as const,
      },
    ];
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(100);
  });

  /**
   * Helper: open the horizontal menu by hovering over the test node
   */
  async function openNodeHoverMenu(page: import('@playwright/test').Page): Promise<void> {
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#copy-to-test.md');
      if (node.length === 0) throw new Error('Node not found');
      node.emit('mouseover');
    });
    await page.waitForTimeout(300);
  }

  /**
   * Helper: hover over the "More" button (2nd item in right group)
   * and wait for its static submenu to appear
   */
  async function hoverMoreButton(page: import('@playwright/test').Page): Promise<void> {
    // The "More" button is the 2nd item in the right group (after "Run")
    const moreButtonPos = await page.evaluate(() => {
      const rightGroup = document.querySelector('.horizontal-menu-right-group');
      if (!rightGroup) return null;
      // More button is the second child div (first is Run)
      const children = rightGroup.querySelectorAll(':scope > div');
      // Run is index 0, More is index 1
      const moreContainer = children[1] as HTMLElement | undefined;
      if (!moreContainer) return null;
      const rect = moreContainer.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });

    expect(moreButtonPos).not.toBeNull();
    await page.mouse.move(moreButtonPos!.x, moreButtonPos!.y);
    await page.waitForTimeout(200);
  }

  // Test 1: "More" submenu shows "Copy to..." option
  test('should show "Copy to..." in More submenu on hover', async ({ page }) => {
    await openNodeHoverMenu(page);
    await hoverMoreButton(page);

    // Verify the More submenu is visible and contains "Copy to..."
    const copyToExists = await page.evaluate(() => {
      const rightGroup = document.querySelector('.horizontal-menu-right-group');
      if (!rightGroup) return false;
      const children = rightGroup.querySelectorAll(':scope > div');
      const moreContainer = children[1] as HTMLElement | undefined;
      if (!moreContainer) return false;
      const submenu = moreContainer.querySelector('.horizontal-menu-submenu') as HTMLElement | null;
      if (!submenu) return false;
      if (window.getComputedStyle(submenu).display === 'none') return false;
      const labels = submenu.querySelectorAll('.horizontal-menu-label span');
      return Array.from(labels).some(label => label.textContent === 'Copy to...');
    });

    expect(copyToExists).toBe(true);
  });

  // Test 2: BUG REPRODUCTION — hovering "Copy to..." should show starred folders submenu
  // This test is expected to FAIL because nested dynamic submenus are not rendered
  test('should show starred folders when hovering "Copy to..." item', async ({ page }) => {
    await openNodeHoverMenu(page);
    await hoverMoreButton(page);

    // Find and hover over the "Copy to..." item within the More submenu
    const copyToItemPos = await page.evaluate(() => {
      const rightGroup = document.querySelector('.horizontal-menu-right-group');
      if (!rightGroup) return null;
      const children = rightGroup.querySelectorAll(':scope > div');
      const moreContainer = children[1] as HTMLElement | undefined;
      if (!moreContainer) return null;
      const submenu = moreContainer.querySelector('.horizontal-menu-submenu');
      if (!submenu) return null;

      // Find the "Copy to..." item by its label text
      const menuItems = submenu.querySelectorAll('.horizontal-menu-item');
      for (const item of menuItems) {
        const label = item.querySelector('.horizontal-menu-label span');
        if (label?.textContent === 'Copy to...') {
          const rect = item.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
      }
      return null;
    });

    expect(copyToItemPos).not.toBeNull();

    // Hover over the "Copy to..." item — this should trigger getSubMenuItems
    await page.mouse.move(copyToItemPos!.x, copyToItemPos!.y);
    // Give time for the async getSubMenuItems to resolve
    await page.waitForTimeout(500);

    // Check if a nested submenu appeared with starred folder names
    const nestedSubmenuInfo = await page.evaluate(() => {
      const rightGroup = document.querySelector('.horizontal-menu-right-group');
      if (!rightGroup) return { found: false, reason: 'no right group' };
      const children = rightGroup.querySelectorAll(':scope > div');
      const moreContainer = children[1] as HTMLElement | undefined;
      if (!moreContainer) return { found: false, reason: 'no more container' };
      const moreSubmenu = moreContainer.querySelector('.horizontal-menu-submenu');
      if (!moreSubmenu) return { found: false, reason: 'no more submenu' };

      // Look for a nested submenu inside the "Copy to..." item's container
      // The "Copy to..." item is inside a container div within the submenu
      const allSubmenus = moreContainer.querySelectorAll('.horizontal-menu-submenu');
      // There should be at least 2 submenus: the "More" submenu + the "Copy to..." nested submenu
      if (allSubmenus.length < 2) {
        return {
          found: false,
          reason: `only ${allSubmenus.length} submenu(s) found, expected >= 2`,
          submenuCount: allSubmenus.length,
        };
      }

      // Look for starred folder labels in any nested submenu
      const allLabels: string[] = [];
      for (const sub of allSubmenus) {
        const labels = sub.querySelectorAll('.horizontal-menu-label span');
        for (const label of labels) {
          if (label.textContent) allLabels.push(label.textContent);
        }
      }

      // Check for our mock starred folder names
      const expectedFolderNames = ['project-a', 'project-b', 'notes'];
      const foundFolders = expectedFolderNames.filter(name =>
        allLabels.some(label => label === name)
      );

      return {
        found: foundFolders.length === expectedFolderNames.length,
        reason: foundFolders.length === expectedFolderNames.length
          ? 'all starred folders visible'
          : `missing folders: expected [${expectedFolderNames.join(', ')}], found labels: [${allLabels.join(', ')}]`,
        foundFolders,
        allLabels,
      };
    });

    // This assertion should FAIL — the nested submenu for "Copy to..." is never rendered
    // because createSubMenuElement does not handle items with getSubMenuItems
    expect(nestedSubmenuInfo.found).toBe(true);
  });

  // Test 3: Clicking a starred folder should trigger copyNodeToFolder
  test('should call copyNodeToFolder when clicking a starred folder', async ({ page }) => {
    // Instrument the mock to track calls
    await page.evaluate(() => {
      (window as unknown as { _copyToFolderCalls: Array<{ nodeId: string; folder: string }> })
        ._copyToFolderCalls = [];
      const api = (window as unknown as { electronAPI: {
        main: Record<string, unknown>;
      } }).electronAPI;
      if (api?.main) {
        api.main.copyNodeToFolder = async (
          nodeId: string,
          folder: string,
        ): Promise<{ success: boolean; targetPath: string }> => {
          (window as unknown as { _copyToFolderCalls: Array<{ nodeId: string; folder: string }> })
            ._copyToFolderCalls.push({ nodeId, folder });
          return { success: true, targetPath: `${folder}/copied.md` };
        };
      }
    });

    await openNodeHoverMenu(page);
    await hoverMoreButton(page);

    // Find and hover over "Copy to..."
    const copyToItemPos = await page.evaluate(() => {
      const rightGroup = document.querySelector('.horizontal-menu-right-group');
      if (!rightGroup) return null;
      const children = rightGroup.querySelectorAll(':scope > div');
      const moreContainer = children[1] as HTMLElement | undefined;
      if (!moreContainer) return null;
      const submenu = moreContainer.querySelector('.horizontal-menu-submenu');
      if (!submenu) return null;
      const menuItems = submenu.querySelectorAll('.horizontal-menu-item');
      for (const item of menuItems) {
        const label = item.querySelector('.horizontal-menu-label span');
        if (label?.textContent === 'Copy to...') {
          const rect = item.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
      }
      return null;
    });

    expect(copyToItemPos).not.toBeNull();
    await page.mouse.move(copyToItemPos!.x, copyToItemPos!.y);
    await page.waitForTimeout(500);

    // Try to click the first starred folder in the nested submenu
    const clickedFolder = await page.evaluate(() => {
      const rightGroup = document.querySelector('.horizontal-menu-right-group');
      if (!rightGroup) return null;
      const children = rightGroup.querySelectorAll(':scope > div');
      const moreContainer = children[1] as HTMLElement | undefined;
      if (!moreContainer) return null;

      // Look for nested submenu items
      const allSubmenus = moreContainer.querySelectorAll('.horizontal-menu-submenu');
      for (const sub of allSubmenus) {
        const items = sub.querySelectorAll('.horizontal-menu-item');
        for (const item of items) {
          const label = item.querySelector('.horizontal-menu-label span');
          // Click the first folder (should be "project-a")
          if (label?.textContent === 'project-a') {
            (item as HTMLElement).click();
            return label.textContent;
          }
        }
      }
      return null;
    });

    // This should FAIL because the nested submenu is never created
    expect(clickedFolder).toBe('project-a');

    // Verify copyNodeToFolder was called with correct args
    if (clickedFolder) {
      await page.waitForTimeout(100);
      const calls = await page.evaluate(() =>
        (window as unknown as { _copyToFolderCalls: Array<{ nodeId: string; folder: string }> })
          ._copyToFolderCalls
      );
      expect(calls).toHaveLength(1);
      expect(calls[0].nodeId).toBe('copy-to-test.md');
      expect(calls[0].folder).toBe('/Users/test/Documents/project-a');
    }
  });

  // Test 4: Screenshot for visual debugging
  test('should capture screenshot showing Copy to hover state', async ({ page }) => {
    await openNodeHoverMenu(page);
    await hoverMoreButton(page);

    // Hover over "Copy to..."
    const copyToItemPos = await page.evaluate(() => {
      const rightGroup = document.querySelector('.horizontal-menu-right-group');
      if (!rightGroup) return null;
      const children = rightGroup.querySelectorAll(':scope > div');
      const moreContainer = children[1] as HTMLElement | undefined;
      if (!moreContainer) return null;
      const submenu = moreContainer.querySelector('.horizontal-menu-submenu');
      if (!submenu) return null;
      const menuItems = submenu.querySelectorAll('.horizontal-menu-item');
      for (const item of menuItems) {
        const label = item.querySelector('.horizontal-menu-label span');
        if (label?.textContent === 'Copy to...') {
          const rect = item.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
      }
      return null;
    });

    if (copyToItemPos) {
      await page.mouse.move(copyToItemPos.x, copyToItemPos.y);
      await page.waitForTimeout(500);
    }

    await page.screenshot({
      path: 'e2e-tests/screenshots/copy-to-starred-folder-hover.png',
      fullPage: true,
    });
  });
});

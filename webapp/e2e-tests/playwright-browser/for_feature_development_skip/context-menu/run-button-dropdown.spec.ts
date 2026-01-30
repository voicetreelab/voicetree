/**
 * E2E tests for Run Button Dropdown UI
 * Tests that:
 * - 5.1: Dropdown appears on Run button hover
 * - 5.2: Edit button in dropdown opens command editor popup
 * - 5.4: Dropdown closes on outside click
 *
 * Related task: openspec/changes/add-worktree-agent-spawn/tasks.md Section 5
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

test.describe('Run Button Dropdown', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockElectronAPI(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);

    // Add a test node to the graph
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'run-button-test.md',
          contentWithoutYamlOrLinks: '# Run Button Test\nThis node tests the run button dropdown.',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 500, y: 300 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      }
    ];
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(100);
  });

  // 5.1: Dropdown appears on Run button hover
  test('should show dropdown when hovering over Run button', async ({ page }) => {
    // Trigger mouseover on node to open horizontal menu
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#run-button-test.md');
      if (node.length === 0) throw new Error('Node not found');
      node.emit('mouseover');
    });
    await page.waitForTimeout(300);

    // Find the Run button (it's the 4th button - after Pin, Copy, Add)
    const runButtonContainer = await page.evaluate(() => {
      const rightGroup = document.querySelector('.horizontal-menu-right-group');
      if (!rightGroup) return null;
      // Run button is the first item in right group
      const runContainer = rightGroup.querySelector('div:first-child') as HTMLElement | null;
      if (!runContainer) return null;
      const rect = runContainer.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });

    expect(runButtonContainer).not.toBeNull();

    // Hover over Run button container to trigger submenu
    await page.mouse.move(runButtonContainer!.x, runButtonContainer!.y);
    await page.waitForTimeout(200);

    // Verify submenu appears (there should be 2 submenus now - one for Run, one for More)
    const runSubmenuVisible = await page.evaluate(() => {
      const rightGroup = document.querySelector('.horizontal-menu-right-group');
      if (!rightGroup) return false;
      const runContainer = rightGroup.querySelector('div:first-child');
      if (!runContainer) return false;
      const submenu = runContainer.querySelector('.horizontal-menu-submenu') as HTMLElement | null;
      if (!submenu) return false;
      return window.getComputedStyle(submenu).display === 'flex';
    });

    expect(runSubmenuVisible).toBe(true);

    // Verify "Edit Command" option exists in the dropdown
    const editCommandExists = await page.evaluate(() => {
      const rightGroup = document.querySelector('.horizontal-menu-right-group');
      if (!rightGroup) return false;
      const runContainer = rightGroup.querySelector('div:first-child');
      if (!runContainer) return false;
      const submenu = runContainer.querySelector('.horizontal-menu-submenu');
      if (!submenu) return false;
      const labels = submenu.querySelectorAll('.horizontal-menu-label span');
      return Array.from(labels).some(label => label.textContent === 'Edit Command');
    });

    expect(editCommandExists).toBe(true);
  });

  // 5.2: Edit button in dropdown opens command editor popup
  test('should open command editor popup when Edit Command is clicked', async ({ page }) => {
    // Trigger mouseover on node to open horizontal menu
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#run-button-test.md');
      if (node.length === 0) throw new Error('Node not found');
      node.emit('mouseover');
    });
    await page.waitForTimeout(300);

    // Programmatically show the Run button's submenu
    await page.evaluate(() => {
      const rightGroup = document.querySelector('.horizontal-menu-right-group');
      if (!rightGroup) throw new Error('Right group not found');
      const runContainer = rightGroup.querySelector('div:first-child');
      if (!runContainer) throw new Error('Run container not found');
      const submenu = runContainer.querySelector('.horizontal-menu-submenu') as HTMLElement | null;
      if (!submenu) throw new Error('Submenu not found');
      submenu.style.display = 'flex';
    });
    await page.waitForTimeout(100);

    // Click the Edit Command button
    await page.evaluate(() => {
      const rightGroup = document.querySelector('.horizontal-menu-right-group');
      if (!rightGroup) throw new Error('Right group not found');
      const runContainer = rightGroup.querySelector('div:first-child');
      if (!runContainer) throw new Error('Run container not found');
      const submenu = runContainer.querySelector('.horizontal-menu-submenu');
      if (!submenu) throw new Error('Submenu not found');
      const editButton = submenu.querySelector('.horizontal-menu-item') as HTMLElement | null;
      if (!editButton) throw new Error('Edit button not found');
      editButton.click();
    });

    // Wait for the agent command editor dialog to appear
    const dialog = page.locator('#agent-command-editor-dialog');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Verify dialog has proper structure
    await expect(dialog.locator('h2')).toContainText('Agent Command');
    await expect(dialog.locator('#command-input')).toBeVisible();

    // Take screenshot
    await page.screenshot({
      path: 'e2e-tests/screenshots/run-button-dropdown-edit-command.png'
    });

    // Clean up by cancelling
    await dialog.locator('[data-testid="cancel-button"]').click();
    await expect(dialog).not.toBeVisible({ timeout: 2000 });
  });

  // 5.4: Dropdown closes on outside click
  test('should close dropdown on outside click', async ({ page }) => {
    // Trigger mouseover on node to open horizontal menu
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#run-button-test.md');
      if (node.length === 0) throw new Error('Node not found');
      node.emit('mouseover');
    });
    await page.waitForTimeout(300);

    // Programmatically show the Run button's submenu
    await page.evaluate(() => {
      const rightGroup = document.querySelector('.horizontal-menu-right-group');
      if (!rightGroup) throw new Error('Right group not found');
      const runContainer = rightGroup.querySelector('div:first-child');
      if (!runContainer) throw new Error('Run container not found');
      const submenu = runContainer.querySelector('.horizontal-menu-submenu') as HTMLElement | null;
      if (!submenu) throw new Error('Submenu not found');
      submenu.style.display = 'flex';
    });
    await page.waitForTimeout(100);

    // Verify submenu is visible
    const submenuVisibleBefore = await page.evaluate(() => {
      const rightGroup = document.querySelector('.horizontal-menu-right-group');
      if (!rightGroup) return false;
      const runContainer = rightGroup.querySelector('div:first-child');
      if (!runContainer) return false;
      const submenu = runContainer.querySelector('.horizontal-menu-submenu') as HTMLElement | null;
      return submenu?.style.display === 'flex';
    });
    expect(submenuVisibleBefore).toBe(true);

    // Click outside the menu (far corner)
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);

    // Verify menu and submenu are no longer visible (menu closes on outside click)
    const menuGone = await page.evaluate(() => {
      const menu = document.querySelector('.cy-horizontal-context-menu');
      return menu === null;
    });
    expect(menuGone).toBe(true);
  });

  // Screenshot test for visual verification
  test('should capture screenshot of Run button with dropdown visible', async ({ page }) => {
    // Trigger mouseover on node to open horizontal menu
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#run-button-test.md');
      if (node.length === 0) throw new Error('Node not found');
      node.emit('mouseover');
    });
    await page.waitForTimeout(300);

    // Programmatically show the Run button's submenu
    await page.evaluate(() => {
      const rightGroup = document.querySelector('.horizontal-menu-right-group');
      if (!rightGroup) throw new Error('Right group not found');
      const runContainer = rightGroup.querySelector('div:first-child');
      if (!runContainer) throw new Error('Run container not found');
      const submenu = runContainer.querySelector('.horizontal-menu-submenu') as HTMLElement | null;
      if (!submenu) throw new Error('Submenu not found');
      submenu.style.display = 'flex';
    });
    await page.waitForTimeout(100);

    // Take screenshot
    await page.screenshot({
      path: 'e2e-tests/screenshots/run-button-dropdown.png',
      fullPage: true
    });
  });
});

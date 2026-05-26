/**
 * BEHAVIORAL SPEC: Edit Path (Inline Rename)
 *
 * Tests that clicking on a path text allows inline editing to rename/move the path.
 *
 * User Interaction:
 * 1. User opens dropdown
 * 2. Clicks path text (with pencil icon) next to a path
 * 3. Path text becomes editable input
 * 4. User types new path (relative or /absolute)
 * 5. Presses Enter to save, Escape to cancel
 * 6. App adds new path, updates write path if needed, removes old path
 *
 * Expected Behavior:
 * - Clicking path text enters edit mode (text becomes input)
 * - Enter saves changes, Escape cancels
 * - When saving:
 *   1. New path is added first
 *   2. If editing write path, write path is updated
 *   3. Old path is removed
 * - Config is updated
 */

import { expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { test, type ExtendedWindow } from './electron-edit-vault-path/fixtures';
import { assertOpenedForEditing, openFirstVaultPathForEditing } from './electron-edit-vault-path/path-editing';

test.describe('Edit Path (Inline Rename) E2E', () => {
  test('Test Scenario 1: Edit Root Path to Subfolder', async ({ appWindow }) => {
    test.setTimeout(30000);

    // Test editing the default root path to point to write-vault subfolder
    // The root path (.) should already be there as the default

    // Get the current paths to confirm root path exists
    const initialPaths = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getVaultPaths();
    });
    console.log('Initial vault paths:', initialPaths);
    expect(initialPaths.length).toBeGreaterThanOrEqual(1);

    // Open dropdown AND click edit in one evaluate to avoid race condition
    console.log('=== STEP 1: Open dropdown and click edit ===');
    assertOpenedForEditing(await openFirstVaultPathForEditing(appWindow));

    // Wait for edit mode
    await appWindow.waitForTimeout(300);
    console.log('Edit mode activated');

    console.log('=== STEP 2: Change text to write-vault ===');
    // Find the edit input (the one that doesn't have placeholder)
    const editInput = appWindow.locator('.absolute.bottom-full input[type="text"]:not([placeholder])');
    await editInput.clear();
    await editInput.fill('write-vault');

    console.log('=== STEP 3: Press Enter to save ===');
    await appWindow.keyboard.press('Enter');

    // Wait for edit to complete
    await appWindow.waitForTimeout(500);

    console.log('=== STEP 5: Assert paths updated ===');
    const finalPaths = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getVaultPaths();
    });

    console.log('Final vault paths:', finalPaths);

    // Should contain write-vault in one of the paths
    const hasWriteVault = finalPaths.some((p: string) => p.includes('write-vault'));
    expect(hasWriteVault).toBe(true);

    console.log('Edit root path test passed');
  });

  test('Test Scenario 2: Edit Write Path (root path is write path)', async ({ appWindow }) => {
    test.setTimeout(30000);

    // The root path (.) is the default write path
    // We'll edit it to point to write-vault subfolder

    // Get initial write path
    const initialWriteFolder = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      const result = await api.main.getWriteFolder();
      if (result && typeof result === 'object' && '_tag' in result) {
        return (result as { _tag: string; value?: string })._tag === 'Some'
          ? (result as { value: string }).value
          : null;
      }
      return null;
    });

    console.log('Initial write path:', initialWriteFolder);
    expect(initialWriteFolder).toBeTruthy();

    // Open dropdown AND click edit on the write path (first row has checkmark)
    console.log('=== STEP 1: Open dropdown and click edit on write path ===');
    assertOpenedForEditing(await openFirstVaultPathForEditing(appWindow));

    await appWindow.waitForTimeout(300);
    console.log('Edit mode activated');

    console.log('=== STEP 2: Change to write-vault ===');
    const editInput = appWindow.locator('.absolute.bottom-full input[type="text"]:not([placeholder])');
    await editInput.clear();
    await editInput.fill('write-vault');

    console.log('=== STEP 3: Press Enter ===');
    await appWindow.keyboard.press('Enter');

    await appWindow.waitForTimeout(500);

    console.log('=== STEP 4: Assert getWriteFolder() returns write-vault ===');
    const finalWriteFolder = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      const result = await api.main.getWriteFolder();
      if (result && typeof result === 'object' && '_tag' in result) {
        return (result as { _tag: string; value?: string })._tag === 'Some'
          ? (result as { value: string }).value
          : null;
      }
      return null;
    });

    console.log('Final write path:', finalWriteFolder);
    expect(finalWriteFolder).toContain('write-vault');

    console.log('=== STEP 5: Assert nodes from write-vault are loaded into graph ===');
    // BUG FIX VERIFICATION: When editing write path to a new folder, nodes from that folder must be loaded
    const graphNodes = await appWindow.evaluate(async () => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('cytoscapeInstance not available');
      return cy.nodes().map((n: { id: () => string }) => n.id());
    });

    console.log('Graph nodes after edit:', graphNodes);

    // write-vault/node-a.md should be loaded into the graph
    const hasNodeA = graphNodes.some((id: string) => id.includes('write-vault') && id.includes('node-a'));
    expect(hasNodeA).toBe(true);

    console.log('Edit write path test passed - nodes loaded correctly');
  });

  test('Test Scenario 3: Cancel Edit with Escape', async ({ appWindow }) => {
    test.setTimeout(30000);

    // Get initial paths
    const initialPaths = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getVaultPaths();
    });
    console.log('Initial paths:', initialPaths);

    // Open dropdown AND click edit on the first row
    console.log('=== STEP 1: Open dropdown and click edit ===');
    assertOpenedForEditing(await openFirstVaultPathForEditing(appWindow));

    await appWindow.waitForTimeout(300);
    console.log('Edit mode activated');

    console.log('=== STEP 2: Type something different ===');
    const editInput = appWindow.locator('.absolute.bottom-full input[type="text"]:not([placeholder])');
    await editInput.clear();
    await editInput.fill('something-completely-different');

    console.log('=== STEP 3: Press Escape ===');
    await appWindow.keyboard.press('Escape');

    await appWindow.waitForTimeout(300);

    console.log('=== STEP 4: Assert path unchanged ===');
    const finalPaths = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getVaultPaths();
    });

    console.log('Paths after escape:', finalPaths);

    // Path should be unchanged - same as initial
    expect(finalPaths).toEqual(initialPaths);

    // Verify the "something-completely-different" path was NOT added
    const hasChanged = finalPaths.some((p: string) => p.includes('something-completely-different'));
    expect(hasChanged).toBe(false);

    console.log('Cancel edit test passed');
  });

  test('Test Scenario 4: Edit with Absolute Path', async ({ appWindow }) => {
    test.setTimeout(30000);

    // Create an absolute path target directory
    const absoluteTargetPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-absolute-vault-'));
    console.log('Created absolute target:', absoluteTargetPath);

    // Get initial paths to know what we're editing
    const initialPaths = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getVaultPaths();
    });
    console.log('Initial paths:', initialPaths);

    // Open dropdown AND click edit on the first row
    console.log('=== STEP 1: Open dropdown and click edit ===');
    assertOpenedForEditing(await openFirstVaultPathForEditing(appWindow));

    await appWindow.waitForTimeout(300);

    console.log('=== STEP 2: Type absolute path ===');
    const editInput = appWindow.locator('.absolute.bottom-full input[type="text"]:not([placeholder])');
    await editInput.clear();
    await editInput.fill(absoluteTargetPath);

    console.log('=== STEP 3: Press Enter ===');
    await appWindow.keyboard.press('Enter');

    await appWindow.waitForTimeout(500);

    console.log('=== STEP 4: Assert path resolved to absolute location ===');
    const finalPaths = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getVaultPaths();
    });

    console.log('Paths after absolute edit:', finalPaths);

    // Should contain the absolute path
    const hasAbsolutePath = finalPaths.some((p: string) => p === absoluteTargetPath);
    expect(hasAbsolutePath).toBe(true);

    // Cleanup
    await fs.rm(absoluteTargetPath, { recursive: true, force: true });

    console.log('Edit with absolute path test passed');
  });
});

export { test };

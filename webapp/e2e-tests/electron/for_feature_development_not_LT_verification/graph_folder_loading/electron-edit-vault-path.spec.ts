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

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT = path.resolve(process.cwd());

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  testVaultPath: string;
  tempUserDataPath: string;
}>({
  // Create test vault with multiple folders
  testVaultPath: async ({}, use) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-edit-path-test-'));

    // Create write-vault with a node
    const writeVault = path.join(tempDir, 'write-vault');
    await fs.mkdir(writeVault, { recursive: true });
    await fs.writeFile(
      path.join(writeVault, 'node-a.md'),
      '# Node A\n\nThis is node A in write-vault.'
    );

    // Create read-vault with a node
    const readVault = path.join(tempDir, 'read-vault');
    await fs.mkdir(readVault, { recursive: true });
    await fs.writeFile(
      path.join(readVault, 'node-b.md'),
      '# Node B\n\nThis is node B in read-vault.'
    );

    // Create renamed-vault (empty, for renaming target)
    const renamedVault = path.join(tempDir, 'renamed-vault');
    await fs.mkdir(renamedVault, { recursive: true });

    // Create new-write-vault (empty, for write path rename test)
    const newWriteVault = path.join(tempDir, 'new-write-vault');
    await fs.mkdir(newWriteVault, { recursive: true });

    await use(tempDir);

    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  tempUserDataPath: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-edit-path-userdata-'));
    await use(tempUserDataPath);
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  electronApp: async ({ testVaultPath, tempUserDataPath }, use) => {
    // Configure to auto-load test vault
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: testVaultPath }, null, 2), 'utf8');
    console.log('[Edit Path Test] Created config to auto-load:', testVaultPath);

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1'
      },
      timeout: 10000
    });

    await use(electronApp);

    // Graceful shutdown
    try {
      const window = await electronApp.firstWindow();
      await window.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (api) {
          await api.main.stopFileWatching();
        }
      });
      await window.waitForTimeout(300);
    } catch {
      console.log('Note: Could not stop file watching during cleanup');
    }

    await electronApp.close();
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 10000 });

    window.on('console', msg => {
      console.log(`[BROWSER ${msg.type()}]:`, msg.text());
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });

    // Wait for initial load
    await window.waitForTimeout(1000);

    await use(window);
  }
});

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
    const openAndClickResult = await appWindow.evaluate((): Promise<{ success: boolean; editedPath?: string | null; error?: string }> => {
      // First, click the VaultPathSelector button to open dropdown
      const selectorButton = document.querySelector('button[title^="Write Path"]');
      if (!selectorButton) {
        return Promise.resolve({ success: false, error: 'No selector button found' });
      }

      (selectorButton as HTMLButtonElement).click();

      // Wait a bit for React to render the dropdown (using requestAnimationFrame)
      return new Promise<{ success: boolean; editedPath?: string | null; error?: string }>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const dropdown = document.querySelector('.absolute.bottom-full');
            if (!dropdown) {
              resolve({ success: false, error: 'No dropdown found after click' });
              return;
            }

            // Find the first path row with a title
            const rows = Array.from(dropdown.querySelectorAll('div[title]'));
            if (rows.length === 0) {
              resolve({ success: false, error: 'No rows found' });
              return;
            }

            const firstRow = rows[0];
            const rowTitle = firstRow.getAttribute('title');

            // Find the edit button (button with pencil)
            const buttons = Array.from(firstRow.querySelectorAll('button'));
            const editButton = buttons.find(b => b.textContent?.includes('\u270E'));

            if (editButton) {
              (editButton as HTMLButtonElement).click();
              resolve({ success: true, editedPath: rowTitle });
            } else {
              resolve({ success: false, error: 'No edit button found' });
            }
          });
        });
      });
    });

    console.log('Open and click result:', openAndClickResult);
    if (!openAndClickResult.success) {
      throw new Error(openAndClickResult.error ?? 'Unknown error');
    }

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
    const initialWritePath = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      const result = await api.main.getWritePath();
      if (result && typeof result === 'object' && '_tag' in result) {
        return (result as { _tag: string; value?: string })._tag === 'Some'
          ? (result as { value: string }).value
          : null;
      }
      return null;
    });

    console.log('Initial write path:', initialWritePath);
    expect(initialWritePath).toBeTruthy();

    // Open dropdown AND click edit on the write path (first row has checkmark)
    console.log('=== STEP 1: Open dropdown and click edit on write path ===');
    const openAndClickResult = await appWindow.evaluate((): Promise<{ success: boolean; editedPath?: string | null; error?: string }> => {
      const selectorButton = document.querySelector('button[title^="Write Path"]');
      if (!selectorButton) {
        return Promise.resolve({ success: false, error: 'No selector button found' });
      }

      (selectorButton as HTMLButtonElement).click();

      return new Promise<{ success: boolean; editedPath?: string | null; error?: string }>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const dropdown = document.querySelector('.absolute.bottom-full');
            if (!dropdown) {
              resolve({ success: false, error: 'No dropdown found after click' });
              return;
            }

            // Find the first path row (write path has checkmark)
            const rows = Array.from(dropdown.querySelectorAll('div[title]'));
            if (rows.length === 0) {
              resolve({ success: false, error: 'No rows found' });
              return;
            }

            const firstRow = rows[0];
            const rowTitle = firstRow.getAttribute('title');

            // Find the edit button (button with pencil)
            const buttons = Array.from(firstRow.querySelectorAll('button'));
            const editButton = buttons.find(b => b.textContent?.includes('\u270E'));

            if (editButton) {
              (editButton as HTMLButtonElement).click();
              resolve({ success: true, editedPath: rowTitle });
            } else {
              resolve({ success: false, error: 'No edit button found' });
            }
          });
        });
      });
    });

    console.log('Open and click result:', openAndClickResult);
    if (!openAndClickResult.success) {
      throw new Error(openAndClickResult.error ?? 'Unknown error');
    }

    await appWindow.waitForTimeout(300);
    console.log('Edit mode activated');

    console.log('=== STEP 2: Change to write-vault ===');
    const editInput = appWindow.locator('.absolute.bottom-full input[type="text"]:not([placeholder])');
    await editInput.clear();
    await editInput.fill('write-vault');

    console.log('=== STEP 3: Press Enter ===');
    await appWindow.keyboard.press('Enter');

    await appWindow.waitForTimeout(500);

    console.log('=== STEP 4: Assert getWritePath() returns write-vault ===');
    const finalWritePath = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      const result = await api.main.getWritePath();
      if (result && typeof result === 'object' && '_tag' in result) {
        return (result as { _tag: string; value?: string })._tag === 'Some'
          ? (result as { value: string }).value
          : null;
      }
      return null;
    });

    console.log('Final write path:', finalWritePath);
    expect(finalWritePath).toContain('write-vault');

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
    const openAndClickResult = await appWindow.evaluate((): Promise<{ success: boolean; editedPath?: string | null; error?: string }> => {
      const selectorButton = document.querySelector('button[title^="Write Path"]');
      if (!selectorButton) {
        return Promise.resolve({ success: false, error: 'No selector button found' });
      }

      (selectorButton as HTMLButtonElement).click();

      return new Promise<{ success: boolean; editedPath?: string | null; error?: string }>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const dropdown = document.querySelector('.absolute.bottom-full');
            if (!dropdown) {
              resolve({ success: false, error: 'No dropdown found after click' });
              return;
            }

            const rows = Array.from(dropdown.querySelectorAll('div[title]'));
            if (rows.length === 0) {
              resolve({ success: false, error: 'No rows found' });
              return;
            }

            const firstRow = rows[0];
            const rowTitle = firstRow.getAttribute('title');

            const buttons = Array.from(firstRow.querySelectorAll('button'));
            const editButton = buttons.find(b => b.textContent?.includes('\u270E'));

            if (editButton) {
              (editButton as HTMLButtonElement).click();
              resolve({ success: true, editedPath: rowTitle });
            } else {
              resolve({ success: false, error: 'No edit button found' });
            }
          });
        });
      });
    });

    console.log('Open and click result:', openAndClickResult);
    if (!openAndClickResult.success) {
      throw new Error(openAndClickResult.error ?? 'Unknown error');
    }

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
    const openAndClickResult = await appWindow.evaluate((): Promise<{ success: boolean; editedPath?: string | null; error?: string }> => {
      const selectorButton = document.querySelector('button[title^="Write Path"]');
      if (!selectorButton) {
        return Promise.resolve({ success: false, error: 'No selector button found' });
      }

      (selectorButton as HTMLButtonElement).click();

      return new Promise<{ success: boolean; editedPath?: string | null; error?: string }>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const dropdown = document.querySelector('.absolute.bottom-full');
            if (!dropdown) {
              resolve({ success: false, error: 'No dropdown found after click' });
              return;
            }

            const rows = Array.from(dropdown.querySelectorAll('div[title]'));
            if (rows.length === 0) {
              resolve({ success: false, error: 'No rows found' });
              return;
            }

            const firstRow = rows[0];
            const rowTitle = firstRow.getAttribute('title');

            const buttons = Array.from(firstRow.querySelectorAll('button'));
            const editButton = buttons.find(b => b.textContent?.includes('\u270E'));

            if (editButton) {
              (editButton as HTMLButtonElement).click();
              resolve({ success: true, editedPath: rowTitle });
            } else {
              resolve({ success: false, error: 'No edit button found' });
            }
          });
        });
      });
    });

    console.log('Open and click result:', openAndClickResult);
    if (!openAndClickResult.success) {
      throw new Error(openAndClickResult.error ?? 'Unknown error');
    }

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

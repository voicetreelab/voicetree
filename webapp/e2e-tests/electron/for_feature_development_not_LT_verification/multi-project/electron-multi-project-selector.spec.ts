/**
 * BEHAVIORAL SPEC:
 * E2E test for the ProjectPathSelector component (multi-project write path switching).
 *
 * This test verifies:
 * 1. ProjectPathSelector appears when project paths exist
 * 2. Clicking it opens the folder tree sidebar
 * 3. Choosing a folder's write-target control changes the default write path
 * 4. The change persists via the API
 *
 * PRECONDITION:
 * Test project has an 'openspec' folder. The test explicitly adds it as a read path
 * so it does not depend on default allowlist settings.
 *
 * EXPECTED OUTCOME:
 * - ProjectPathSelector opens the folder tree sidebar
 * - Users can switch default write path via the sidebar
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

// Use absolute paths for test fixtures
const PROJECT_ROOT = path.resolve(process.cwd());

// Type definitions
interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

async function getWriteFolderPath(page: Page): Promise<string | null> {
  return await page.evaluate(async () => {
    const api = (window as ExtendedWindow).electronAPI;
    if (!api) throw new Error('electronAPI not available');
    const result = await api.main.getWriteFolderPath();
    if (result && typeof result === 'object' && '_tag' in result) {
      return (result as { _tag: string; value?: string })._tag === 'Some' ? (result as { value: string }).value : null;
    }
    return null;
  });
}

// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  testProjectPath: string;
  openspecPath: string;
}>({
  // Create a test project with openspec folder for multi-project testing
  testProjectPath: async ({}, use) => {
    // Create temp directory structure
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-multi-project-test-'));
    const projectRoot = path.join(tempDir, 'voicetree');
    const openspecPath = path.join(tempDir, 'openspec');

    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(openspecPath, { recursive: true });

    // Create test files in both directories
    await fs.writeFile(
      path.join(projectRoot, 'test-node.md'),
      '# Test Node\n\nThis is a test node in the primary project.'
    );
    await fs.writeFile(
      path.join(openspecPath, 'spec-node.md'),
      '# Spec Node\n\nThis is a test node in openspec folder.'
    );

    await use(tempDir);

    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  openspecPath: async ({ testProjectPath }, use) => {
    await use(path.join(testProjectPath, 'openspec'));
  },

  electronApp: async ({ testProjectPath }, use) => {
    // Create a temporary userData directory for this test
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-multiproject-userdata-'));

    // Write the config file to auto-load the test project on startup
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: testProjectPath }, null, 2), 'utf8');
    console.log('[Multi-Project Test] Created config to auto-load:', testProjectPath);

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

    // Cleanup temp userData directory
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 10000 });

    // Log console messages for debugging (only shown on test failure)
    const consoleLogs: string[] = [];
    window.on('console', msg => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    });

    // Capture page errors
    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });

    // Wait for graph to load
    await window.waitForTimeout(1000);

    await use(window);

    // Print console logs only if test failed (handled by Playwright reporter)
  }
});

test.describe('Multi-Project ProjectPathSelector E2E', () => {
  test('should display ProjectPathSelector when multiple project paths exist and allow switching', async ({ appWindow, openspecPath, testProjectPath }) => {
    test.setTimeout(30000);

    console.log('=== STEP 1: Ensure multiple project paths are loaded ===');
    // Wait for auto-load to complete
    await appWindow.waitForTimeout(500);

    const projectPaths = await appWindow.evaluate(async (pathToAdd) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      const currentPaths = await api.main.getProjectPaths();
      if (!currentPaths.includes(pathToAdd)) {
        await api.main.addReadPath(pathToAdd);
      }
      return await api.main.getProjectPaths();
    }, openspecPath);

    console.log('Project paths:', projectPaths);
    expect(projectPaths.length).toBeGreaterThanOrEqual(2);
    expect(projectPaths).toContain(openspecPath);
    console.log('Multiple project paths confirmed:', projectPaths.length);

    console.log('=== STEP 2: Verify ProjectPathSelector is visible ===');
    const selectorButton = appWindow.locator('button[title^="Write Path:"]');
    const selectorExists = await selectorButton.isVisible({ timeout: 5000 }).catch(() => false);

    expect(selectorExists).toBe(true);
    console.log('ProjectPathSelector button is visible');

    console.log('=== STEP 3: Click to open folder tree sidebar ===');
    await appWindow.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const selectorBtn = buttons.find(b => b.getAttribute('title')?.startsWith('Write Path:'));
      if (selectorBtn) {
        selectorBtn.click();
      }
    });

    await appWindow.waitForSelector('[data-testid="folder-tree-sidebar"]', { state: 'visible', timeout: 5000 });
    console.log('Folder tree sidebar opened');

    console.log('=== STEP 4: Verify sidebar lists the openspec folder ===');
    await appWindow.evaluate((rootPath) => {
      const rootRow = Array.from(document.querySelectorAll('.folder-tree-folder'))
        .find(row => row.getAttribute('title') === rootPath);
      if (rootRow && !rootRow.parentElement?.querySelector('.folder-tree-children')) {
        (rootRow as HTMLElement).click();
      }
    }, testProjectPath);
    await appWindow.locator(`.folder-tree-folder[title="${openspecPath}"]`).waitFor({ state: 'visible', timeout: 5000 });
    const sidebarContent = await appWindow.evaluate(() => {
      const sidebar = document.querySelector('[data-testid="folder-tree-sidebar"]');
      return sidebar?.textContent ?? '';
    });

    console.log('Sidebar content:', sidebarContent);
    expect(sidebarContent).toContain('openspec');

    console.log('=== STEP 5: Get initial default write path ===');
    let initialDefaultPath = await getWriteFolderPath(appWindow);
    if (initialDefaultPath?.includes('openspec')) {
      await appWindow.evaluate(async (fallbackPath) => {
        const api = (window as ExtendedWindow).electronAPI;
        if (!api) throw new Error('electronAPI not available');
        await api.main.setWriteFolderPath(fallbackPath);
      }, testProjectPath);
      await expect.poll(() => getWriteFolderPath(appWindow), { timeout: 5000 }).toBe(testProjectPath);
      initialDefaultPath = await getWriteFolderPath(appWindow);
    }

    console.log('Initial default write path:', initialDefaultPath);
    expect(initialDefaultPath).toBeTruthy();
    expect(initialDefaultPath).not.toContain('openspec');

    console.log('=== STEP 6: Click openspec write-target control ===');
    await appWindow.evaluate((pathToSelect) => {
      const row = Array.from(document.querySelectorAll('.folder-tree-folder'))
        .find(folder => folder.getAttribute('title') === pathToSelect);
      const setWriteButton = row?.querySelector('.folder-tree-set-write-btn');
      if (!(setWriteButton instanceof HTMLElement)) {
        throw new Error(`Set write target button not found for ${pathToSelect}`);
      }
      setWriteButton.click();
    }, openspecPath);

    console.log('=== STEP 7: Verify default write path changed ===');
    await expect.poll(() => getWriteFolderPath(appWindow), { timeout: 5000 }).toBe(openspecPath);
    const newDefaultPath = await getWriteFolderPath(appWindow);

    console.log('New default write path:', newDefaultPath);
    expect(newDefaultPath).toContain('openspec');
    expect(newDefaultPath).not.toBe(initialDefaultPath);

    console.log('=== STEP 8: Verify UI reflects the change ===');
    await expect(selectorButton).toContainText('openspec', { timeout: 5000 });
    console.log('Selector button text:', await selectorButton.textContent());

    console.log('');
    console.log('=== TEST SUMMARY ===');
    console.log('ProjectPathSelector E2E test completed successfully:');
    console.log('- Multiple project paths detected');
    console.log('- Folder tree sidebar visible');
    console.log('- All project paths listed in sidebar');
    console.log('- Default write path switchable via sidebar');
    console.log('- UI updates to reflect new selection');
  });

  test('should handle a project with only one project path', async () => {
    test.setTimeout(20000);

    // Create a test project WITHOUT openspec folder
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-single-project-test-'));
    const projectRoot = path.join(tempDir, 'voicetree');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, 'test.md'),
      '# Test\nSingle project test.'
    );

    // Create separate userData for this subtest
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-singleproject-userdata-'));
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: tempDir }, null, 2), 'utf8');

    // Launch new Electron instance with single project
    const singleProjectApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1'
      },
      timeout: 10000
    });

    try {
      const window = await singleProjectApp.firstWindow({ timeout: 10000 });
      await window.waitForLoadState('domcontentloaded');
      await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
      await window.waitForTimeout(1000);

      // Check project paths
      const projectPaths = await window.evaluate(async () => {
        const api = (window as ExtendedWindow).electronAPI;
        if (!api) throw new Error('electronAPI not available');
        return await api.main.getProjectPaths();
      });

      console.log('Single project test - project paths:', projectPaths);
      const selectorVisible = await window.locator('button[title^="Write Path:"]').isVisible().catch(() => false);

      if (projectPaths.length === 0) {
        expect(selectorVisible).toBe(false);
        console.log('No project paths - ProjectPathSelector correctly hidden');
      } else {
        expect(selectorVisible).toBe(true);
        console.log('Loaded project path - ProjectPathSelector visible:', selectorVisible);
      }

      console.log('Test passed: ProjectPathSelector behavior correct for single project');
    } finally {
      // Cleanup
      try {
        const window = await singleProjectApp.firstWindow();
        await window.evaluate(async () => {
          const api = (window as unknown as ExtendedWindow).electronAPI;
          if (api) await api.main.stopFileWatching();
        });
      } catch { /* ignore */ }

      await singleProjectApp.close();
      await fs.rm(tempDir, { recursive: true, force: true });
      await fs.rm(tempUserDataPath, { recursive: true, force: true });
    }
  });
});

export { test };

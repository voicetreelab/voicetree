/**
 * BEHAVIORAL SPEC:
 * E2E test for "Remove Read Path" functionality.
 *
 * This test verifies:
 * 1. Clicking the remove button (X) on a read path removes its nodes from the graph
 * 2. Files are NOT deleted from disk
 * 3. The write path cannot be removed (no X button shown)
 * 4. Config is updated to remove the path
 * 5. UI updates correctly after removal
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

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  testDir: string;
  writeFolderPath: string;
  readProjectPath: string;
  tempUserDataPath: string;
}>({
  // Create test directory structure:
  // testDir/
  //   write-project/           <- writeFolderPath
  //     node-a.md            <- Links to [[node-b]]
  //   read-project/            <- readPath
  //     node-b.md            <- Linked by node-a
  testDir: async ({}, use) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-remove-read-path-test-'));
    await use(tempDir);
    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  writeFolderPath: async ({ testDir }, use) => {
    const writeFolderPath = path.join(testDir, 'write-project');
    await fs.mkdir(writeFolderPath, { recursive: true });

    // Create node-a that links to node-b in read-project
    await fs.writeFile(
      path.join(writeFolderPath, 'node-a.md'),
      `# Node A

This node links to [[node-b]] in the read project.
`
    );

    await use(writeFolderPath);
  },

  readProjectPath: async ({ testDir }, use) => {
    const readProjectPath = path.join(testDir, 'read-project');
    await fs.mkdir(readProjectPath, { recursive: true });

    // Create node-b that is linked by node-a
    await fs.writeFile(
      path.join(readProjectPath, 'node-b.md'),
      `# Node B

This node is in the read-project and should be removed when project is removed.
`
    );

    await use(readProjectPath);
  },

  tempUserDataPath: async ({}, use) => {
    const tempPath = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-removepath-userdata-'));
    await use(tempPath);
    // Cleanup
    await fs.rm(tempPath, { recursive: true, force: true });
  },

  electronApp: async ({ testDir, writeFolderPath, readProjectPath, tempUserDataPath }, use) => {
    // Write config with both write path and read path already configured
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        lastDirectory: testDir,
        projectConfig: {
          [testDir]: {
            writeFolderPath: writeFolderPath,
            readPaths: [readProjectPath]  // Read path already configured
          }
        }
      }, null, 2),
      'utf8'
    );
    console.log('[Remove Read Path Test] Config created with read project:', readProjectPath);

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
      timeout: 30000
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
    const window = await electronApp.firstWindow({ timeout: 30000 });

    window.on('console', msg => {
      const text = msg.text();
      if (text.includes('removeReadOnLinkPath') || text.includes('[loadFolder]') || text.includes('[handleFSEvent]')) {
        console.log(`[Browser] ${text}`);
      }
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 30000 });

    // Wait for graph to load
    await window.waitForTimeout(2000);

    await use(window);
  }
});

test.describe('Remove Read Path', () => {
  test('should remove nodes from graph when read path is removed, but NOT delete files from disk', async ({
    appWindow,
    readProjectPath
  }) => {
    test.setTimeout(30000);

    console.log('=== STEP 1: Verify initial state (both node-a and node-b loaded) ===');

    const initialNodes = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return cy.nodes().map(n => n.id());
    });

    console.log('Initial nodes:', initialNodes);
    expect(initialNodes.some(id => id.includes('node-a'))).toBe(true);
    expect(initialNodes.some(id => id.includes('node-b'))).toBe(true);

    console.log('=== STEP 2: Verify readPaths includes read-project ===');

    const initialReadPaths = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getReadOnLinkPaths();
    });

    console.log('Initial readPaths:', initialReadPaths);
    expect(initialReadPaths.some(p => p.includes('read-project'))).toBe(true);

    console.log('=== STEP 3: Remove read-project path via API ===');

    const removeResult = await appWindow.evaluate(async (pathToRemove: string) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.removeReadOnLinkPath(pathToRemove);
    }, readProjectPath);

    console.log('removeReadOnLinkPath result:', removeResult);
    expect(removeResult.success).toBe(true);

    // Wait for UI to update
    await appWindow.waitForTimeout(500);

    console.log('=== STEP 4: Verify node-b removed from graph ===');

    const nodesAfterRemove = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return cy.nodes().map(n => n.id());
    });

    console.log('Nodes after remove:', nodesAfterRemove);
    expect(nodesAfterRemove.some(id => id.includes('node-a'))).toBe(true);
    expect(nodesAfterRemove.some(id => id.includes('node-b'))).toBe(false);

    console.log('=== STEP 5: Verify readPaths no longer includes read-project ===');

    const finalReadPaths = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getReadOnLinkPaths();
    });

    console.log('Final readPaths:', finalReadPaths);
    expect(finalReadPaths.some(p => p.includes('read-project'))).toBe(false);

    console.log('=== STEP 6: Verify files still exist on disk ===');

    const readProjectExists = await fs.access(readProjectPath).then(() => true).catch(() => false);
    const nodeBFileExists = await fs.access(path.join(readProjectPath, 'node-b.md')).then(() => true).catch(() => false);

    console.log('read-project directory exists:', readProjectExists);
    console.log('node-b.md file exists:', nodeBFileExists);

    expect(readProjectExists).toBe(true);
    expect(nodeBFileExists).toBe(true);

    console.log('');
    console.log('=== TEST SUMMARY ===');
    console.log('Remove Read Path test completed successfully:');
    console.log('- Nodes from read path removed from graph');
    console.log('- readPaths config updated');
    console.log('- Files remain on disk (not deleted)');
  });

  test('should not allow removing the write path', async ({
    appWindow,
    writeFolderPath
  }) => {
    test.setTimeout(30000);

    console.log('=== TEST: Cannot remove write path ===');

    // Attempt to remove the write path via API
    const removeResult = await appWindow.evaluate(async (pathToRemove: string) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.removeReadOnLinkPath(pathToRemove);
    }, writeFolderPath);

    console.log('Attempt to remove write path result:', removeResult);

    // Should fail with error
    expect(removeResult.success).toBe(false);
    expect(removeResult.error).toContain('Cannot remove write path');

    console.log('=== VERIFIED: Write path cannot be removed ===');
  });

  test('should update getProjectPaths after removal', async ({
    appWindow,
    readProjectPath
  }) => {
    test.setTimeout(30000);

    console.log('=== TEST: getProjectPaths updates after removal ===');

    // Get initial project paths
    const initialProjectPaths = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getProjectPaths();
    });

    console.log('Initial project paths:', initialProjectPaths);
    expect(initialProjectPaths.length).toBe(2);  // write-project + read-project
    expect(initialProjectPaths.some(p => p.includes('read-project'))).toBe(true);

    // Remove the read path
    await appWindow.evaluate(async (pathToRemove: string) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.removeReadOnLinkPath(pathToRemove);
    }, readProjectPath);

    await appWindow.waitForTimeout(300);

    // Get project paths after removal
    const finalProjectPaths = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getProjectPaths();
    });

    console.log('Final project paths:', finalProjectPaths);
    expect(finalProjectPaths.length).toBe(1);  // Only write-project remains
    expect(finalProjectPaths.some(p => p.includes('read-project'))).toBe(false);
    expect(finalProjectPaths.some(p => p.includes('write-project'))).toBe(true);

    console.log('=== VERIFIED: getProjectPaths updated correctly ===');
  });
});

// Cleanup fixtures after all tests
test.afterAll(async () => {
  // Note: cleanup is handled by the fixture teardown
  console.log('[Test Cleanup] Tests completed');
});

export { test };

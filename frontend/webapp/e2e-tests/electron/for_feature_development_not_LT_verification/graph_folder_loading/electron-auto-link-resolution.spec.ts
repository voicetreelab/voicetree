/**
 * BEHAVIORAL SPEC:
 * 1. When a node with wikilinks is loaded, linked nodes are automatically loaded
 * 2. Absolute path links resolve directly to the file
 * 3. Relative path links use suffix-matching to find the file
 * 4. Transitive links are resolved (A→B→C loads all three)
 * 5. Already-loaded nodes are not duplicated
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT: string = path.resolve(process.cwd());

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  tempDir: string;
}>({
  tempDir: async ({}, use) => {
    const tempDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-auto-link-test-'));
    await use(tempDir);
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  electronApp: async ({ tempDir }, use) => {
    const tempUserDataPath: string = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-auto-link-userdata-'));

    // Write config to auto-load the tempDir
    const configPath: string = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        lastDirectory: tempDir,
        vaultConfig: {
          [tempDir]: {
            writePath: tempDir,
            readPaths: []
          }
        }
      }, null, 2),
      'utf8'
    );

    const electronApp: ElectronApplication = await electron.launch({
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

    try {
      const window: Page = await electronApp.firstWindow();
      await window.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (api) {
          await api.main.stopFileWatching();
        }
      });
      await window.waitForTimeout(300);
    } catch {
      // ignore cleanup errors
    }

    await electronApp.close();
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp }, use) => {
    const window: Page = await electronApp.firstWindow({ timeout: 10000 });

    window.on('console', msg => {
      const text: string = msg.text();
      if (text.includes('[loadFolder]') || text.includes('resolveLinkedNodes') || text.includes('findFileByName')) {
        console.log(`[Browser] ${text}`);
      }
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Auto link resolution', () => {
  test('should auto-load nodes linked from existing nodes', async ({ appWindow, tempDir }) => {
    test.setTimeout(30000);

    // Create main.md that links to other.md
    await fs.writeFile(path.join(tempDir, 'main.md'), '# Main\nLinks to [[other]]');
    await fs.writeFile(path.join(tempDir, 'other.md'), '# Other\nLinked from main');

    // Reload the folder to pick up the new files
    const result = await appWindow.evaluate(async (dir: string) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      await api.main.startFileWatching(dir);
      return true;
    }, tempDir);

    expect(result).toBe(true);

    // Wait for graph to stabilize
    await appWindow.waitForTimeout(1500);

    // Verify both nodes are in graph
    const nodeState = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return {
        nodeCount: cy.nodes().length,
        labels: cy.nodes().map(n => n.data('label') as string)
      };
    });

    console.log('Node state:', nodeState);

    // Core assertion: both linked nodes should be loaded
    expect(nodeState.labels).toContain('Main');
    expect(nodeState.labels).toContain('Other');
    // There may be additional nodes (starter nodes, etc) - that's OK as long as our nodes are loaded
    expect(nodeState.nodeCount).toBeGreaterThanOrEqual(2);
  });

  test('should resolve absolute path wikilinks', async ({ appWindow, tempDir }) => {
    test.setTimeout(30000);

    const subDir: string = path.join(tempDir, 'subdir');
    await fs.mkdir(subDir);

    // Create files with absolute path link
    const targetPath: string = path.join(subDir, 'target.md');
    await fs.writeFile(path.join(tempDir, 'source.md'), `# Source\nLinks to [[${targetPath}]]`);
    await fs.writeFile(targetPath, '# Target\nLinked via absolute path');

    // Load and verify
    await appWindow.evaluate(async (dir: string) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      await api.main.startFileWatching(dir);
    }, tempDir);

    await appWindow.waitForTimeout(1500);

    const nodeState = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return cy.nodes().map(n => n.data('label') as string);
    });

    console.log('Node labels:', nodeState);

    expect(nodeState).toContain('Source');
    expect(nodeState).toContain('Target');
  });

  test('should resolve transitive links (A→B→C)', async ({ appWindow, tempDir }) => {
    test.setTimeout(30000);

    await fs.writeFile(path.join(tempDir, 'a.md'), '# A\nLinks to [[b]]');
    await fs.writeFile(path.join(tempDir, 'b.md'), '# B\nLinks to [[c]]');
    await fs.writeFile(path.join(tempDir, 'c.md'), '# C\nEnd of chain');

    await appWindow.evaluate(async (dir: string) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      await api.main.startFileWatching(dir);
    }, tempDir);

    await appWindow.waitForTimeout(2000); // Allow time for transitive resolution

    const nodeState = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return cy.nodes().map(n => n.data('label') as string);
    });

    console.log('Node labels:', nodeState);

    expect(nodeState).toContain('A');
    expect(nodeState).toContain('B');
    expect(nodeState).toContain('C');
  });

  test('should not duplicate already-loaded nodes', async ({ appWindow, tempDir }) => {
    test.setTimeout(30000);

    // Create cycle: a→b, b→a
    await fs.writeFile(path.join(tempDir, 'a.md'), '# A\nLinks to [[b]]');
    await fs.writeFile(path.join(tempDir, 'b.md'), '# B\nLinks to [[a]]');

    await appWindow.evaluate(async (dir: string) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      await api.main.startFileWatching(dir);
    }, tempDir);

    await appWindow.waitForTimeout(1500);

    const nodeState = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      const ids: string[] = cy.nodes().map(n => n.id());
      const uniqueIds: string[] = [...new Set(ids)];
      return {
        total: ids.length,
        unique: uniqueIds.length
      };
    });

    console.log('Node state:', nodeState);

    // Each file should appear exactly once (no duplicates from circular references)
    expect(nodeState.total).toBe(nodeState.unique);
    // There may be additional nodes (starter nodes, etc) - that's OK as long as our nodes are not duplicated
    expect(nodeState.total).toBeGreaterThanOrEqual(2);
  });
});

export { test };

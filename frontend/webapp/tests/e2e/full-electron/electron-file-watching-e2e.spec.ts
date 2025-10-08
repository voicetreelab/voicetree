import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { EdgeSingular } from 'cytoscape';
import {
  ExtendedWindow,
  waitForAppLoad,
  startWatching,
  stopWatching,
  getGraphState,
  pollForNodeCount,
  createMarkdownFile,
  getNodeData,
  checkGraphIntegrity
} from './test-utils';

const PROJECT_ROOT = path.resolve(process.cwd());

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  tempDir: string;
}>({
  electronApp: async ({}, use) => {
    const electronApp = await electron.launch({
      args: [path.join(PROJECT_ROOT, 'dist-electron/main/index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1'
      }
    });
    await use(electronApp);
    await electronApp.close();
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    window.on('console', msg => console.log(`BROWSER [${msg.type()}]:`, msg.text()));
    await waitForAppLoad(window);
    await use(window);
  },

  tempDir: async ({}, use) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-test-'));
    await use(dir);
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (error) {
      console.error(`Failed to clean up temp directory: ${error}`);
    }
  }
});

test.describe('Electron File Watching E2E Tests', () => {
  test('should watch real files and update graph accordingly', async ({ appWindow, tempDir }) => {
    console.log('=== STEP 1: Verify initial empty state ===');
    await expect(appWindow.locator('text=Graph visualization will appear here')).toBeVisible();
    const initialState = await getGraphState(appWindow);
    expect(initialState?.nodes).toBe(0);

    console.log('=== STEP 2: Start watching ===');
    await startWatching(appWindow, tempDir);

    console.log('=== STEP 3: Create first markdown file ===');
    const file1Path = await createMarkdownFile(tempDir, 'introduction.md', '# Introduction\n\nThis is the introduction.');
    await pollForNodeCount(appWindow, 1);
    const firstNode = await getNodeData(appWindow, 0);
    expect(firstNode?.label).toContain('introduction');

    console.log('=== STEP 4: Create second file with link ===');
    const file2Path = await createMarkdownFile(
      tempDir,
      'advanced.md',
      '# Advanced Topics\n\nBuilding upon [[introduction]], we explore advanced concepts.'
    );

    const graphWithLink = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return null;
      return {
        nodes: cy.nodes().length,
        edges: cy.edges().length,
        edgeData: cy.edges().map((e: EdgeSingular) => ({
          source: e.source().data('label'),
          target: e.target().data('label')
        }))
      };
    });

    expect(graphWithLink).toMatchObject({
      nodes: 2,
      edges: 1,
      edgeData: [{
        source: expect.stringContaining('advanced'),
        target: expect.stringContaining('introduction')
      }]
    });

    console.log('=== STEP 5: Modify a file ===');
    await fs.writeFile(
      file1Path,
      '# Introduction - Updated\n\nThis is the UPDATED introduction with more content.\n\nNow with [[advanced]] backlink!'
    );

    await expect.poll(async () => {
      return getGraphState(appWindow);
    }, {
      message: 'Waiting for file modification to be processed',
      timeout: 8000
    }).toMatchObject({
      nodes: 2
    });

    console.log('=== STEP 6: Delete a file ===');
    await fs.unlink(file2Path);

    await expect.poll(async () => {
      return getGraphState(appWindow);
    }, {
      message: 'Waiting for file deletion to be processed',
      timeout: 8000
    }).toEqual({ nodes: 1, edges: 0 });

    console.log('=== STEP 7: Create nested directory structure ===');
    const subDir = path.join(tempDir, 'concepts');
    await fs.mkdir(subDir);
    await createMarkdownFile(subDir, 'core.md', '# Core Concepts\n\nFundamental ideas.');
    await createMarkdownFile(subDir, 'utils.md', '# Utilities\n\nSee [[core]] for basics.');

    const finalState = await getGraphState(appWindow);
    expect(finalState?.nodes).toBeGreaterThanOrEqual(3);
    expect(finalState?.edges).toBeGreaterThanOrEqual(1);

    console.log('=== STEP 8: Stop watching ===');
    await stopWatching(appWindow);

    await expect.poll(async () => {
      return getGraphState(appWindow);
    }, {
      message: 'Waiting for graph to clear after stopping watching',
      timeout: 5000
    }).toEqual({ nodes: 0, edges: 0 });

    console.log('✓ Electron E2E test completed successfully');
  });

  test('should handle rapid real file changes without corruption', async ({ appWindow, tempDir }) => {
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const hasCytoscape = !!(window as ExtendedWindow).cytoscapeInstance;
        return document.readyState === 'complete' && hasCytoscape;
      });
    }, { timeout: 15000 }).toBe(true);

    // Start watching
    await appWindow.evaluate((dir) => {
      return (window as ExtendedWindow).electronAPI?.startFileWatching(dir);
    }, tempDir);

    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        return (window as ExtendedWindow).electronAPI?.getWatchStatus();
      });
    }, { timeout: 5000 }).toMatchObject({ isWatching: true });

    console.log('=== Testing rapid real file operations ===');

    const files = [
      { name: 'file1.md', content: '# File 1\n\nFirst file.' },
      { name: 'file2.md', content: '# File 2\n\nLinks to [[file1]].' },
      { name: 'file3.md', content: '# File 3\n\nLinks to [[file1]] and [[file2]].' },
      { name: 'file4.md', content: '# File 4\n\nLinks to [[file3]].' },
      { name: 'file5.md', content: '# File 5\n\nLinks to [[file4]] and [[file1]].' }
    ];

    for (const file of files) {
      await fs.writeFile(path.join(tempDir, file.name), file.content);
      await appWindow.waitForTimeout(50);
    }

    await expect.poll(async () => {
      return checkGraphIntegrity(appWindow);
    }, { timeout: 15000 }).toMatchObject({
      nodeCount: 5,
      edgeCount: expect.any(Number),
      orphanedEdges: 0,
      allNodesValid: true
    });

    const graphState = await getGraphState(appWindow);
    expect(graphState?.edges).toBeGreaterThanOrEqual(5);

    await fs.unlink(path.join(tempDir, 'file3.md'));
    await fs.unlink(path.join(tempDir, 'file4.md'));

    await expect.poll(async () => {
      return getGraphState(appWindow);
    }, { timeout: 10000 }).toMatchObject({ nodes: 3 });

    console.log('✓ Rapid file changes handled successfully');
  });
});

export { test };

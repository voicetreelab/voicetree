/**
 * BEHAVIORAL SPEC:
 * 1. findFileByName should find markdown files by suffix pattern
 * 2. It should respect maxDepth parameter
 * 3. It should return empty array when no matches found
 * 4. It should work with nested directory structures
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
}>({
  testDir: async ({}, use) => {
    // Create a test directory with various markdown files
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-ripgrep-test-'));

    // Create root level files
    await fs.writeFile(path.join(tempDir, 'introduction.md'), '# Introduction\n\nThis is an introduction.');
    await fs.writeFile(path.join(tempDir, 'readme.md'), '# README\n\nThis is a readme.');

    // Create nested directory with files
    const subDir = path.join(tempDir, 'nested');
    await fs.mkdir(subDir, { recursive: true });
    await fs.writeFile(path.join(subDir, 'deep-introduction.md'), '# Deep Intro\n\nNested intro.');
    await fs.writeFile(path.join(subDir, 'other-note.md'), '# Other\n\nSome other note.');

    // Create a deeper nested directory
    const deepDir = path.join(subDir, 'deeper');
    await fs.mkdir(deepDir, { recursive: true });
    await fs.writeFile(path.join(deepDir, 'very-deep.md'), '# Very Deep\n\nDeep nested file.');

    await use(tempDir);

    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  electronApp: async ({ testDir }, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-ripgrep-userdata-'));

    // Write config to auto-load the testDir
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        lastDirectory: testDir,
        vaultConfig: {
          [testDir]: {
            writePath: testDir,
            readPaths: []
          }
        }
      }, null, 2),
      'utf8'
    );

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

    // Cleanup
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
      // ignore
    }

    await electronApp.close();
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 10000 });

    window.on('pageerror', (error) => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Ripgrep file finder', () => {
  test('should find files matching suffix pattern', async ({ appWindow, testDir }) => {
    test.setTimeout(30000);

    const result = await appWindow.evaluate(async (searchPath: string) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.findFileByName('introduction', searchPath);
    }, testDir);

    console.log('Found files matching "introduction":', result);

    // Should find both introduction.md and deep-introduction.md
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((f: string) => f.includes('introduction'))).toBe(true);
  });

  test('should return empty array for non-existent pattern', async ({ appWindow, testDir }) => {
    test.setTimeout(30000);

    const result = await appWindow.evaluate(async (searchPath: string) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.findFileByName('xyznonexistent123', searchPath);
    }, testDir);

    console.log('Result for non-existent pattern:', result);

    expect(result).toEqual([]);
  });

  test('should respect maxDepth parameter', async ({ appWindow, testDir }) => {
    test.setTimeout(30000);

    // With depth 1, should find files in root and immediate children only
    const depthOneResult = await appWindow.evaluate(async (searchPath: string) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      // Search for all .md files with depth 1 (root only)
      return await api.main.findFileByName('', searchPath, 1);
    }, testDir);

    console.log('Files found at depth 1:', depthOneResult);

    // All results should be in root or one level deep (no deeper/very-deep.md)
    const hasVeryDeep = depthOneResult.some((f: string) => f.includes('very-deep'));
    expect(hasVeryDeep).toBe(false);

    // But should have root-level files
    const hasIntro = depthOneResult.some((f: string) => f.endsWith('introduction.md') && !f.includes('deep-introduction'));
    expect(hasIntro).toBe(true);
  });

  test('should find files in nested directories with sufficient depth', async ({ appWindow, testDir }) => {
    test.setTimeout(30000);

    // With default depth (10), should find all files including deeply nested ones
    const result = await appWindow.evaluate(async (searchPath: string) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.findFileByName('very-deep', searchPath);
    }, testDir);

    console.log('Found deeply nested file:', result);

    expect(result.length).toBe(1);
    expect(result[0]).toContain('very-deep.md');
  });
});

export { test };

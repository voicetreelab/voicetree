// Debug test to inspect DOM after floating window creation
import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

const PROJECT_ROOT = path.resolve(process.cwd());

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  tempDir: string;
}>({
  electronApp: async ({}, use) => {
    const electronApp = await electron.launch({
      args: [path.join(PROJECT_ROOT, 'dist-electron/main/index.js')],
      env: { ...process.env, NODE_ENV: 'test', HEADLESS_TEST: '1' }
    });
    await use(electronApp);
    await electronApp.close();
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });
    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as any).cytoscapeInstance, { timeout: 10000 });
    await window.waitForTimeout(1000);
    await use(window);
  },

  tempDir: async ({}, use) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'floating-window-test-'));
    await fs.writeFile(
      path.join(dir, 'test-file-1.md'),
      '# Test File 1\n\nThis is the first test file for floating window tests.'
    );
    await use(dir);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Debug: Inspect DOM after floating window creation', async ({ appWindow, tempDir }) => {
  // Start watching
  const watchResult = await appWindow.evaluate(async (dir) => {
    const api = (window as any).electronAPI;
    if (!api) throw new Error('electronAPI not available');
    return await api.startFileWatching(dir);
  }, tempDir);

  expect(watchResult.success).toBe(true);

  // Wait for nodes to appear
  await expect.poll(async () => {
    return appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      return cy ? cy.nodes().length : 0;
    });
  }, { timeout: 10000 }).toBeGreaterThan(0);

  // Tap on first node
  const tapResult = await appWindow.evaluate(() => {
    const cy = (window as any).cytoscapeInstance;
    const firstNode = cy.nodes().first();
    if (firstNode && firstNode.length > 0) {
      firstNode.trigger('tap');
      return { success: true, nodeId: firstNode.id() };
    }
    return { success: false };
  });

  expect(tapResult.success).toBe(true);

  // Wait for React to render - check multiple times
  for (let i = 0; i < 5; i++) {
    await appWindow.waitForTimeout(500);
    const quickCheck = await appWindow.evaluate(() => {
      const win = document.querySelector('[id*="window-"]');
      return win ? win.innerHTML.length : 0;
    });
    console.log(`Check ${i+1}: DOM content length = ${quickCheck}`);
    if (quickCheck > 0) break;
  }

  // Inspect the entire DOM structure
  const domInspection = await appWindow.evaluate(() => {
    const windows = document.querySelectorAll('[id*="window-"]');
    const result: any = {
      windowCount: windows.length,
      windows: []
    };

    windows.forEach(win => {
      const winInfo: any = {
        id: win.id,
        className: win.className,
        innerHTML: win.innerHTML.substring(0, 500),
        childrenCount: win.children.length,
        hasTextarea: !!win.querySelector('textarea'),
        hasButton: !!win.querySelector('button'),
        hasMarkdown: !!win.querySelector('[class*="markdown"]'),
        hasMDEditor: !!win.querySelector('[class*="MDEditor"]'),
        firstChild: win.firstElementChild ? {
          tagName: win.firstElementChild.tagName,
          className: win.firstElementChild.className,
          innerHTML: win.firstElementChild.innerHTML.substring(0, 200)
        } : null
      };
      result.windows.push(winInfo);
    });

    // Also check cy-floating-window elements
    const cyWindows = document.querySelectorAll('.cy-floating-window');
    result.cyWindowCount = cyWindows.length;

    return result;
  });

  console.log('DOM Inspection:', JSON.stringify(domInspection, null, 2));

  // Take screenshot
  await appWindow.screenshot({ path: 'tests/screenshots/electron-debug-dom.png' });
});
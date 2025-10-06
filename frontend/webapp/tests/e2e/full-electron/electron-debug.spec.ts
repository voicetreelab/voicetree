// Simple debug test to check electron app launches correctly
import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(process.cwd());

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    console.log('Launching electron from:', path.join(PROJECT_ROOT, 'dist-electron/main/index.js'));
    const electronApp = await electron.launch({
      args: [path.join(PROJECT_ROOT, 'dist-electron/main/index.js')],
      env: { ...process.env, NODE_ENV: 'test', HEADLESS_TEST: '1', DEBUG: '*' }
    });
    await use(electronApp);
    await electronApp.close();
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();

    // Log console for debugging
    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    window.on('pageerror', error => {
      console.error('Page error:', error);
    });

    await window.waitForLoadState('domcontentloaded');

    // Log what's available on window
    const windowState = await window.evaluate(() => {
      return {
        hasElectronAPI: !!(window as any).electronAPI,
        hasCytoscapeInstance: !!(window as any).cytoscapeInstance,
        hasCytoscapeCore: !!(window as any).cytoscapeCore,
        documentReady: document.readyState,
        bodyContent: document.body.innerHTML.substring(0, 200)
      };
    });

    console.log('Window state:', windowState);

    await use(window);
  }
});

test('Debug: Check electron app loads correctly', async ({ appWindow }) => {
  // Take screenshot
  await appWindow.screenshot({ path: 'tests/screenshots/electron-debug.png' });

  // Check if electron API is available
  const hasElectronAPI = await appWindow.evaluate(() => !!(window as any).electronAPI);
  console.log('Has electronAPI:', hasElectronAPI);
  expect(hasElectronAPI).toBe(true);

  // Wait a bit for app to initialize
  await appWindow.waitForTimeout(3000);

  // Check again for cytoscapeInstance
  const hasCytoscape = await appWindow.evaluate(() => !!(window as any).cytoscapeInstance);
  console.log('Has cytoscapeInstance after wait:', hasCytoscape);

  // Get page title
  const title = await appWindow.title();
  console.log('Page title:', title);

  // Get full window state
  const finalState = await appWindow.evaluate(() => {
    return {
      cytoscapeInstance: !!(window as any).cytoscapeInstance,
      cytoscapeCore: !!(window as any).cytoscapeCore,
      modules: Object.keys(window).filter(k => k.includes('cytoscape') || k.includes('electron'))
    };
  });

  console.log('Final window state:', finalState);
});
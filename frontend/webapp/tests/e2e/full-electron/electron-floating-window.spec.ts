// tests/e2e/full-electron/electron-floating-window.spec.ts
// E2E test for floating windows in Electron app

import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(process.cwd());

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
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

    // Log all console messages to see registration logs
    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    await window.waitForLoadState('domcontentloaded');

    // Wait for Cytoscape instance
    await window.waitForFunction(() => (window as any).cytoscapeInstance, { timeout: 10000 });
    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Floating Window - Electron E2E', () => {

  test('should create floating window in Electron app', async ({ appWindow }) => {
    // Debug: Check what's available
    const debugInfo = await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      const core = (window as any).cytoscapeCore;
      return {
        hasCy: !!cy,
        hasCore: !!core,
        cyType: typeof cy,
        coreType: typeof core,
        cyHasMethod: typeof cy?.addFloatingWindow,
        coreHasMethod: typeof core?.addFloatingWindow,
        cyProtoMethods: cy ? Object.getOwnPropertyNames(Object.getPrototypeOf(cy)).filter((k: string) => k.includes('Float') || k.includes('add')) : [],
        coreProtoMethods: core ? Object.getOwnPropertyNames(Object.getPrototypeOf(core)).filter((k: string) => k.includes('Float') || k.includes('add')) : []
      };
    });
    console.log('Debug info:', JSON.stringify(debugInfo, null, 2));

    //  Test: Verify extension registered
    const hasExtension = await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      return typeof cy?.addFloatingWindow === 'function';
    });

    expect(hasExtension).toBe(true);

    // ✅ Test 2: Create floating window
    const result = await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;

      try {
        const shadowNode = cy.addFloatingWindow({
          id: 'test-window',
          component: '<div style="padding: 20px; background: white;">Test Window</div>',
          position: { x: 300, y: 300 }
        });

        return {
          success: true,
          shadowNodeExists: shadowNode && shadowNode.length > 0
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    expect(result.success).toBe(true);
    expect(result.shadowNodeExists).toBe(true);

    // ✅ Test 3: Verify window element in DOM
    const windowElement = await appWindow.locator('#window-test-window');
    await expect(windowElement).toBeVisible();

    // ✅ Test 4: Screenshot
    await appWindow.screenshot({
      path: 'tests/screenshots/electron-floating-window.png'
    });
  });

  test('should handle window interactions', async ({ appWindow }) => {
    await appWindow.evaluate(() => {
      const cy = (window as any).cytoscapeInstance;
      cy.addFloatingWindow({
        id: 'interactive-window',
        component: '<textarea placeholder="Type here"></textarea>',
        position: { x: 400, y: 300 },
        resizable: true
      });
    });

    const textarea = appWindow.locator('#window-interactive-window textarea');
    await textarea.fill('Hello from Electron!');

    const value = await textarea.inputValue();
    expect(value).toBe('Hello from Electron!');
  });
});

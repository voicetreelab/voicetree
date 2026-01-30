/**
 * Browser-based test for terminal cycling hotkeys
 * Tests that Cmd+] and Cmd+[ cycle through open floating terminals
 *
 * This test mocks terminal creation since actual terminals require IPC
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  selectMockProject,
  createTestGraphDelta,
  sendGraphDelta,
  waitForCytoscapeReady,
  exposeTerminalStoreAPI,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils';

// Custom fixture to capture console logs and only show on failure
type ConsoleCapture = {
  consoleLogs: string[];
  pageErrors: string[];
  testLogs: string[];
};

const test = base.extend<{ consoleCapture: ConsoleCapture }>({
  consoleCapture: async ({ page }, use, testInfo) => {
    const consoleLogs: string[] = [];
    const pageErrors: string[] = [];
    const testLogs: string[] = [];

    // Capture browser console
    page.on('console', msg => {
      consoleLogs.push(`[Browser ${msg.type()}] ${msg.text()}`);
    });

    page.on('pageerror', error => {
      pageErrors.push(`[Browser Error] ${error.message}\n${error.stack ?? ''}`);
    });

    // Capture test's own console.log
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      testLogs.push(args.map(arg => String(arg)).join(' '));
    };

    await use({ consoleLogs, pageErrors, testLogs });

    // Restore original console.log
    console.log = originalLog;

    // After test completes, check if it failed and print logs
    if (testInfo.status !== 'passed') {
      console.log('\n=== Test Logs ===');
      testLogs.forEach(log => console.log(log));
      console.log('\n=== Browser Console Logs ===');
      consoleLogs.forEach(log => console.log(log));
      if (pageErrors.length > 0) {
        console.log('\n=== Browser Errors ===');
        pageErrors.forEach(err => console.log(err));
      }
    }
  }
});

test.describe('Terminal Cycling (Browser)', () => {
  test('should cycle through floating terminals with Cmd+] and Cmd+[', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting terminal cycling test ===');

    console.log('=== Step 1: Setup mock Electron API ===');
    await setupMockElectronAPI(page);

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);

    console.log('=== Step 4: Expose TerminalStore API ===');
    await exposeTerminalStoreAPI(page);

    console.log('=== Step 5: Create base graph with nodes ===');
    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(50);

    console.log('=== Step 6: Create mock terminal nodes (mimicking real terminal structure) ===');
    // Real terminals are registered in TerminalStore AND have shadow nodes in cy
    // We need to do both for cycling to work

    const terminalInfo = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Get TerminalStore API exposed by VoiceTreeGraphView
      const terminalStoreAPI = (window as ExtendedWindow & {
        terminalStoreAPI?: {
          addTerminal: (data: unknown) => void;
          createTerminalData: (params: { attachedToNodeId: string; terminalCount: number; title: string }) => unknown;
          getTerminalId: (data: unknown) => string;
          getShadowNodeId: (id: string) => string;
        };
      }).terminalStoreAPI;
      if (!terminalStoreAPI) throw new Error('TerminalStore API not exposed');

      // Get some existing nodes to use as parents
      const nodes = cy.nodes();
      if (nodes.length < 3) throw new Error('Need at least 3 nodes');

      const parent1 = nodes[0].id();
      const parent2 = nodes[1].id();
      const parent3 = nodes[2].id();

      // Create terminals in TerminalStore
      const terminal1 = terminalStoreAPI.createTerminalData({ attachedToNodeId: parent1, terminalCount: 0, title: 'Terminal 1' });
      const terminal2 = terminalStoreAPI.createTerminalData({ attachedToNodeId: parent2, terminalCount: 0, title: 'Terminal 2' });
      const terminal3 = terminalStoreAPI.createTerminalData({ attachedToNodeId: parent3, terminalCount: 0, title: 'Terminal 3' });

      terminalStoreAPI.addTerminal(terminal1);
      terminalStoreAPI.addTerminal(terminal2);
      terminalStoreAPI.addTerminal(terminal3);

      const shadowId1 = terminalStoreAPI.getShadowNodeId(terminalStoreAPI.getTerminalId(terminal1));
      const shadowId2 = terminalStoreAPI.getShadowNodeId(terminalStoreAPI.getTerminalId(terminal2));
      const shadowId3 = terminalStoreAPI.getShadowNodeId(terminalStoreAPI.getTerminalId(terminal3));

      // Create shadow nodes in cytoscape
      // Position them very far apart so fitting to one terminal will definitely change viewport
      cy.add([
        {
          group: 'nodes',
          data: {
            id: shadowId1,
            parentId: parent1,
            parentNodeId: parent1,
            isFloatingWindow: true,
            isShadowNode: true,
            windowType: 'Terminal',
            laidOut: false
          },
          position: { x: 0, y: 0 }
        },
        {
          group: 'nodes',
          data: {
            id: shadowId2,
            parentId: parent2,
            parentNodeId: parent2,
            isFloatingWindow: true,
            isShadowNode: true,
            windowType: 'Terminal',
            laidOut: false
          },
          position: { x: 10000, y: 0 }
        },
        {
          group: 'nodes',
          data: {
            id: shadowId3,
            parentId: parent3,
            parentNodeId: parent3,
            isFloatingWindow: true,
            isShadowNode: true,
            windowType: 'Terminal',
            laidOut: false
          },
          position: { x: 20000, y: 0 }
        }
      ]);

      return {
        parent1,
        parent2,
        parent3,
        shadowIds: [shadowId1, shadowId2, shadowId3]
      };
    });

    console.log('✓ Created 3 mock terminal shadow nodes:', terminalInfo.shadowIds);

    console.log('=== Step 7: Fit to all nodes ===');
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      cy.fit();
    });
    await page.waitForTimeout(30);

    // Get initial active terminal state (should be null before first cycle)
    const initialActiveTerminal = await page.evaluate(() => {
      const terminalStoreAPI = (window as ExtendedWindow).terminalStoreAPI;
      return terminalStoreAPI?.getActiveTerminalId() ?? null;
    });
    console.log(`Initial active terminal: ${initialActiveTerminal}`);

    console.log('=== Step 8: Press Cmd+] (next terminal) ===');
    await page.keyboard.press('Meta+BracketRight');
    await page.waitForTimeout(100);

    const activeTerminalAfterNext = await page.evaluate(() => {
      const terminalStoreAPI = (window as ExtendedWindow).terminalStoreAPI;
      return terminalStoreAPI?.getActiveTerminalId() ?? null;
    });

    console.log(`After Cmd+] active terminal: ${activeTerminalAfterNext}`);

    // Check that a terminal is now active (cycling occurred)
    expect(activeTerminalAfterNext).not.toBe(null);
    expect(activeTerminalAfterNext).toBeTruthy();
    console.log('✓ Cmd+] successfully cycled to terminal');

    console.log('=== Step 9: Press Cmd+[ (previous terminal) ===');
    await page.keyboard.press('Meta+BracketLeft');
    await page.waitForTimeout(100);

    const activeTerminalAfterPrev = await page.evaluate(() => {
      const terminalStoreAPI = (window as ExtendedWindow).terminalStoreAPI;
      return terminalStoreAPI?.getActiveTerminalId() ?? null;
    });

    console.log(`After Cmd+[ active terminal: ${activeTerminalAfterPrev}`);

    // Check that active terminal changed (cycling backward occurred)
    expect(activeTerminalAfterPrev).not.toBe(null);
    expect(activeTerminalAfterPrev).not.toBe(activeTerminalAfterNext);
    console.log('✓ Cmd+[ successfully cycled to previous terminal');

    console.log('✓ Terminal cycling test completed successfully');
  });
});

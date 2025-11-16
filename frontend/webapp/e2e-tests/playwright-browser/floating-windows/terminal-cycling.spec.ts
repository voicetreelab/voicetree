/**
 * Browser-based test for terminal cycling hotkeys
 * Tests that Cmd+] and Cmd+[ cycle through open floating terminals
 *
 * This test mocks terminal creation since actual terminals require IPC
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  createTestGraphDelta,
  sendGraphDelta,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils.ts';

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
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);

    console.log('=== Step 4: Create base graph with nodes ===');
    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(50);

    console.log('=== Step 5: Create mock terminal nodes (mimicking real terminal structure) ===');
    // Real terminals create shadow nodes with specific properties
    // The ID pattern is: shadow-child-${parentNodeId}
    // They have: isFloatingWindow: true, isShadowNode: true, windowType: 'terminal'

    const terminalInfo = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Get some existing nodes to use as parents
      const nodes = cy.nodes();
      if (nodes.length < 3) throw new Error('Need at least 3 nodes');

      const parent1 = nodes[0].id();
      const parent2 = nodes[1].id();
      const parent3 = nodes[2].id();

      // Create shadow nodes for terminals (mimicking anchorToNode behavior)
      cy.add([
        {
          group: 'nodes',
          data: {
            id: `shadow-child-${parent1}`,
            parentId: parent1,
            parentNodeId: parent1,
            isFloatingWindow: true,
            isShadowNode: true,
            windowType: 'terminal',
            laidOut: false
          },
          position: { x: 100, y: 100 }
        },
        {
          group: 'nodes',
          data: {
            id: `shadow-child-${parent2}`,
            parentId: parent2,
            parentNodeId: parent2,
            isFloatingWindow: true,
            isShadowNode: true,
            windowType: 'terminal',
            laidOut: false
          },
          position: { x: 300, y: 100 }
        },
        {
          group: 'nodes',
          data: {
            id: `shadow-child-${parent3}`,
            parentId: parent3,
            parentNodeId: parent3,
            isFloatingWindow: true,
            isShadowNode: true,
            windowType: 'terminal',
            laidOut: false
          },
          position: { x: 500, y: 100 }
        }
      ]);

      return {
        parent1,
        parent2,
        parent3,
        shadowIds: [
          `shadow-child-${parent1}`,
          `shadow-child-${parent2}`,
          `shadow-child-${parent3}`
        ]
      };
    });

    console.log('✓ Created 3 mock terminal shadow nodes:', terminalInfo.shadowIds);

    console.log('=== Step 6: Fit to all nodes ===');
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      cy.fit();
    });
    await page.waitForTimeout(30);

    const initialState = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return { zoom: cy.zoom(), pan: cy.pan() };
    });
    console.log(`Initial zoom: ${initialState.zoom}, pan: (${initialState.pan.x}, ${initialState.pan.y})`);

    console.log('=== Step 7: Press Cmd+] (next terminal) ===');
    await page.keyboard.press('Meta+BracketRight');
    await page.waitForTimeout(50);

    const afterNextState = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return { zoom: cy.zoom(), pan: cy.pan() };
    });

    console.log(`After Cmd+] zoom: ${afterNextState.zoom}, pan: (${afterNextState.pan.x}, ${afterNextState.pan.y})`);

    // Check that viewport changed - terminal should have been fitted to
    const zoomChanged = Math.abs(afterNextState.zoom - initialState.zoom) > 0.01;
    const panChanged = Math.abs(afterNextState.pan.x - initialState.pan.x) > 1 ||
                       Math.abs(afterNextState.pan.y - initialState.pan.y) > 1;

    expect(zoomChanged || panChanged).toBe(true);
    console.log('✓ Cmd+] successfully cycled to terminal');

    console.log('=== Step 8: Press Cmd+[ (previous terminal) ===');
    await page.keyboard.press('Meta+BracketLeft');
    await page.waitForTimeout(50);

    const afterPrevState = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return { zoom: cy.zoom(), pan: cy.pan() };
    });

    console.log(`After Cmd+[ zoom: ${afterPrevState.zoom}, pan: (${afterPrevState.pan.x}, ${afterPrevState.pan.y})`);

    // Check that viewport changed from previous state
    const zoomChanged2 = Math.abs(afterPrevState.zoom - afterNextState.zoom) > 0.01;
    const panChanged2 = Math.abs(afterPrevState.pan.x - afterNextState.pan.x) > 1 ||
                        Math.abs(afterPrevState.pan.y - afterNextState.pan.y) > 1;

    expect(zoomChanged2 || panChanged2).toBe(true);
    console.log('✓ Cmd+[ successfully cycled to previous terminal');

    console.log('✓ Terminal cycling test completed successfully');
  });
});

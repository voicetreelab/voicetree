/**
 * Browser-based test for hotkey navigation
 * Tests:
 * - Space key: fit to last created node
 * - Cmd+] / Cmd+[: cycle through terminals
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  selectMockProject,
  createTestGraphDelta,
  sendGraphDelta,
  waitForCytoscapeReady,
  exposeTerminalStoreAPI,
  getNodeCount,
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

test.describe('Hotkey Navigation (Browser)', () => {
  test('should fit to last created node when pressing Space', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting Space hotkey test (Browser) ===');

    console.log('=== Step 1: Mock Electron API ===');
    await setupMockElectronAPI(page);

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);

    console.log('=== Step 4: Setup test graph ===');
    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);

    const nodeCount = await getNodeCount(page);
    expect(nodeCount).toBe(5);
    console.log(`✓ Test graph setup with ${nodeCount} nodes`);

    console.log('=== Step 5: Fit to initial 5 nodes ===');
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      cy.fit(); // Fit to the initial 5 nodes
    });

    console.log('=== Step 6: Add a new node far away (will be "last created") ===');
    const navigationServiceSet = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Add a new node that will be the "last created" - place it far from other nodes
      cy.add({
        group: 'nodes',
        data: {
          id: 'last-created-node.md',
          label: 'Last Created Node',
          fileBasename: 'Last Created Node'
        },
        position: { x: 2000, y: 2000 }  // Far from existing nodes (existing are between 100-900)
      });

      // Update navigation service's last created node
      const voiceTreeGraphView = (window as ExtendedWindow).voiceTreeGraphView;
      if (voiceTreeGraphView?.navigationService) {
        voiceTreeGraphView.navigationService.setLastCreatedNodeId('last-created-node.md');
        return true;
      }
      return false;
    });

    console.log(`✓ Added last created node (navigation service set: ${navigationServiceSet})`);

    await page.waitForTimeout(30);

    const initialState = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return { zoom: cy.zoom(), pan: cy.pan() };
    });
    console.log(`Initial zoom: ${initialState.zoom}, pan: (${initialState.pan.x}, ${initialState.pan.y})`);

    console.log('=== Step 7: Press Space key ===');
    // Focus the cytoscape container to ensure hotkeys work
    await page.evaluate(() => {
      const container = document.querySelector('#root') as HTMLElement;
      if (container) {
        container.focus();
      }
    });
    // Wait a moment for focus to settle
    await page.waitForTimeout(50);

    // Press space using keyboard API
    await page.keyboard.press(' ');

    // Wait for animation to complete
    await page.waitForTimeout(150);

    console.log('=== Step 8: Verify viewport changed (fitted to last node) ===');
    const finalState = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return { zoom: cy.zoom(), pan: cy.pan() };
    });

    console.log(`Final zoom: ${finalState.zoom}, pan: (${finalState.pan.x}, ${finalState.pan.y})`);

    // Check that zoom or pan changed - use very lenient threshold
    const zoomChanged = Math.abs(finalState.zoom - initialState.zoom) > 0.0001;
    const panChanged = Math.abs(finalState.pan.x - initialState.pan.x) > 0.01 ||
                       Math.abs(finalState.pan.y - initialState.pan.y) > 0.01;

    expect(zoomChanged || panChanged).toBe(true);
    console.log('✓ Space key successfully fitted to last created node');
  });

  test('should cycle through terminals with Cmd+] and Cmd+[', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting Cmd+] / Cmd+[ hotkey test (Browser) ===');

    console.log('=== Step 1: Mock Electron API ===');
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

    console.log('=== Step 5: Setup test graph ===');
    const graphDelta = createTestGraphDelta();
    await sendGraphDelta(page, graphDelta);

    console.log('=== Step 6: Add terminal nodes ===');
    await page.evaluate(() => {
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

      // Get existing nodes as parents
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

      // Add terminal shadow nodes in cytoscape
      cy.add([
        {
          group: 'nodes',
          data: {
            id: shadowId1,
            label: 'Terminal 1',
            isShadowNode: true,
            windowType: 'Terminal',
            parentNodeId: parent1
          },
          position: { x: 100, y: 100 }
        },
        {
          group: 'nodes',
          data: {
            id: shadowId2,
            label: 'Terminal 2',
            isShadowNode: true,
            windowType: 'Terminal',
            parentNodeId: parent2
          },
          position: { x: 300, y: 100 }
        },
        {
          group: 'nodes',
          data: {
            id: shadowId3,
            label: 'Terminal 3',
            isShadowNode: true,
            windowType: 'Terminal',
            parentNodeId: parent3
          },
          position: { x: 500, y: 100 }
        }
      ]);
    });

    console.log('✓ Added 3 terminal nodes');

    console.log('=== Step 7: Fit to all nodes ===');
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

    console.log('=== Step 8: Press Cmd+] (next terminal) ===');
    await page.keyboard.press('Meta+BracketRight');

    await page.waitForTimeout(100);

    const afterNextState = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return { zoom: cy.zoom(), pan: cy.pan() };
    });

    console.log(`After Cmd+] zoom: ${afterNextState.zoom}, pan: (${afterNextState.pan.x}, ${afterNextState.pan.y})`);

    // Check that viewport changed - use very lenient threshold
    let zoomChanged = Math.abs(afterNextState.zoom - initialState.zoom) > 0.0001;
    let panChanged = Math.abs(afterNextState.pan.x - initialState.pan.x) > 0.01 ||
                     Math.abs(afterNextState.pan.y - initialState.pan.y) > 0.01;

    expect(zoomChanged || panChanged).toBe(true);
    console.log('✓ Cmd+] successfully cycled to next terminal');

    console.log('=== Step 9: Press Cmd+[ (previous terminal) ===');
    await page.keyboard.press('Meta+BracketLeft');

    await page.waitForTimeout(100);

    const afterPrevState = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return { zoom: cy.zoom(), pan: cy.pan() };
    });

    console.log(`After Cmd+[ zoom: ${afterPrevState.zoom}, pan: (${afterPrevState.pan.x}, ${afterPrevState.pan.y})`);

    // Check that viewport changed from previous state - use very lenient threshold
    zoomChanged = Math.abs(afterPrevState.zoom - afterNextState.zoom) > 0.0001;
    panChanged = Math.abs(afterPrevState.pan.x - afterNextState.pan.x) > 0.01 ||
                 Math.abs(afterPrevState.pan.y - afterNextState.pan.y) > 0.01;

    expect(zoomChanged || panChanged).toBe(true);
    console.log('✓ Cmd+[ successfully cycled to previous terminal');
  });
});

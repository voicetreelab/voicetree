/**
 * BEHAVIORAL SPEC:
 * E2E test for terminal selection highlighting
 *
 * This test verifies:
 * 1. When a terminal is selected/navigated to, it gets a gold outline (terminal-active class on shadow node)
 * 2. The edge from task node to terminal also gets gold highlighting (terminal-active class on edge)
 *
 * The feature helps users visually identify which terminal is currently active
 * and its connection to the task node.
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

// Use example_small for faster loading
const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');
const SCREENSHOTS_DIR = path.join(PROJECT_ROOT, 'e2e-tests', 'screenshots');

// Type definitions
interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
  voiceTreeGraphView?: {
    navigationService?: {
      cycleTerminal: (direction: 1 | -1) => void;
      getActiveTerminalId: () => string | null;
    };
  };
}

// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-terminal-highlight-test-'));

    // Write the config file to auto-load the test vault
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({
      lastDirectory: FIXTURE_VAULT_PATH,
      suffixes: {
        [FIXTURE_VAULT_PATH]: ''
      }
    }, null, 2), 'utf8');
    console.log('[Test] Created config file to auto-load:', FIXTURE_VAULT_PATH);

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        VOICETREE_PERSIST_STATE: '1'
        // No MINIMIZE_TEST so screenshots are useful
      },
      timeout: 10000
    });

    await use(electronApp);

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

    // Cleanup temp directory
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15000 });

    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');

    // Wait for cytoscape instance
    try {
      await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    } catch (error) {
      console.error('Failed to initialize cytoscape instance:', error);
      throw error;
    }

    // Ensure screenshots directory exists
    await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });

    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Terminal Selection Highlighting E2E', () => {
  test('terminal shows gold highlighting when selected', async ({ appWindow }) => {
    test.setTimeout(90000);

    console.log('=== STEP 1: Wait for auto-load to complete ===');
    await appWindow.waitForFunction(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return false;
      return cy.nodes().length > 0;
    }, { timeout: 15000 });
    console.log('Graph auto-loaded with nodes');

    console.log('=== STEP 2: Get a node to create terminal from ===');
    const targetNodeId = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      // Get a node that is NOT a context node (regular file node)
      const node = cy.nodes().filter((n) => {
        const isContextNode = n.data('isContextNode') === true;
        const isShadowNode = n.data('isShadowNode') === true;
        return !isContextNode && !isShadowNode;
      }).first();
      if (!node || node.length === 0) throw new Error('No suitable node found');
      return node.id();
    });

    console.log(`Target node (task node): ${targetNodeId}`);

    console.log('=== STEP 3: Spawn terminal on the task node ===');
    // Use spawnPlainTerminal to create terminal with floating window UI
    await appWindow.evaluate(async (nodeId) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      // terminalCount=0 for first terminal
      await api.main.spawnPlainTerminal(nodeId, 0);
    }, targetNodeId);

    // Wait for terminal to spawn and render
    await appWindow.waitForTimeout(2000);

    console.log('=== STEP 4: Verify terminal floating window exists ===');
    const terminalWindow = appWindow.locator('.cy-floating-window-terminal');
    await expect(terminalWindow).toBeVisible({ timeout: 5000 });
    console.log('Terminal floating window visible');

    console.log('=== STEP 5: Navigate to the terminal (triggers highlighting) ===');
    // Use cycleTerminal to select/navigate to the terminal
    // This calls fitToTerminal internally, which triggers the terminal-active highlighting
    await appWindow.evaluate(() => {
      // Access the navigation service through the graph view
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const graphView = (window as any).voiceTreeGraphView;
      if (!graphView?.navigationService) {
        throw new Error('Navigation service not available');
      }
      // Cycle to next terminal (which is our only terminal, so it selects it)
      graphView.navigationService.cycleTerminal(1);
    });

    // Wait for highlighting to be applied
    await appWindow.waitForTimeout(500);

    console.log('=== STEP 6: Verify terminal-active class is applied ===');
    const highlightState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      // Check for shadow nodes with terminal-active class
      const activeShadowNodes = cy.nodes('.terminal-active');
      const activeEdges = cy.edges('.terminal-active');

      // Check for terminal-indicator edges (required for gold highlight style)
      const indicatorEdges = cy.edges('.terminal-indicator');
      // Check for edges with BOTH classes (gold highlight selector)
      const goldEdges = cy.edges('.terminal-indicator.terminal-active');
      // All shadow nodes
      const allShadowNodes = cy.nodes('[?isShadowNode]');
      // All edges targeting shadow nodes
      const allEdgesToShadow = cy.edges().filter((e: {target: () => {data: (key: string) => boolean}}) => e.target().data('isShadowNode') === true);

      // Get details about the highlighted elements
      const shadowNodeIds = activeShadowNodes.map((n: {id: () => string}) => n.id());
      const edgeIds = activeEdges.map((e: {source: () => {id: () => string}; target: () => {id: () => string}}) => `${e.source().id()} -> ${e.target().id()}`);
      const indicatorEdgeIds = indicatorEdges.map((e: {source: () => {id: () => string}; target: () => {id: () => string}; classes: () => string[]}) =>
        `${e.source().id()} -> ${e.target().id()} [classes: ${e.classes().join(', ')}]`
      );
      const goldEdgeIds = goldEdges.map((e: {source: () => {id: () => string}; target: () => {id: () => string}}) =>
        `${e.source().id()} -> ${e.target().id()}`
      );

      return {
        shadowNodeCount: activeShadowNodes.length,
        edgeCount: activeEdges.length,
        indicatorEdgeCount: indicatorEdges.length,
        goldEdgeCount: goldEdges.length,
        allShadowNodeCount: allShadowNodes.length,
        allEdgesToShadowCount: allEdgesToShadow.length,
        shadowNodeIds,
        edgeIds,
        indicatorEdgeIds,
        goldEdgeIds
      };
    });

    const debugOutput = [
      'Highlighting state:',
      `  All shadow nodes: ${highlightState.allShadowNodeCount}`,
      `  All edges to shadow nodes: ${highlightState.allEdgesToShadowCount}`,
      `  Shadow nodes with terminal-active: ${highlightState.shadowNodeCount}`,
      `  Shadow node IDs: ${highlightState.shadowNodeIds.join(', ')}`,
      `  Edges with terminal-active: ${highlightState.edgeCount}`,
      `  Edge connections: ${highlightState.edgeIds.join(', ')}`,
      `  terminal-indicator edges: ${highlightState.indicatorEdgeCount}`,
      `  Indicator edge details: ${highlightState.indicatorEdgeIds.join('; ')}`,
      `  GOLD edges (indicator + active): ${highlightState.goldEdgeCount}`,
      `  Gold edge details: ${highlightState.goldEdgeIds.join('; ')}`
    ].join('\n');
    console.log(debugOutput);
    // Write to file for debugging
    await fs.writeFile(path.join(SCREENSHOTS_DIR, 'debug-output.txt'), debugOutput, 'utf8');

    console.log('=== STEP 7: Take screenshot for visual verification ===');
    // Debug: Check computed styles of the gold edge
    const edgeStyles = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return null;
      const goldEdge = cy.edges('.terminal-indicator.terminal-active').first();
      if (goldEdge.length === 0) return { error: 'No gold edge found' };
      return {
        classes: goldEdge.classes(),
        lineColor: goldEdge.style('line-color'),
        lineOpacity: goldEdge.style('line-opacity'),
        width: goldEdge.style('width'),
        display: goldEdge.style('display'),
        visibility: goldEdge.style('visibility'),
        sourcePos: goldEdge.source().position(),
        targetPos: goldEdge.target().position(),
      };
    });
    console.log('Gold edge styles:', JSON.stringify(edgeStyles, null, 2));
    await fs.writeFile(path.join(SCREENSHOTS_DIR, 'edge-styles.txt'), JSON.stringify(edgeStyles, null, 2), 'utf8');

    // Pan/zoom to show the terminal and its connection clearly
    await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return;
      // Fit to show the active terminal and its connected nodes
      const activeNodes = cy.nodes('.terminal-active');
      if (activeNodes.length > 0) {
        // Include the parent/task node in the fit
        const nodesToFit = activeNodes.closedNeighborhood().nodes();
        cy.fit(nodesToFit, 50);
      }
    });
    await appWindow.waitForTimeout(300);

    // Take full page screenshot
    await appWindow.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'terminal-selection-highlighting.png'),
      fullPage: true
    });
    console.log('Screenshot saved: e2e-tests/screenshots/terminal-selection-highlighting.png');

    // Also take a cropped screenshot focusing on the terminal area
    const terminalBox = await terminalWindow.boundingBox();
    if (terminalBox) {
      // Expand the crop area to include the edge and some surrounding context
      const cropPadding = 100;
      await appWindow.screenshot({
        path: path.join(SCREENSHOTS_DIR, 'terminal-selection-highlighting-cropped.png'),
        clip: {
          x: Math.max(0, terminalBox.x - cropPadding),
          y: Math.max(0, terminalBox.y - cropPadding),
          width: terminalBox.width + (cropPadding * 2),
          height: terminalBox.height + (cropPadding * 2)
        }
      });
      console.log('Cropped screenshot saved: e2e-tests/screenshots/terminal-selection-highlighting-cropped.png');
    }

    console.log('=== STEP 8: Assert terminal-active highlighting is applied ===');
    // Verify that at least one shadow node has the terminal-active class
    expect(highlightState.shadowNodeCount).toBeGreaterThan(0);
    console.log('Shadow node has terminal-active class');

    // Verify that at least one edge has the terminal-active class
    expect(highlightState.edgeCount).toBeGreaterThan(0);
    console.log('Edge has terminal-active class');

    console.log('');
    console.log('TERMINAL SELECTION HIGHLIGHTING TEST PASSED');
    console.log('Review screenshots at: e2e-tests/screenshots/terminal-selection-highlighting*.png');
  });
});

export { test };

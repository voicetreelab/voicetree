import { test, expect } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';

/**
 * Minimal test to isolate the Cytoscape instance access issue
 * Tests the bare minimum: Can we access Cytoscape instance and query its nodes?
 */

interface ExtendedWindow extends Window {
  cytoscapeInstance?: CytoscapeCore;
}

interface CytoscapeState {
  hasCytoscapeInstance: boolean;
  cytoscapeType: string;
  hasNodesMethod: boolean;
}
test.describe('Minimal Cytoscape Instance Access', () => {
  test('should expose cytoscape instance and reflect graph data', async ({ page }) => {
    // Capture all console messages
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      consoleLogs.push(msg.text());
    });

    // Navigate to the application
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Step 1: Verify initial state - cytoscapeInstance should exist
    const initialState = await page.evaluate((): CytoscapeState => {
      const win = window as ExtendedWindow;
      return {
        hasCytoscapeInstance: !!win.cytoscapeInstance,
        cytoscapeType: typeof win.cytoscapeInstance,
        hasNodesMethod: !!win.cytoscapeInstance?.nodes,
      };
    });

    console.log('Initial state:', initialState);
    expect(initialState.hasCytoscapeInstance).toBe(true);
    expect(initialState.hasNodesMethod).toBe(true);

    // Step 2: Directly trigger a file event to add data
    await page.evaluate(() => {
      const event = new CustomEvent('file-added', {
        detail: {
          path: 'test.md',
          content: '# Test Node'
        }
      });
      window.dispatchEvent(event);
    });

    // Wait for processing (includes the 500ms setTimeout for graph update)
    await page.waitForTimeout(2000);

    // Step 3: Check if UI shows the node (via DOM, not Cytoscape)
    const uiNodeCount = await page.evaluate(() => {
      // Look for ALL node count displays in the UI
      const elements = Array.from(document.querySelectorAll('*'));
      const nodeDisplays = elements.filter(el =>
        el.textContent?.includes('nodes') &&
        el.textContent?.includes('edges') &&
        !el.textContent?.includes('function')
      );
      return {
        count: nodeDisplays.length,
        texts: nodeDisplays.map(el => el.textContent?.trim()).slice(0, 5)
      };
    });

    console.log('UI shows:', uiNodeCount);

    // Step 4: Try to get nodes from cytoscapeInstance
    const cytoscapeState = await page.evaluate((): { hasNodes?: boolean; hasElements?: boolean; hasDollar?: boolean; nodesCount?: number; elementsCount?: number; dollarCount?: number; error?: string } => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return { error: 'no cytoscapeInstance' };

      try {
        // Try different ways to get nodes
        const nodesMethod = cy.nodes ? cy.nodes() : null;
        const elementsMethod = cy.elements ? cy.elements('node') : null;
        const dollarMethod = cy.$ ? cy.$('node') : null;

        return {
          hasNodes: typeof cy.nodes === 'function',
          hasElements: typeof cy.elements === 'function',
          hasDollar: typeof cy.$ === 'function',
          nodesCount: nodesMethod ? nodesMethod.length : -1,
          elementsCount: elementsMethod ? elementsMethod.length : -1,
          dollarCount: dollarMethod ? dollarMethod.length : -1,
        };
      } catch (e) {
        return { error: e instanceof Error ? e.toString() : 'Unknown error' };
      }
    });

    console.log('Cytoscape state:', cytoscapeState);

    // Print relevant logs
    const relevantLogs = consoleLogs.filter(log =>
      log.includes('VoiceTreeLayout') ||
      log.includes('Adding elements') ||
      log.includes('nodes count')
    );
    console.log('Relevant console logs:', relevantLogs);

    // This should pass but probably won't - that's our issue
    expect(cytoscapeState.nodesCount).toBeGreaterThan(0);
  });

  test('should verify cytoscapeInstance updates after graph changes', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Add console listener to debug
    page.on('console', msg => {
      if (msg.text().includes('VoiceTreeLayout') || msg.text().includes('cytoscapeInstance')) {
        console.log('Console:', msg.text());
      }
    });

    // Wait for initial setup
    await page.waitForTimeout(1000);

    // Check what's actually in cytoscapeInstance
    const debugInfo = await page.evaluate((): { ownProps?: string[]; protoProps?: string[]; isFunction?: Record<string, string>; error?: string } => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return { error: 'no instance' };

      // Get all properties and methods
      const props = Object.getOwnPropertyNames(cy);
      const proto = Object.getPrototypeOf(cy);
      const protoProps = proto ? Object.getOwnPropertyNames(proto) : [];

      return {
        ownProps: props.slice(0, 10), // First 10 to avoid too much output
        protoProps: protoProps.slice(0, 10),
        isFunction: {
          nodes: typeof (cy as any).nodes,
          elements: typeof (cy as any).elements,
          add: typeof (cy as any).add,
          getCore: typeof (cy as any).getCore,
        }
      };
    });

    console.log('CytoscapeInstance debug info:', debugInfo);

    // Try to access the actual cytoscape core
    const coreAccess = await page.evaluate((): { hasCore: boolean; coreHasNodes?: boolean; coreNodesCount?: number; error?: string } => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return { error: 'no instance', hasCore: false };

      // Maybe it's wrapped in something?
      if ((cy as any).getCore && typeof (cy as any).getCore === 'function') {
        const core = (cy as any).getCore();
        return {
          hasCore: true,
          coreHasNodes: typeof core?.nodes === 'function',
          coreNodesCount: core?.nodes ? core.nodes().length : -1
        };
      }

      return { hasCore: false };
    });

    console.log('Core access:', coreAccess);
  });
});
/**
 * Screenshot test for wikilink title display feature
 * Shows how [[nodeId]] displays as [[Node Title]] when cursor is outside
 */

import { test as base } from '@playwright/test';
import {
  setupMockElectronAPI,
  sendGraphDelta,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils';
import type { GraphDelta } from '@/pure/graph';

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

    page.on('console', msg => {
      consoleLogs.push(`[Browser ${msg.type()}] ${msg.text()}`);
    });

    page.on('pageerror', error => {
      pageErrors.push(`[Browser Error] ${error.message}\n${error.stack ?? ''}`);
    });

    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      testLogs.push(args.map(arg => String(arg)).join(' '));
    };

    await use({ consoleLogs, pageErrors, testLogs });

    console.log = originalLog;

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

test.describe('Wikilink Title Display Screenshot', () => {
  test('should display node titles instead of IDs in wikilinks', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting wikilink title display screenshot test ===');

    await setupMockElectronAPI(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    // Create target nodes that will be referenced by wikilinks
    // These nodes have titles that should display in the wikilinks
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'architecture-overview.md',
          contentWithoutYamlOrLinks: '# Architecture Overview\n\nThis document describes the system architecture.',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 600, y: 100 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      },
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'getting-started.md',
          contentWithoutYamlOrLinks: '# Getting Started Guide\n\nHow to get started with the project.',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 600, y: 250 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      },
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'api-reference.md',
          contentWithoutYamlOrLinks: '# API Reference\n\nComplete API documentation.',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 600, y: 400 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      },
      // Main node with wikilinks - this is what we'll open in the editor
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'wikilink-demo.md',
          contentWithoutYamlOrLinks: `# Wikilink Title Display Demo

This demonstrates how wikilinks display node titles:

## Links to other nodes

- See the [[architecture-overview.md]] for system design
- Check out [[getting-started.md]] if you're new
- Refer to [[api-reference.md]] for detailed docs

## How it works

When the cursor is **outside** a wikilink, it shows the node's title.
When you click **into** a wikilink, it reveals the raw node ID.

Example: [[architecture-overview.md]] shows "Architecture Overview"

## Invalid links

This link has no matching node: [[nonexistent-node.md]]
(It will display the raw ID as fallback)`,
          outgoingEdges: [
            { targetId: 'architecture-overview.md', label: '' },
            { targetId: 'getting-started.md', label: '' },
            { targetId: 'api-reference.md', label: '' }
          ],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 200, y: 250 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      }
    ];

    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(300);

    // Open editor via tap event on cytoscape node
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#wikilink-demo.md');
      if (node.length === 0) throw new Error('wikilink-demo.md not found');
      node.trigger('tap');
    });
    await page.waitForTimeout(500);

    // Wait for editor to appear
    const editorSelector = '#window-wikilink-demo\\.md-editor';
    await page.waitForSelector(editorSelector, { timeout: 5000 });
    await page.waitForSelector(`${editorSelector} .cm-content`, { timeout: 3000 });

    // Wait for decorations to be applied
    await page.waitForTimeout(1000);

    // Take screenshot of just the editor
    const editor = page.locator(editorSelector);
    await editor.screenshot({
      path: 'e2e-tests/screenshots/wikilink-title-display.png'
    });

    console.log('Screenshot saved to e2e-tests/screenshots/wikilink-title-display.png');
  });
});

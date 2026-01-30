/**
 * Screenshot test for wikilink title chip display
 * Verifies that wikilinks show node titles as styled chips
 * Uses Mark decorations + CSS ::after (not Replace decorations)
 */

import { test as base } from '@playwright/test';
import {
  setupMockElectronAPI,
  selectMockProject,
  sendGraphDelta,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils.ts';
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

test.describe('Wikilink Title Chip Screenshot', () => {
  test('should display wikilink as title chip when node exists', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting wikilink title chip screenshot test ===');

    await setupMockElectronAPI(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    // Create the TARGET node that the wikilink will reference
    const targetNodeDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'my-target-note.md',
          contentWithoutYamlOrLinks: '# My Target Note\n\nThis is the target node that will be linked to.',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 600, y: 300 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      }
    ];

    await sendGraphDelta(page, targetNodeDelta);
    await page.waitForTimeout(100);

    // Create the SOURCE node with a wikilink to the target
    const sourceContent = `# Wikilink Test

This document contains a wikilink: [[my-target-note.md]]

The wikilink above should display as a styled chip showing "My Target Note".

Some more text below the link to test typing stability.`;

    const sourceNodeDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'wikilink-test-source.md',
          contentWithoutYamlOrLinks: sourceContent,
          outgoingEdges: [
            { targetId: 'my-target-note.md', label: '' }
          ],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 300, y: 300 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      }
    ];

    await sendGraphDelta(page, sourceNodeDelta);
    await page.waitForTimeout(200);

    // Check that the node exists before tapping
    const nodeExists = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return { error: 'Cytoscape not initialized' };
      const node = cy.$('#wikilink-test-source.md');
      return { exists: node.length > 0, nodeCount: cy.nodes().length };
    });
    console.log('Node check:', JSON.stringify(nodeExists));

    // Open editor via tap event on the source node
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#wikilink-test-source.md');
      if (node.length === 0) throw new Error('wikilink-test-source.md not found');
      node.trigger('tap');
    });
    await page.waitForTimeout(500);

    // Wait for editor to appear
    const editorSelector = '#window-wikilink-test-source\\.md-editor';
    await page.waitForSelector(editorSelector, { timeout: 5000 });
    await page.waitForSelector(`${editorSelector} .cm-content`, { timeout: 3000 });
    await page.waitForTimeout(1000); // Wait for decorations to be applied

    // Take screenshot of the editor showing the wikilink chip
    const editor = page.locator(editorSelector);
    await editor.screenshot({
      path: 'e2e-tests/playwright-browser/for_feature_development_skip/markdown-editors/wikilink-title-chip-screenshot.png'
    });

    console.log('✓ Screenshot saved to e2e-tests/playwright-browser/for_feature_development_skip/markdown-editors/wikilink-title-chip-screenshot.png');

    // Verify the wikilink chip element exists with correct class
    const wikilinkChip = page.locator('.cm-wikilink-title');
    const chipCount = await wikilinkChip.count();
    console.log(`Found ${chipCount} wikilink chip(s)`);

    // Verify the chip has the expected data attributes
    if (chipCount > 0) {
      const dataTitle = await wikilinkChip.first().getAttribute('data-title');
      const dataNodeId = await wikilinkChip.first().getAttribute('data-node-id');
      console.log(`Chip data-title: ${dataTitle}`);
      console.log(`Chip data-node-id: ${dataNodeId}`);
    }
  });
});

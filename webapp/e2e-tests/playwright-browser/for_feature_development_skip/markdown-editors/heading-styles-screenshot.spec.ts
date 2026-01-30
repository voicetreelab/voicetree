/**
 * Screenshot test for markdown heading styles
 * Creates an editor with all heading levels to visualize sizing
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

test.describe('Markdown Heading Styles Screenshot', () => {
  test('should display all heading sizes correctly', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting heading styles screenshot test ===');

    await setupMockElectronAPI(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    // Create node with all heading levels for comparison
    const testContent = `# Heading 1 (24px)

## Heading 2 (21px)

### Heading 3 (18px)

#### Heading 4 (16px)

Regular paragraph text for comparison.

**Bold text** and *italic text* for reference.

\`\`\`typescript
interface User {
  name: string;
  age: number;
}

const greet = (user: User): string => {
  return \`Hello, \${user.name}!\`;
};
\`\`\``;

    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'heading-styles-test.md',
          contentWithoutYamlOrLinks: testContent,
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 400, y: 300 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      }
    ];

    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(200);

    // Open editor via tap event on cytoscape node
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#heading-styles-test.md');
      if (node.length === 0) throw new Error('heading-styles-test.md not found');
      node.trigger('tap');
    });
    await page.waitForTimeout(500);

    // Wait for editor to appear
    const editorSelector = '#window-heading-styles-test\\.md-editor';
    await page.waitForSelector(editorSelector, { timeout: 5000 });
    await page.waitForSelector(`${editorSelector} .cm-content`, { timeout: 3000 });
    await page.waitForTimeout(2000); // Wait for lazy-loaded language to be applied

    // Take screenshot of just the editor
    const editor = page.locator(editorSelector);
    await editor.screenshot({
      path: 'e2e-tests/playwright-browser/markdown-editors/heading-styles-screenshot.png'
    });

    console.log('✓ Screenshot saved to e2e-tests/playwright-browser/markdown-editors/heading-styles-screenshot.png');
  });
});

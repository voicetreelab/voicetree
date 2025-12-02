/**
 * Browser-based test for frontmatter color parsing and rendering
 * Tests that colors from node frontmatter are correctly applied to cytoscape nodes
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  sendGraphDelta,
  waitForCytoscapeReady,
  getNodeCount,
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

test.describe('Frontmatter Color Parsing (Browser)', () => {
  test('should render nodes with colors from frontmatter metadata', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting frontmatter color parsing test (Browser) ===');

    console.log('=== Step 1: Mock Electron API BEFORE navigation ===');
    await setupMockElectronAPI(page);
    console.log('✓ Electron API mock prepared');

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');

    // Wait for React to render
    await page.waitForSelector('#root', { timeout: 5000 });
    console.log('✓ React rendered');

    // Wait for graph update handler to be registered
    await page.waitForTimeout(50);
    console.log('✓ Graph update handler should be registered');

    console.log('=== Step 3: Wait for Cytoscape to initialize ===');
    await waitForCytoscapeReady(page);
    console.log('✓ Cytoscape initialized');

    console.log('=== Step 4: Create test graph with colored nodes ===');
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'red-node',
          contentWithoutYamlOrLinks: '---\ncolor: red\n---\n# Red Node\n\nThis node should be red.',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'Some', value: 'red' } as const,
            position: { _tag: 'Some', value: { x: 100, y: 100 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      },
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'cyan-node',
          contentWithoutYamlOrLinks: '---\ncolor: cyan\n---\n# Cyan Node\n\nThis node should be cyan.',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'Some', value: 'cyan' } as const,
            position: { _tag: 'Some', value: { x: 300, y: 150 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      },
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'hex-color-node',
          contentWithoutYamlOrLinks: '---\ncolor: "#FF5733"\n---\n# Hex Color Node\n\nThis node should have hex color #FF5733.',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'Some', value: '#FF5733' } as const,
            position: { _tag: 'Some', value: { x: 500, y: 200 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      },
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'no-color-node',
          contentWithoutYamlOrLinks: '# No Color Node\n\nThis node has no color specified.',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 700, y: 250 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      }
    ];

    await sendGraphDelta(page, graphDelta);

    const nodeCount = await getNodeCount(page);
    expect(nodeCount).toBe(4);
    console.log(`✓ Test graph setup complete with ${nodeCount} nodes`);

    console.log('=== Step 5: Verify node data.color is set ===');
    const nodeData = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const redNode = cy.getElementById('red-node');
      const cyanNode = cy.getElementById('cyan-node');
      const hexNode = cy.getElementById('hex-color-node');
      const noColorNode = cy.getElementById('no-color-node');

      return {
        redNodeColor: redNode.data('color'),
        cyanNodeColor: cyanNode.data('color'),
        hexNodeColor: hexNode.data('color'),
        noColorNodeColor: noColorNode.data('color')
      };
    });

    console.log('  Node data.color values:', nodeData);
    expect(nodeData.redNodeColor).toBe('red');
    expect(nodeData.cyanNodeColor).toBe('cyan');
    expect(nodeData.hexNodeColor).toBe('#FF5733');
    expect(nodeData.noColorNodeColor).toBeUndefined();
    console.log('✓ Node data.color values are correct');

    console.log('=== Step 6: Verify node background-color style is applied ===');
    const nodeStyles = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const redNode = cy.getElementById('red-node');
      const cyanNode = cy.getElementById('cyan-node');
      const hexNode = cy.getElementById('hex-color-node');
      const noColorNode = cy.getElementById('no-color-node');

      return {
        redNodeBgColor: redNode.style('background-color') as string,
        cyanNodeBgColor: cyanNode.style('background-color') as string,
        hexNodeBgColor: hexNode.style('background-color') as string,
        noColorNodeBgColor: noColorNode.style('background-color') as string
      };
    });

    console.log('  Node background-color styles:', nodeStyles);

    // Cytoscape normalizes colors to rgb format, so we need to check the actual values
    // Red = rgb(255, 0, 0)
    // Cyan = rgb(0, 255, 255)
    // #FF5733 = rgb(255, 87, 51)
    expect(nodeStyles.redNodeBgColor).toBe('rgb(255,0,0)');
    expect(nodeStyles.cyanNodeBgColor).toBe('rgb(0,255,255)');
    expect(nodeStyles.hexNodeBgColor).toBe('rgb(255,87,51)');

    // Node without color should use the default fill color
    // This will be a grey color from StyleService
    expect(nodeStyles.noColorNodeBgColor).not.toBe('rgb(255,0,0)');
    expect(nodeStyles.noColorNodeBgColor).not.toBe('rgb(0,255,255)');
    console.log('✓ Node background-color styles are correctly applied');

    console.log('=== Step 7: Test color update on existing node ===');
    // Update the no-color node to have a color
    const updateDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'no-color-node',
          contentWithoutYamlOrLinks: '---\ncolor: green\n---\n# Updated Color Node\n\nThis node now has green color.',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'Some', value: 'green' } as const,
            position: { _tag: 'Some', value: { x: 700, y: 250 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'Some', value: {
          relativeFilePathIsID: 'no-color-node',
          contentWithoutYamlOrLinks: '# No Color Node\n\nThis node has no color specified.',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 700, y: 250 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        }} as const
      }
    ];

    await sendGraphDelta(page, updateDelta);

    // Wait for update to apply
    await page.waitForTimeout(30);

    const updatedNodeStyle = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const noColorNode = cy.getElementById('no-color-node');
      return {
        color: noColorNode.data('color') as string,
        backgroundColor: noColorNode.style('background-color') as string
      };
    });

    console.log('  Updated node style:', updatedNodeStyle);
    expect(updatedNodeStyle.color).toBe('green');
    expect(updatedNodeStyle.backgroundColor).toBe('rgb(0,128,0)'); // green = rgb(0, 128, 0)
    console.log('✓ Node color updated successfully');

    console.log('✓ Frontmatter color parsing test completed successfully');
  });

  test('should filter out invalid color values', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting invalid color filtering test (Browser) ===');

    await setupMockElectronAPI(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);
    console.log('✓ Setup complete');

    console.log('=== Test 1: Creating nodes with various invalid colors ===');
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'invalid-1',
          contentWithoutYamlOrLinks: '# Invalid 1',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'Some', value: 'cyancyan' } as const,
            position: { _tag: 'Some', value: { x: 100, y: 100 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      },
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'invalid-2',
          contentWithoutYamlOrLinks: '# Invalid 2',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'Some', value: 'notacolor' } as const,
            position: { _tag: 'Some', value: { x: 200, y: 100 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      },
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'invalid-3',
          contentWithoutYamlOrLinks: '# Invalid 3',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'Some', value: '###' } as const,
            position: { _tag: 'Some', value: { x: 300, y: 100 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      }
    ];

    await sendGraphDelta(page, graphDelta);

    const invalidColorResults = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      return {
        cyancyan: cy.getElementById('invalid-1').data('color'),
        notacolor: cy.getElementById('invalid-2').data('color'),
        tripleHash: cy.getElementById('invalid-3').data('color')
      };
    });

    console.log('  Invalid color results:', invalidColorResults);
    expect(invalidColorResults.cyancyan).toBeUndefined();
    expect(invalidColorResults.notacolor).toBeUndefined();
    expect(invalidColorResults.tripleHash).toBeUndefined();
    console.log('✓ All invalid colors filtered out');

    console.log('=== Test 2: Updating node with valid color to invalid should clear it ===');
    // First create a node with valid color
    const validDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'update-test',
          contentWithoutYamlOrLinks: '# Update Test',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'Some', value: '#ff0000' } as const,
            position: { _tag: 'Some', value: { x: 400, y: 100 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      }
    ];
    await sendGraphDelta(page, validDelta);
    await page.waitForTimeout(10);

    // Verify initial valid color
    const initialColor = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      return cy?.getElementById('update-test').data('color');
    });
    expect(initialColor).toBe('#ff0000');

    // Now update with invalid color
    const invalidUpdateDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'update-test',
          contentWithoutYamlOrLinks: '# Update Test - Invalid',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'Some', value: 'cyancyan' } as const,
            position: { _tag: 'Some', value: { x: 400, y: 100 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'Some', value: {
          relativeFilePathIsID: 'update-test',
          contentWithoutYamlOrLinks: '# Update Test',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'Some', value: '#ff0000' } as const,
            position: { _tag: 'Some', value: { x: 400, y: 100 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        }} as const
      }
    ];
    await sendGraphDelta(page, invalidUpdateDelta);
    await page.waitForTimeout(10);

    const updatedColor = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      return cy?.getElementById('update-test').data('color');
    });

    console.log('  Color after invalid update:', updatedColor);
    expect(updatedColor).toBeUndefined();
    console.log('✓ Invalid color update cleared the color value');
  });
});

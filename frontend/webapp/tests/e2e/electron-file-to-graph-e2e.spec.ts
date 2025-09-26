/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore, NodeSingular, EdgeSingular } from 'cytoscape';

// Type definitions for test
interface ExtendedWindow extends Window {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    startFileWatching: (dir: string) => Promise<{ success: boolean; directory?: string; error?: string }>;
    stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
    getWatchStatus: () => Promise<{ isWatching: boolean; directory?: string }>;
  };
}

interface NodeData {
  id: string;
  label: string;
}

interface EdgeData {
  id: string;
  source: string;
  target: string;
}

// This interface is used in test files
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface GraphState {
  nodeCount: number;
  edgeCount: number;
  nodeData: NodeData[];
  edgeData: EdgeData[];
  allNodesValid: boolean;
}

/**
 * TRUE END-TO-END TEST for the file-to-graph pipeline
 * This test:
 * 1. Launches the actual Electron application
 * 2. Creates real markdown files in a temporary directory
 * 3. Uses the real chokidar file watcher via IPC
 * 4. Verifies that real file system changes result in graph updates
 *
 * This is the definitive test that proves the entire system works end-to-end.
 */

// Extend the test to include Electron app and temp directory
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  tempDir: string;
}>({
  // Set up Electron application
  electronApp: async (fixtures, use) => {
    const electronApp = await electron.launch({
      args: [path.join(__dirname, '../../electron.js')],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        HEADLESS_TEST: '1' // Optionally run headless
      }
    });

    await use(electronApp);
    await electronApp.close();
  },

  // Get the main window
  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    await use(window);
  },

  // Create temporary directory for test files
  tempDir: async (fixtures, use) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-test-'));
    console.log(`Created temp directory: ${dir}`);

    await use(dir);

    // Clean up after test
    try {
      await fs.rm(dir, { recursive: true, force: true });
      console.log(`Cleaned up temp directory: ${dir}`);
    } catch (error) {
      console.error(`Failed to clean up temp directory: ${error}`);
    }
  }
});

test.describe('Electron File-to-Graph TRUE E2E Tests', () => {
  test('should watch real files and update graph accordingly', async ({ appWindow, tempDir }) => {
    // Wait for app to load completely
    await appWindow.waitForLoadState('domcontentloaded');
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        // Check if the app is fully initialized
        return document.readyState === 'complete' && (window as ExtendedWindow).cytoscapeInstance;
      });
    }, {
      message: 'Waiting for app to fully load and initialize',
      timeout: 10000
    }).toBe(true);

    console.log('=== STEP 1: Verify initial empty state ===');

    // Check that the app loaded and shows empty graph
    await expect(appWindow.locator('text=Graph visualization will appear here')).toBeVisible();

    // Verify Cytoscape is initialized but empty
    const initialNodeCount = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      return cy ? cy.nodes().length : 0;
    });
    expect(initialNodeCount).toBe(0);

    console.log('=== STEP 2: Start watching the temp directory ===');

    // Trigger the file watching for our temp directory
    // This simulates clicking "Open Folder" and selecting our temp dir
    await appWindow.evaluate((dir) => {
      // Directly call the Electron API to start watching
      if ((window as ExtendedWindow).electronAPI) {
        return (window as ExtendedWindow).electronAPI.startFileWatching(dir);
      }
    }, tempDir);

    // Wait for file watching to start
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        if ((window as ExtendedWindow).electronAPI) {
          return (window as ExtendedWindow).electronAPI.getWatchStatus();
        }
        return null;
      });
    }, {
      message: 'Waiting for file watching to start',
      timeout: 5000
    }).toMatchObject({
      isWatching: true,
      directory: tempDir
    });

    console.log('=== STEP 3: Create first markdown file ===');

    // Create a real markdown file in the temp directory
    const file1Path = path.join(tempDir, 'introduction.md');
    await fs.writeFile(file1Path, '# Introduction\n\nThis is the introduction to our system.');

    // Wait for chokidar to detect the file and graph to update
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        return cy ? cy.nodes().length : 0;
      });
    }, {
      message: 'Waiting for first file to be detected and node to appear',
      timeout: 8000
    }).toBe(1);

    // Verify the node has correct label
    const firstNodeData = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy || cy.nodes().length === 0) return null;
      return {
        id: cy.nodes()[0].data('id'),
        label: cy.nodes()[0].data('label')
      };
    });
    expect(firstNodeData).toBeTruthy();
    expect(firstNodeData.label).toContain('introduction');

    console.log('=== STEP 4: Create second file with link ===');

    // Create second file that links to the first
    const file2Path = path.join(tempDir, 'advanced.md');
    await fs.writeFile(
      file2Path,
      '# Advanced Topics\n\nBuilding upon [[introduction]], we explore advanced concepts.'
    );

    // Wait for second file to be detected and graph to update
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return null;
        return {
          nodes: cy.nodes().length,
          edges: cy.edges().length,
          edgeData: cy.edges().map((e: EdgeSingular) => ({
            source: e.source().data('label'),
            target: e.target().data('label')
          }))
        };
      });
    }, {
      message: 'Waiting for second file with link to be processed',
      timeout: 8000
    }).toMatchObject({
      nodes: 2,
      edges: 1,
      edgeData: [{
        source: expect.stringContaining('advanced'),
        target: expect.stringContaining('introduction')
      }]
    });

    console.log('=== STEP 5: Modify a file ===');

    // Modify the first file
    await fs.writeFile(
      file1Path,
      '# Introduction - Updated\n\nThis is the UPDATED introduction with more content.\n\nNow with [[advanced]] backlink!'
    );

    // Wait for file modification to be processed
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return null;
        return {
          nodes: cy.nodes().length,
          edges: cy.edges().length
        };
      });
    }, {
      message: 'Waiting for file modification to be processed',
      timeout: 8000
    }).toMatchObject({
      nodes: 2,
      edges: expect.any(Number)
    });

    // Verify edge count separately (could be 2 if bidirectional)
    const graphStateAfterModify = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      return cy ? cy.edges().length : 0;
    });
    expect(graphStateAfterModify).toBeGreaterThanOrEqual(1);

    console.log('=== STEP 6: Delete a file ===');

    // Delete the second file
    await fs.unlink(file2Path);

    // Wait for file deletion to be processed
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return null;
        return {
          nodes: cy.nodes().length,
          edges: cy.edges().length
        };
      });
    }, {
      message: 'Waiting for file deletion to be processed',
      timeout: 8000
    }).toEqual({
      nodes: 1,
      edges: 0
    });

    console.log('=== STEP 7: Create nested directory structure ===');

    // Create subdirectories with files
    const subDir = path.join(tempDir, 'concepts');
    await fs.mkdir(subDir);

    const nestedFile1 = path.join(subDir, 'core.md');
    const nestedFile2 = path.join(subDir, 'utils.md');

    await fs.writeFile(nestedFile1, '# Core Concepts\n\nFundamental ideas.');
    await fs.writeFile(nestedFile2, '# Utilities\n\nHelper functions. See [[core]] for basics.');

    // Wait for nested files to be detected and processed
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return null;
        return {
          nodes: cy.nodes().length,
          edges: cy.edges().length,
          nodeLabels: cy.nodes().map((n: NodeSingular) => n.data('label'))
        };
      });
    }, {
      message: 'Waiting for nested files to be detected and processed',
      timeout: 10000
    }).toMatchObject({
      nodes: expect.any(Number),
      edges: expect.any(Number),
      nodeLabels: expect.any(Array)
    });

    // Verify minimum counts
    const finalGraphState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      return cy ? { nodes: cy.nodes().length, edges: cy.edges().length } : null;
    });
    expect(finalGraphState.nodes).toBeGreaterThanOrEqual(3); // introduction + core + utils
    expect(finalGraphState.edges).toBeGreaterThanOrEqual(1); // utils -> core link

    console.log('=== STEP 8: Stop watching ===');

    // Stop file watching
    await appWindow.evaluate(() => {
      if ((window as ExtendedWindow).electronAPI) {
        return (window as ExtendedWindow).electronAPI.stopFileWatching();
      }
    });

    // Wait for watching to stop and graph to be cleared
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        if ((window as ExtendedWindow).electronAPI) {
          const watchStatus = (window as ExtendedWindow).electronAPI.getWatchStatus();
          const cy = (window as ExtendedWindow).cytoscapeInstance;
          return {
            isWatching: watchStatus?.isWatching || false,
            nodeCount: cy ? cy.nodes().length : 0
          };
        }
        return { isWatching: true, nodeCount: -1 }; // Still waiting
      });
    }, {
      message: 'Waiting for file watching to stop and graph to be cleared',
      timeout: 5000
    }).toEqual({
      isWatching: false,
      nodeCount: 0
    });

    console.log('✓ Electron E2E test completed successfully');
  });

  test('should handle rapid real file changes without corruption', async ({ appWindow, tempDir }) => {
    await appWindow.waitForLoadState('domcontentloaded');
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        // Check if the app is fully initialized for rapid test
        return document.readyState === 'complete' && (window as ExtendedWindow).cytoscapeInstance;
      });
    }, {
      message: 'Waiting for app to fully load for rapid changes test',
      timeout: 10000
    }).toBe(true);

    // Start watching
    await appWindow.evaluate((dir) => {
      if ((window as ExtendedWindow).electronAPI) {
        return (window as ExtendedWindow).electronAPI.startFileWatching(dir);
      }
    }, tempDir);

    // Wait for file watching to start
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        if ((window as ExtendedWindow).electronAPI) {
          const status = (window as ExtendedWindow).electronAPI.getWatchStatus();
          return status?.isWatching || false;
        }
        return false;
      });
    }, {
      message: 'Waiting for file watching to start in rapid changes test',
      timeout: 5000
    }).toBe(true);

    console.log('=== Testing rapid real file operations ===');

    // Create multiple files rapidly
    const files = [
      { name: 'file1.md', content: '# File 1\n\nFirst file.' },
      { name: 'file2.md', content: '# File 2\n\nLinks to [[file1]].' },
      { name: 'file3.md', content: '# File 3\n\nLinks to [[file1]] and [[file2]].' },
      { name: 'file4.md', content: '# File 4\n\nLinks to [[file3]].' },
      { name: 'file5.md', content: '# File 5\n\nLinks to [[file4]] and [[file1]].' }
    ];

    // Write all files with minimal delay
    for (const file of files) {
      await fs.writeFile(path.join(tempDir, file.name), file.content);
      await appWindow.waitForTimeout(50); // Small delay between writes to avoid overwhelming the file system
    }

    // Wait for all files to be processed and verify graph integrity
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return null;

        const nodes = cy.nodes();
        const edges = cy.edges();

        // Check for graph consistency
        const orphanedEdges = edges.filter((edge: EdgeSingular) => {
          const sourceExists = nodes.some((n: NodeSingular) => n.id() === edge.source().id());
          const targetExists = nodes.some((n: NodeSingular) => n.id() === edge.target().id());
          return !sourceExists || !targetExists;
        });

        return {
          nodeCount: nodes.length,
          edgeCount: edges.length,
          orphanedEdges: orphanedEdges.length,
          allNodesValid: nodes.every((n: NodeSingular) => n.data('id') && n.data('label'))
        };
      });
    }, {
      message: 'Waiting for all 5 rapid files to be processed with graph integrity',
      timeout: 15000
    }).toMatchObject({
      nodeCount: 5,
      edgeCount: expect.any(Number),
      orphanedEdges: 0,
      allNodesValid: true
    });

    // Verify minimum edge count
    const graphState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      return cy ? cy.edges().length : 0;
    });
    expect(graphState).toBeGreaterThanOrEqual(5);

    // Now delete some files rapidly
    await fs.unlink(path.join(tempDir, 'file3.md'));
    await fs.unlink(path.join(tempDir, 'file4.md'));

    // Wait for file deletions to be processed
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return null;
        return {
          nodeCount: cy.nodes().length,
          edgeCount: cy.edges().length
        };
      });
    }, {
      message: 'Waiting for file deletions to be processed',
      timeout: 10000
    }).toMatchObject({
      nodeCount: 3, // file1, file2, file5 remain
      edgeCount: expect.any(Number)
    });

    console.log('✓ Rapid file changes handled successfully');
  });
});

// Export for use in other tests
export { test };
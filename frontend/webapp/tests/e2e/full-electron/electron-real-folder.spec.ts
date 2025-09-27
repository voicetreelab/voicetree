/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { Core as CytoscapeCore, NodeSingular, EdgeSingular } from 'cytoscape';

// Use absolute paths
const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'tests', 'fixtures', 'test-markdown-vault');

// Type definitions
interface ExtendedWindow extends Window {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    startFileWatching: (dir: string) => Promise<{ success: boolean; directory?: string; error?: string }>;
    stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
    getWatchStatus: () => Promise<{ isWatching: boolean; directory?: string }>;
  };
}

interface GraphState {
  nodeCount: number;
  edgeCount: number;
  nodeLabels: string[];
  edges: Array<{ source: string; target: string }>;
}

/**
 * REAL FOLDER E2E TEST
 *
 * This test uses a pre-populated vault of markdown files to test the complete
 * file-to-graph pipeline without needing to create temporary files or mock anything.
 *
 * Key features:
 * - Uses real markdown files from /tests/fixtures/test-markdown-vault
 * - Bypasses the native folder picker by providing path directly via IPC
 * - Tests real file watching with Chokidar
 * - Verifies graph visualization updates with actual wiki-links
 */

// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  // Set up Electron application
  // eslint-disable-next-line no-empty-pattern
  electronApp: async ({}, use) => {
    const electronApp = await electron.launch({
      args: [path.join(PROJECT_ROOT, 'electron/electron.cjs')],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        MINIMIZE_TEST: '1' // Minimize window to avoid dialog popups
      }
    });

    await use(electronApp);
    await electronApp.close();
  },

  // Get the main window
  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    await use(window);
  }
});

test.describe('Real Folder E2E Tests', () => {
  test('should load and visualize a real markdown vault', async ({ appWindow }) => {
    // Set up console logging
    appWindow.on('console', msg => {
      console.log(`[Browser] ${msg.type()}: ${msg.text()}`);
    });

    appWindow.on('pageerror', error => {
      console.error('[Page Error]:', error.message);
    });

    console.log('=== STEP 1: Wait for app to load ===');

    // Wait for app to fully load
    await appWindow.waitForLoadState('domcontentloaded');
    await appWindow.waitForTimeout(2000); // Give React time to mount

    // Verify app loaded properly
    const appReady = await appWindow.evaluate(() => {
      return !!(window as ExtendedWindow).cytoscapeInstance &&
             !!(window as ExtendedWindow).electronAPI;
    });
    expect(appReady).toBe(true);
    console.log('✓ App loaded successfully');

    console.log('=== STEP 2: Load the test vault directly (bypass file picker) ===');
    console.log(`Loading vault from: ${FIXTURE_VAULT_PATH}`);

    // Start watching the fixture vault directly - this bypasses the dialog
    const watchResult = await appWindow.evaluate(async (vaultPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');

      // Pass the folder path directly to bypass the dialog
      return await api.startFileWatching(vaultPath);
    }, FIXTURE_VAULT_PATH);

    expect(watchResult.success).toBe(true);
    expect(watchResult.directory).toBe(FIXTURE_VAULT_PATH);
    console.log('✓ File watching started successfully');

    // Wait for initial scan to complete
    await appWindow.waitForTimeout(3000);

    console.log('=== STEP 3: Verify initial graph state ===');

    // Get the initial graph state
    const initialGraph: GraphState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      return {
        nodeCount: cy.nodes().length,
        edgeCount: cy.edges().length,
        nodeLabels: cy.nodes().map((n: NodeSingular) => n.data('label')).sort(),
        edges: cy.edges().map((e: EdgeSingular) => ({
          source: e.source().data('label'),
          target: e.target().data('label')
        }))
      };
    });

    console.log(`Graph state: ${initialGraph.nodeCount} nodes, ${initialGraph.edgeCount} edges`);
    console.log('Node labels:', initialGraph.nodeLabels);

    // Verify expected files are loaded
    expect(initialGraph.nodeCount).toBeGreaterThanOrEqual(5); // We created at least 5 files
    expect(initialGraph.nodeLabels).toContain('introduction');
    expect(initialGraph.nodeLabels).toContain('architecture');
    expect(initialGraph.nodeLabels).toContain('core-principles');
    expect(initialGraph.nodeLabels).toContain('main-project');

    // Verify edges exist (wiki-links create edges)
    expect(initialGraph.edgeCount).toBeGreaterThan(0);
    console.log('✓ Initial graph loaded correctly');

    console.log('=== STEP 4: Test file modification ===');

    // Create a new file in the vault
    const newFilePath = path.join(FIXTURE_VAULT_PATH, 'concepts', 'new-concept.md');
    await fs.writeFile(newFilePath, `# New Concept

This is a dynamically added concept that links to [[introduction]] and [[architecture]].

It demonstrates that the file watcher detects new files in real-time.`);

    // Wait for the new file to be detected and processed
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return false;

        const labels = cy.nodes().map((n: NodeSingular) => n.data('label'));
        return labels.includes('new-concept');
      });
    }, {
      message: 'Waiting for new-concept node to appear',
      timeout: 10000
    }).toBe(true);

    // Verify the graph updated correctly
    const updatedGraph: GraphState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');

      return {
        nodeCount: cy.nodes().length,
        edgeCount: cy.edges().length,
        nodeLabels: cy.nodes().map((n: NodeSingular) => n.data('label')).sort(),
        edges: cy.edges().map((e: EdgeSingular) => ({
          source: e.source().data('label'),
          target: e.target().data('label')
        }))
      };
    });

    expect(updatedGraph.nodeCount).toBe(initialGraph.nodeCount + 1);
    expect(updatedGraph.nodeLabels).toContain('new-concept');

    // Check that edges were created for the wiki-links
    const newConceptEdges = updatedGraph.edges.filter(e =>
      e.source === 'new-concept' || e.target === 'new-concept'
    );
    expect(newConceptEdges.length).toBeGreaterThan(0);
    console.log('✓ File addition detected and graph updated');

    console.log('=== STEP 5: Test file deletion ===');

    // Delete the file we just created
    await fs.unlink(newFilePath);

    // Wait for the file deletion to be processed
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return true; // Still processing

        const labels = cy.nodes().map((n: NodeSingular) => n.data('label'));
        return !labels.includes('new-concept');
      });
    }, {
      message: 'Waiting for new-concept node to be removed',
      timeout: 10000
    }).toBe(true);

    // Verify we're back to the initial state
    const finalGraph: GraphState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');

      return {
        nodeCount: cy.nodes().length,
        edgeCount: cy.edges().length,
        nodeLabels: cy.nodes().map((n: NodeSingular) => n.data('label')).sort(),
        edges: cy.edges().map((e: EdgeSingular) => ({
          source: e.source().data('label'),
          target: e.target().data('label')
        }))
      };
    });

    expect(finalGraph.nodeCount).toBe(initialGraph.nodeCount);
    expect(finalGraph.nodeLabels).not.toContain('new-concept');
    console.log('✓ File deletion detected and graph updated');

    console.log('=== STEP 6: Verify wiki-link relationships ===');

    // Check specific expected relationships from our fixture files
    const hasIntroToArchitectureLink = finalGraph.edges.some(e =>
      (e.source === 'introduction' && e.target === 'architecture') ||
      (e.source === 'architecture' && e.target === 'introduction')
    );

    const hasProjectToArchitectureLink = finalGraph.edges.some(e =>
      (e.source === 'main-project' && e.target === 'architecture') ||
      (e.source === 'architecture' && e.target === 'main-project')
    );

    expect(hasIntroToArchitectureLink).toBe(true);
    expect(hasProjectToArchitectureLink).toBe(true);
    console.log('✓ Wiki-link relationships correctly represented');

    console.log('=== STEP 7: Stop file watching ===');

    // Stop watching
    const stopResult = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');

      return await api.stopFileWatching();
    });

    expect(stopResult.success).toBe(true);

    // Verify watching stopped and graph cleared
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        return cy ? cy.nodes().length : -1;
      });
    }, {
      message: 'Waiting for graph to be cleared',
      timeout: 5000
    }).toBe(0);

    console.log('✓ File watching stopped and graph cleared');
    console.log('\n✅ Real folder E2E test completed successfully!');
  });

  test('should handle complex wiki-link patterns', async ({ appWindow }) => {
    await appWindow.waitForLoadState('domcontentloaded');
    await appWindow.waitForTimeout(2000);

    console.log('=== Testing complex wiki-link patterns ===');

    // Start watching the fixture vault
    await appWindow.evaluate(async (vaultPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.startFileWatching(vaultPath);
    }, FIXTURE_VAULT_PATH);

    await appWindow.waitForTimeout(3000); // Wait for initial scan

    // Create a file with various wiki-link formats
    const complexLinkFile = path.join(FIXTURE_VAULT_PATH, 'complex-links.md');
    await fs.writeFile(complexLinkFile, `# Complex Links Test

## Different Link Formats
- Basic: [[introduction]]
- With path: [[concepts/architecture]]
- Parent directory: [[../README]]
- Non-existent: [[ghost-file]]
- Self-reference: [[complex-links]]

## Multiple Links in One Line
Check out [[introduction]], [[architecture]], and [[core-principles]] for more info.

## Links in Lists
1. First point about [[architecture]]
2. Second point referencing [[main-project]]
3. Third point linking to [[introduction]]`);

    // Wait for the file to be processed
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return false;
        const labels = cy.nodes().map((n: NodeSingular) => n.data('label'));
        return labels.includes('complex-links');
      });
    }, {
      message: 'Waiting for complex-links file to be processed',
      timeout: 10000
    }).toBe(true);

    // Verify the complex links created appropriate edges
    const graphWithComplexLinks = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');

      const complexNode = cy.nodes().filter((n: NodeSingular) =>
        n.data('label') === 'complex-links'
      );

      if (complexNode.length === 0) return null;

      const connectedEdges = cy.edges().filter((e: EdgeSingular) =>
        e.source().id() === complexNode[0].id() ||
        e.target().id() === complexNode[0].id()
      );

      return {
        nodeExists: true,
        connectedEdgeCount: connectedEdges.length,
        connections: connectedEdges.map((e: EdgeSingular) => ({
          source: e.source().data('label'),
          target: e.target().data('label')
        }))
      };
    });

    expect(graphWithComplexLinks).not.toBeNull();
    expect(graphWithComplexLinks.nodeExists).toBe(true);

    // Should have connections to multiple files mentioned in the content
    expect(graphWithComplexLinks.connectedEdgeCount).toBeGreaterThan(2);

    console.log(`✓ Complex links created ${graphWithComplexLinks.connectedEdgeCount} edges`);
    console.log('Connections:', graphWithComplexLinks.connections);

    // Clean up
    await fs.unlink(complexLinkFile);
    console.log('✓ Complex wiki-link patterns test completed');
  });
});

export { test };
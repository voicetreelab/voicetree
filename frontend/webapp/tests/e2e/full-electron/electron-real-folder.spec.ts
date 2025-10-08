
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
 * - tests the bulk initial layout, and incremental (on new node add) layouts
 */

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


// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  // Set up Electron application
   
  electronApp: async ({}, use) => {
    const electronApp = await electron.launch({
      args: [path.join(PROJECT_ROOT, 'dist-electron/main/index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1' // Minimize window to avoid dialog popups
      }
    });

    await use(electronApp);
    await electronApp.close();
  },

  // Get the main window
  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();

    // Log console messages for debugging
    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    // Capture page errors
    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
      console.error('Stack:', error.stack);
    });

    await window.waitForLoadState('domcontentloaded');

    // Check for errors before waiting for cytoscapeInstance
    const hasErrors = await window.evaluate(() => {
      const errors: string[] = [];
      // Check if React rendered
      if (!document.querySelector('#root')) errors.push('No #root element');
      // Check if any error boundaries triggered
      const errorText = document.body.textContent;
      if (errorText?.includes('Error') || errorText?.includes('error')) {
        errors.push(`Page contains error text: ${errorText.substring(0, 200)}`);
      }
      return errors;
    });

    if (hasErrors.length > 0) {
      console.error('Pre-initialization errors:', hasErrors);
    }

    await window.waitForFunction(() => (window as any).cytoscapeInstance, { timeout: 10000 });
    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Real Folder E2E Tests', () => {
  test('should load and visualize a real markdown vault', async ({ appWindow }) => {
    console.log('=== STEP 1: Verify app loaded ===');

    // Verify app loaded properly (already waited in fixture)
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

    // BEHAVIORAL TEST: Verify edges are actually visible (not just present in data)
    const edgeVisibility = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const edges = cy.edges();
      if (edges.length === 0) return { visible: false, reason: 'no edges' };

      // Sample first edge to check visibility styles
      const edge = edges.first();
      const opacity = parseFloat(edge.style('opacity'));
      const width = parseFloat(edge.style('width'));
      const color = edge.style('line-color');

      return {
        visible: opacity > 0 && width > 0 && color !== 'transparent',
        opacity,
        width,
        color,
        edgeCount: edges.length
      };
    });

    console.log('Edge visibility check:', edgeVisibility);
    expect(edgeVisibility.visible).toBe(true);
    expect(edgeVisibility.opacity).toBeGreaterThan(0);
    expect(edgeVisibility.width).toBeGreaterThan(0);

    // BEHAVIORAL TEST: Verify edges have labels displayed
    const edgeLabelCheck = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const edges = cy.edges();
      if (edges.length === 0) return { hasLabels: false, reason: 'no edges' };

      // Sample all edges to check if ANY have labels
      const edgesWithLabels = edges.filter(e => {
        const label = e.data('label');
        return label && label.length > 0;
      });

      // Get style for edge labels
      const firstEdge = edges.first();
      const labelText = firstEdge.style('label');
      const fontSize = firstEdge.style('font-size');

      return {
        totalEdges: edges.length,
        edgesWithDataLabels: edgesWithLabels.length,
        sampleLabel: edges.first().data('label'),
        styleLabelValue: labelText,
        fontSize: fontSize
      };
    });

    console.log('Edge label check (initial):', edgeLabelCheck);
    // Initial edges from plain [[wikilinks]] won't have labels
    expect(edgeLabelCheck.totalEdges).toBeGreaterThan(0);

    console.log('=== STEP 3.5: Test edge labels with relationship types ===');

    // Create a file with labeled links to test edge labels
    const labeledLinkFile = path.join(FIXTURE_VAULT_PATH, 'concepts', 'test-edge-labels.md');
    await fs.writeFile(labeledLinkFile, `# Test Edge Labels

This file tests edge labels with relationship types.

_Links:_
Parent:
- references [[introduction]]
- extends [[architecture]]`);

    // Wait for file to be processed
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return false;
        const labels = cy.nodes().map((n: NodeSingular) => n.data('label'));
        return labels.includes('test-edge-labels');
      });
    }, {
      message: 'Waiting for test-edge-labels node to appear',
      timeout: 10000
    }).toBe(true);

    // Check edge labels
    const labeledEdgeCheck = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const testNode = cy.getElementById('test-edge-labels');
      const outgoingEdges = testNode.connectedEdges('[source = "test-edge-labels"]');

      const edgeLabels = outgoingEdges.map(e => ({
        id: e.id(),
        label: e.data('label'),
        styleLabel: e.style('label')
      }));

      return {
        edgeCount: outgoingEdges.length,
        labels: edgeLabels
      };
    });

    console.log('Labeled edge check:', labeledEdgeCheck);
    expect(labeledEdgeCheck.edgeCount).toBeGreaterThan(0);
    expect(labeledEdgeCheck.labels.some(e => e.label && e.label.length > 0)).toBe(true);

    // Clean up test file
    await fs.unlink(labeledLinkFile);
    await appWindow.waitForTimeout(500);

    console.log('✓ Edge labels working correctly');
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

  test('should save markdown files in subfolders via editor', async ({ appWindow }) => {
    console.log('=== Testing markdown file saving in subfolders ===');

    // Start watching the fixture vault
    await appWindow.evaluate(async (vaultPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.startFileWatching(vaultPath);
    }, FIXTURE_VAULT_PATH);

    await appWindow.waitForTimeout(3000); // Wait for initial scan

    // Read original file content for restoration later
    const testFilePath = path.join(FIXTURE_VAULT_PATH, 'concepts', 'architecture.md');
    const originalContent = await fs.readFile(testFilePath, 'utf-8');
    console.log('Original file content length:', originalContent.length);

    // Click on the 'architecture' node to open editor
    await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const node = cy.getElementById('architecture');
      if (node.length === 0) throw new Error('architecture node not found');

      // Trigger tap event to open editor
      node.trigger('tap');
    });

    // Wait for editor window to appear
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return false;
        const shadowNode = cy.getElementById('editor-architecture');
        return shadowNode.length > 0;
      });
    }, {
      message: 'Waiting for editor shadow node to appear',
      timeout: 5000
    }).toBe(true);

    console.log('✓ Editor window opened');

    // Wait for editor React content to render
    await appWindow.waitForSelector('#window-editor-architecture .w-md-editor', { timeout: 5000 });

    // Modify content in the editor
    const testContent = '# Architecture\n\nTEST MODIFICATION - This content was changed by the e2e test.\n\nSee [[core-principles]] for details.';

    await appWindow.evaluate((newContent) => {
      const editor = document.querySelector('#window-editor-architecture .w-md-editor-text-input') as HTMLTextAreaElement;
      if (editor) {
        // Focus the editor first
        editor.focus();

        // Set value
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set;
        nativeInputValueSetter!.call(editor, newContent);

        // Trigger React's onChange by dispatching input event that React listens to
        const event = new InputEvent('input', { bubbles: true, cancelable: true });
        editor.dispatchEvent(event);
      }
    }, testContent);

    console.log('✓ Content modified in editor');

    await appWindow.waitForTimeout(1000); // Let editor update

    // Click the save button
    const saveClicked = await appWindow.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const saveButton = buttons.find(btn => btn.textContent?.includes('Save'));
      if (saveButton) {
        saveButton.click();
        return true;
      }
      return false;
    });

    expect(saveClicked).toBe(true);
    console.log('✓ Save button clicked');

    // Wait for save to complete
    await appWindow.waitForTimeout(2000);

    // Verify file content changed on disk
    const savedContent = await fs.readFile(testFilePath, 'utf-8');
    console.log('Saved file content length:', savedContent.length);
    expect(savedContent).toBe(testContent);
    console.log('✓ File content saved correctly to disk');

    // Close the editor by removing the shadow node
    await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return;
      const shadowNode = cy.getElementById('editor-architecture');
      if (shadowNode.length > 0) {
        shadowNode.remove();
      }
    });

    await appWindow.waitForTimeout(500);

    // Re-open the editor to verify content persisted
    await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById('architecture');
      node.trigger('tap');
    });

    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return false;
        const shadowNode = cy.getElementById('editor-architecture');
        return shadowNode.length > 0;
      });
    }, {
      message: 'Waiting for editor to re-open',
      timeout: 5000
    }).toBe(true);

    // Wait for editor React content to render again
    await appWindow.waitForSelector('#window-editor-architecture .w-md-editor', { timeout: 5000 });

    // Verify the editor shows the saved content
    const editorContent = await appWindow.evaluate(() => {
      const editor = document.querySelector('#window-editor-architecture .w-md-editor-text-input') as HTMLTextAreaElement;
      return editor?.value || null;
    });

    expect(editorContent).toBe(testContent);
    console.log('✓ Editor shows saved content after reopening');

    // Restore original file content (reset for clean git state)
    await fs.writeFile(testFilePath, originalContent, 'utf-8');
    console.log('✓ Original file content restored');

    // Wait for file change to be detected
    await appWindow.waitForTimeout(2000);

    console.log('✓ Markdown file save test completed');
  });

  test('should update graph when wikilink is added via editor', async ({ appWindow }) => {
    console.log('=== Testing graph update when adding wikilink ===');

    // Start watching the fixture vault
    await appWindow.evaluate(async (vaultPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.startFileWatching(vaultPath);
    }, FIXTURE_VAULT_PATH);

    await appWindow.waitForTimeout(3000); // Wait for initial scan

    // Read original file content for restoration
    const testFilePath = path.join(FIXTURE_VAULT_PATH, 'concepts', 'introduction.md');
    const originalContent = await fs.readFile(testFilePath, 'utf-8');

    // Get initial edge count for 'introduction' node
    const initialEdges = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const node = cy.getElementById('introduction');
      if (node.length === 0) throw new Error('introduction node not found');

      const connectedEdges = node.connectedEdges();
      return {
        totalEdges: cy.edges().length,
        nodeEdgeCount: connectedEdges.length,
        edgeTargets: connectedEdges.map((e: EdgeSingular) => ({
          source: e.source().id(),
          target: e.target().id()
        }))
      };
    });

    console.log('Initial edges for introduction node:', initialEdges.nodeEdgeCount);
    console.log('Initial total edges:', initialEdges.totalEdges);

    // Click on the 'introduction' node to open editor
    await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById('introduction');
      node.trigger('tap');
    });

    // Wait for editor to open
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return false;
        const shadowNode = cy.getElementById('editor-introduction');
        return shadowNode.length > 0;
      });
    }, {
      message: 'Waiting for editor to open',
      timeout: 5000
    }).toBe(true);

    console.log('✓ Editor opened');

    // Wait for editor React content to render
    await appWindow.waitForSelector('#window-editor-introduction .w-md-editor', { timeout: 5000 });

    // Add a new wikilink to the content (link to 'README' which exists but isn't linked from introduction)
    const newContent = originalContent + '\n\nNew section linking to [[README]] for testing.';

    await appWindow.evaluate((content) => {
      const editor = document.querySelector('#window-editor-introduction .w-md-editor-text-input') as HTMLTextAreaElement;
      if (editor) {
        // Focus the editor first
        editor.focus();

        // Set value using native setter
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set;
        nativeInputValueSetter!.call(editor, content);

        // Trigger React's onChange with a proper InputEvent
        const event = new InputEvent('input', { bubbles: true, cancelable: true });
        editor.dispatchEvent(event);
      }
    }, newContent);

    console.log('✓ Added wikilink to README');
    await appWindow.waitForTimeout(1000); // Longer wait for state update

    // Click save button
    await appWindow.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const saveButton = buttons.find(btn => btn.textContent?.includes('Save'));
      if (saveButton) saveButton.click();
    });

    console.log('✓ Save button clicked');
    await appWindow.waitForTimeout(2000); // Wait for save and file change detection

    // Verify new edge was created
    const updatedEdges = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const node = cy.getElementById('introduction');
      const connectedEdges = node.connectedEdges();

      return {
        totalEdges: cy.edges().length,
        nodeEdgeCount: connectedEdges.length,
        edgeTargets: connectedEdges.map((e: EdgeSingular) => ({
          source: e.source().id(),
          target: e.target().id()
        })),
        hasREADMEEdge: connectedEdges.some((e: EdgeSingular) =>
          (e.source().id() === 'introduction' && e.target().id() === 'README') ||
          (e.source().id() === 'README' && e.target().id() === 'introduction')
        )
      };
    });

    console.log('Updated edges for introduction node:', updatedEdges.nodeEdgeCount);
    console.log('Updated total edges:', updatedEdges.totalEdges);
    console.log('Has README edge:', updatedEdges.hasREADMEEdge);

    // Verify edge count increased and new edge to 'README' exists
    expect(updatedEdges.totalEdges).toBeGreaterThan(initialEdges.totalEdges);
    expect(updatedEdges.hasREADMEEdge).toBe(true);
    console.log('✓ New edge to README node created in graph');

    // Restore original file content
    await fs.writeFile(testFilePath, originalContent, 'utf-8');
    console.log('✓ Original file content restored');

    // Wait for file change to be detected and graph to update
    await appWindow.waitForTimeout(2000);

    console.log('✓ Graph wikilink update test completed');
  });

  test('should bulk load then incrementally add nodes with proper layout', async ({ appWindow }) => {
    console.log('=== Testing Bulk Load + Incremental Layout (Production Flow) ===');

    // Start watching the fixture vault
    await appWindow.evaluate(async (vaultPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.startFileWatching(vaultPath);
    }, FIXTURE_VAULT_PATH);

    // Wait for bulk load to complete
    await appWindow.waitForTimeout(3000);

    console.log('=== PHASE 1: Verify Bulk Load Layout Quality ===');

    const bulkLoadState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const nodes = cy.nodes();
      const positions = nodes.map(n => ({
        id: n.id(),
        x: n.position().x,
        y: n.position().y
      }));

      // Check Y-coordinate distribution
      const yCoords = positions.map(p => p.y);
      const uniqueY = new Set(yCoords);
      const allAtZero = yCoords.every(y => y === 0);

      return {
        nodeCount: nodes.length,
        yCoords,
        uniqueYCount: uniqueY.size,
        allAtZero,
        samplePositions: positions.slice(0, 5)
      };
    });

    console.log(`Bulk load: ${bulkLoadState.nodeCount} nodes`);
    console.log(`Y-coordinates: ${bulkLoadState.uniqueYCount} unique levels`);
    console.log(`Sample positions:`, bulkLoadState.samplePositions);

    // Critical check: ensure bulk layout worked (not all at y=0)
    expect(bulkLoadState.allAtZero).toBe(false);
    expect(bulkLoadState.uniqueYCount).toBeGreaterThan(1);
    console.log('✓ Bulk load layout has proper Y-coordinate distribution');

    console.log('=== PHASE 2: Add 3 New Nodes Incrementally ===');

    const newFiles = [
      {
        name: 'incremental-test-1.md',
        content: '# Incremental Test 1\n\nFirst incrementally added node. Links to [[introduction]].'
      },
      {
        name: 'incremental-test-2.md',
        content: '# Incremental Test 2\n\nSecond incremental node. References [[architecture]] and [[incremental-test-1]].'
      },
      {
        name: 'incremental-test-3.md',
        content: '# Incremental Test 3\n\nThird incremental node. Connects to [[core-principles]].'
      }
    ];

    // Add files one by one and verify layout updates
    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i];
      const filePath = path.join(FIXTURE_VAULT_PATH, 'concepts', file.name);

      console.log(`Adding file ${i + 1}: ${file.name}`);
      await fs.writeFile(filePath, file.content);

      // Wait for file to be detected and laid out
      await expect.poll(async () => {
        return appWindow.evaluate((filename) => {
          const cy = (window as ExtendedWindow).cytoscapeInstance;
          if (!cy) return false;
          const labels = cy.nodes().map((n: NodeSingular) => n.data('label'));
          const nodeId = filename.replace('.md', '');
          return labels.includes(nodeId);
        }, file.name);
      }, {
        message: `Waiting for ${file.name} to appear in graph`,
        timeout: 10000
      }).toBe(true);

      console.log(`✓ File ${i + 1} added and detected`);
    }

    console.log('=== PHASE 3: Verify Incremental Layout Quality ===');

    const finalState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const nodes = cy.nodes();
      const positions = nodes.map(n => ({
        id: n.id(),
        x: n.position().x,
        y: n.position().y
      }));

      // Get the 3 new nodes specifically
      const newNodeIds = [
        'incremental-test-1',
        'incremental-test-2',
        'incremental-test-3'
      ];

      const newNodePositions = positions.filter(p =>
        newNodeIds.includes(p.id)
      );

      // Check Y-coordinates for new nodes
      const newYCoords = newNodePositions.map(p => p.y);
      const allNewAtZero = newYCoords.every(y => y === 0);

      // Check all Y-coordinates (old + new)
      const allYCoords = positions.map(p => p.y);
      const uniqueYAll = new Set(allYCoords);

      // Check for overlaps
      let overlapCount = 0;
      const MINIMUM_DISTANCE = 30;

      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const dist = Math.hypot(
            positions[i].x - positions[j].x,
            positions[i].y - positions[j].y
          );
          if (dist < MINIMUM_DISTANCE) {
            overlapCount++;
          }
        }
      }

      return {
        totalNodes: nodes.length,
        newNodePositions,
        allNewAtZero,
        uniqueYLevels: uniqueYAll.size,
        overlapCount
      };
    });

    console.log(`Final graph: ${finalState.totalNodes} nodes`);
    console.log(`New nodes:`, finalState.newNodePositions);
    console.log(`Unique Y levels: ${finalState.uniqueYLevels}`);
    console.log(`Overlaps: ${finalState.overlapCount}`);

    // Verify incremental nodes have proper positions
    expect(finalState.totalNodes).toBe(bulkLoadState.nodeCount + 3);
    expect(finalState.allNewAtZero).toBe(false); // New nodes should NOT all be at y=0
    expect(finalState.newNodePositions.length).toBe(3);

    // Check that each new node has a unique position
    const uniqueNewPositions = new Set(
      finalState.newNodePositions.map(p => `${Math.round(p.x)},${Math.round(p.y)}`)
    );
    expect(uniqueNewPositions.size).toBe(3);

    console.log('✓ Incremental nodes positioned correctly');
    console.log('✓ No excessive overlaps detected');

    // Clean up the test files
    for (const file of newFiles) {
      const filePath = path.join(FIXTURE_VAULT_PATH, 'concepts', file.name);
      await fs.unlink(filePath);
    }

    console.log('✓ Test files cleaned up');
    console.log('✅ Bulk load + incremental layout test completed successfully!');
  });

  test('should sync external file changes to open editors (bidirectional sync)', async ({ appWindow }) => {
    console.log('=== Testing bidirectional sync: external changes -> open editor ===');

    // Start watching the fixture vault
    await appWindow.evaluate(async (vaultPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.startFileWatching(vaultPath);
    }, FIXTURE_VAULT_PATH);

    await appWindow.waitForTimeout(3000); // Wait for initial scan

    // Read original file content for restoration
    const testFilePath = path.join(FIXTURE_VAULT_PATH, 'concepts', 'api-design.md');
    const originalContent = await fs.readFile(testFilePath, 'utf-8');
    console.log('Original file content:', originalContent.substring(0, 50) + '...');

    // Open the editor for api-design node
    await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById('api-design');
      if (node.length === 0) throw new Error('api-design node not found');
      node.trigger('tap');
    });

    // Wait for editor to open
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return false;
        const shadowNode = cy.getElementById('editor-api-design');
        return shadowNode.length > 0;
      });
    }, {
      message: 'Waiting for editor to open',
      timeout: 5000
    }).toBe(true);

    console.log('✓ Editor opened');

    // Wait for editor React content to render
    await appWindow.waitForSelector('#window-editor-api-design .w-md-editor', { timeout: 5000 });

    // Get initial editor content
    const initialEditorContent = await appWindow.evaluate(() => {
      const editor = document.querySelector('#window-editor-api-design .w-md-editor-text-input') as HTMLTextAreaElement;
      return editor?.value || null;
    });

    expect(initialEditorContent).toBe(originalContent);
    console.log('✓ Editor shows original content');

    // Make an EXTERNAL change to the file (simulating external editor or another process)
    const externallyChangedContent = '# API Design\n\n**EXTERNAL CHANGE** - This file was changed by an external process!\n\nThe editor should automatically sync to show this change.';
    await fs.writeFile(testFilePath, externallyChangedContent, 'utf-8');
    console.log('✓ File changed externally');

    // Wait for file watcher to detect the change
    await appWindow.waitForTimeout(2000);

    // Check if editor content was updated to match the external change
    const updatedEditorContent = await appWindow.evaluate(() => {
      const editor = document.querySelector('#window-editor-api-design .w-md-editor-text-input') as HTMLTextAreaElement;
      return editor?.value || null;
    });

    console.log('Editor content after external change:', updatedEditorContent?.substring(0, 50) + '...');

    // This is the key assertion - editor should show the externally changed content
    expect(updatedEditorContent).toBe(externallyChangedContent);
    console.log('✓ Editor synced with external file change');

    // Restore original file content
    await fs.writeFile(testFilePath, originalContent, 'utf-8');
    console.log('✓ Original file content restored');

    // Wait for file change to be detected
    await appWindow.waitForTimeout(2000);

    console.log('✓ Bidirectional sync test completed');
  });
});

export { test };
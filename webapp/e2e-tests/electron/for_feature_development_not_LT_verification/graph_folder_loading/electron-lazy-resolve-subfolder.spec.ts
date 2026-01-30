/**
 * Test: Lazy resolve for links with path components like [[openspec/AGENTS.md]]
 *
 * Scenario:
 * - writePath: tempDir/sun (main vault)
 * - watchedFolder: tempDir (parent)
 * - File exists at: tempDir/openspec/AGENTS.md (outside writePath but inside watchedFolder)
 * - User creates link [[openspec/AGENTS.md]] in a node in sun/
 * - Expected: The linked node should be lazy-loaded and appear in graph
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT: string = path.resolve(process.cwd());

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  tempDir: string;
}>({
  tempDir: async ({}, use) => {
    const tempDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-lazy-subfolder-'));
    await use(tempDir);
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  electronApp: async ({ tempDir }, use) => {
    const tempUserDataPath: string = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-lazy-subfolder-userdata-'));

    // Setup:
    // - writePath: tempDir/sun
    // - watchedFolder: tempDir (implicitly, since that's where we start watching)
    const sunDir: string = path.join(tempDir, 'sun');
    await fs.mkdir(sunDir);

    // Write config - writePath is sun/, but we watch tempDir
    const configPath: string = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        lastDirectory: tempDir,
        vaultConfig: {
          [tempDir]: {
            writePath: sunDir,
            readPaths: []
          }
        }
      }, null, 2),
      'utf8'
    );

    const electronApp: ElectronApplication = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1'
      },
      timeout: 10000
    });

    await use(electronApp);

    try {
      const window: Page = await electronApp.firstWindow();
      await window.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (api) {
          await api.main.stopFileWatching();
        }
      });
      await window.waitForTimeout(300);
    } catch {
      // ignore cleanup errors
    }

    await electronApp.close();
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp }, use) => {
    const window: Page = await electronApp.firstWindow({ timeout: 10000 });

    window.on('console', msg => {
      const text: string = msg.text();
      if (text.includes('[loadFolder]') ||
          text.includes('resolveLinkedNodes') ||
          text.includes('findFileByName') ||
          text.includes('[handleFSEvent]')) {
        console.log(`[Browser] ${text}`);
      }
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Lazy resolve with subfolder paths', () => {
  test('should resolve [[openspec/AGENTS.md]] style links to files in subfolders', async ({ appWindow, tempDir }) => {
    test.setTimeout(30000);

    console.log('');
    console.log('=== TEST: Lazy resolve [[openspec/AGENTS.md]] style links ===');
    console.log('tempDir:', tempDir);

    const sunDir: string = path.join(tempDir, 'sun');
    const openspecDir: string = path.join(tempDir, 'openspec');

    // Create openspec/AGENTS.md (outside writePath, inside watchedFolder)
    await fs.mkdir(openspecDir);
    await fs.writeFile(
      path.join(openspecDir, 'AGENTS.md'),
      '# OpenSpec Agents\nThis is the agents file.'
    );
    console.log('Created:', path.join(openspecDir, 'AGENTS.md'));

    // Create a node in sun/ that links to openspec/AGENTS.md
    await fs.writeFile(
      path.join(sunDir, 'main.md'),
      '# Main Node\nLinks to [[openspec/AGENTS.md]]'
    );
    console.log('Created:', path.join(sunDir, 'main.md'));

    // Start file watching
    await appWindow.evaluate(async (dir: string) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      await api.main.startFileWatching(dir);
    }, tempDir);

    // Wait for initial load and lazy resolution
    await appWindow.waitForTimeout(2000);

    // Check what nodes are in the graph
    const nodeState = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return {
        nodeCount: cy.nodes().length,
        labels: cy.nodes().map(n => n.data('label') as string),
        ids: cy.nodes().map(n => n.id())
      };
    });

    console.log('Node state:', JSON.stringify(nodeState, null, 2));

    // Get edge information for debugging
    const edgeState = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return cy.edges().map(e => ({
        id: e.id(),
        source: e.source().id(),
        target: e.target().id(),
        sourceLabel: e.source().data('label') as string,
        targetLabel: e.target().data('label') as string
      }));
    });
    console.log('Edge state:', JSON.stringify(edgeState, null, 2));

    // Get graph store data to check edge targetIds
    const graphStore = await appWindow.evaluate(async () => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) return { error: 'no api' };
      try {
        const graph = await api.main.getGraph();
        if (!graph) return { error: 'no graph' };
        type NodeShape = {
          absoluteFilePathIsID: string;
          outgoingEdges: readonly { targetId: string; label: string }[];
          contentWithoutYamlOrLinks: string;
        };
        const nodes = graph.nodes as unknown as Record<string, NodeShape>;
        return {
          nodeCount: Object.keys(nodes).length,
          nodes: Object.values(nodes).map(n => ({
            id: n.absoluteFilePathIsID,
            outgoingEdges: n.outgoingEdges
          }))
        };
      } catch (e) {
        return { error: String(e) };
      }
    });
    console.log('Graph store:', JSON.stringify(graphStore, null, 2));

    // Core assertion: both nodes should be loaded
    expect(nodeState.labels).toContain('Main Node');
    expect(nodeState.labels, `OpenSpec Agents not found. Nodes: ${JSON.stringify(nodeState, null, 2)}\nEdges: ${JSON.stringify(edgeState, null, 2)}\nGraph store: ${JSON.stringify(graphStore, null, 2)}`).toContain('OpenSpec Agents');
  });

  test('should resolve links when file is modified to add a new link', async ({ appWindow, tempDir }) => {
    test.setTimeout(30000);

    console.log('');
    console.log('=== TEST: Lazy resolve on file modification ===');
    console.log('tempDir:', tempDir);

    const sunDir: string = path.join(tempDir, 'sun');
    const openspecDir: string = path.join(tempDir, 'openspec');

    // Create openspec/AGENTS.md first (outside writePath)
    await fs.mkdir(openspecDir);
    await fs.writeFile(
      path.join(openspecDir, 'AGENTS.md'),
      '# OpenSpec Agents\nThis is the agents file.'
    );
    console.log('Created:', path.join(openspecDir, 'AGENTS.md'));

    // Create main.md WITHOUT the link initially
    const mainPath: string = path.join(sunDir, 'main.md');
    await fs.writeFile(mainPath, '# Main Node\nNo links yet.');
    console.log('Created:', mainPath, '(no links)');

    // Start file watching
    await appWindow.evaluate(async (dir: string) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      await api.main.startFileWatching(dir);
    }, tempDir);

    await appWindow.waitForTimeout(1500);

    // Verify only main node is loaded initially
    const initialState = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return cy.nodes().map(n => n.data('label') as string);
    });

    console.log('Initial labels:', initialState);
    expect(initialState).toContain('Main Node');
    expect(initialState).not.toContain('OpenSpec Agents');

    // Now modify the file to ADD the link
    console.log('');
    console.log('=== Modifying file to add [[openspec/AGENTS.md]] link ===');
    await fs.writeFile(mainPath, '# Main Node\nNow links to [[openspec/AGENTS.md]]');

    // Wait for FS event and lazy resolution
    await appWindow.waitForTimeout(3000);

    // Check that the linked node was loaded
    const finalState = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return {
        labels: cy.nodes().map(n => n.data('label') as string),
        ids: cy.nodes().map(n => n.id())
      };
    });

    console.log('Final state:', JSON.stringify(finalState, null, 2));

    // Get edge information for debugging
    const edgeState = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return cy.edges().map(e => ({
        id: e.id(),
        source: e.source().id(),
        target: e.target().id()
      }));
    });
    console.log('Edge state:', JSON.stringify(edgeState, null, 2));

    // Get graph store data to check edge targetIds (this is the critical part)
    const graphStore = await appWindow.evaluate(async () => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) return { error: 'no api' };
      try {
        const graph = await api.main.getGraph();
        if (!graph) return { error: 'no graph' };
        type NodeShape = {
          absoluteFilePathIsID: string;
          outgoingEdges: readonly { targetId: string; label: string }[];
        };
        const nodes = graph.nodes as unknown as Record<string, NodeShape>;
        return {
          nodeCount: Object.keys(nodes).length,
          nodes: Object.values(nodes).map(n => ({
            id: n.absoluteFilePathIsID,
            outgoingEdges: n.outgoingEdges
          }))
        };
      } catch (e) {
        return { error: String(e) };
      }
    });
    console.log('Graph store (check edge targetIds):', JSON.stringify(graphStore, null, 2));

    // Core assertion: linked node should now be loaded
    expect(finalState.labels).toContain('Main Node');
    expect(
      finalState.labels,
      `OpenSpec Agents not loaded after file modification!\nFinal state: ${JSON.stringify(finalState, null, 2)}\nEdges: ${JSON.stringify(edgeState, null, 2)}\nGraph store: ${JSON.stringify(graphStore, null, 2)}`
    ).toContain('OpenSpec Agents');
  });
});

export { test };

/**
 * BEHAVIORAL SPEC:
 * E2E test for verifying that lazy-loaded nodes are cleared when switching folders.
 *
 * BUG BEING TESTED:
 * When switching from project A to project B (completely different folders),
 * previously lazy/transitive-loaded nodes from project A remain visible in the graph.
 * They should be cleared when opening a new folder.
 *
 * PRECONDITION:
 * Two separate project directories with different files.
 * Project1 has lazy-loaded nodes (via transitive wikilinks).
 * Project2 is a completely different folder.
 *
 * EXPECTED OUTCOME:
 * - After loading project1, transitive nodes are visible (A -> B -> C)
 * - After switching to project2, ONLY project2 nodes are visible
 * - NO nodes from project1 should remain (including lazy-loaded ones)
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT = path.resolve(process.cwd());

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  project1Path: string;
  project2Path: string;
  tempUserDataPath: string;
}>({
  /**
   * Project 1: Has lazy-loaded nodes via transitive wikilinks
   *
   * project1/
   *   writePath/
   *     A.md -> [[B]]
   *   chain/
   *     B.md -> [[C]]
   *     C.md (end of chain)
   *     orphan.md (not linked - shouldn't be loaded)
   */
  project1Path: async ({}, use) => {
    const project1 = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-lazy-persist-p1-'));
    const writePath = path.join(project1, 'writePath');
    const chainDir = path.join(project1, 'chain');

    await fs.mkdir(writePath, { recursive: true });
    await fs.mkdir(chainDir, { recursive: true });

    // A.md in writePath - links to B
    await fs.writeFile(
      path.join(writePath, 'A.md'),
      `# Node A
Entry point in project 1.
Links to: [[B]]
`
    );

    // B.md in chain - links to C (transitive)
    await fs.writeFile(
      path.join(chainDir, 'B.md'),
      `# Node B
Transitively loaded from A.
Links to: [[C]]
`
    );

    // C.md in chain - end of chain
    await fs.writeFile(
      path.join(chainDir, 'C.md'),
      `# Node C
End of transitive chain in project 1.
`
    );

    // orphan.md - should NOT be loaded (no links to it)
    await fs.writeFile(
      path.join(chainDir, 'orphan.md'),
      `# Orphan Node
This should never appear in the graph.
`
    );

    await use(project1);

    // Cleanup
    await fs.rm(project1, { recursive: true, force: true });
  },

  /**
   * Project 2: Completely different folder with different nodes
   *
   * project2/
   *   writePath/
   *     X.md (standalone node in project 2)
   */
  project2Path: async ({}, use) => {
    const project2 = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-lazy-persist-p2-'));
    const writePath = path.join(project2, 'writePath');

    await fs.mkdir(writePath, { recursive: true });

    // X.md in project 2's writePath
    await fs.writeFile(
      path.join(writePath, 'X.md'),
      `# Node X
This is the only node in project 2.
`
    );

    await use(project2);

    // Cleanup
    await fs.rm(project2, { recursive: true, force: true });
  },

  tempUserDataPath: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-lazy-persist-userdata-'));
    await use(tempUserDataPath);
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  electronApp: async ({ project1Path, project2Path, tempUserDataPath }, use) => {
    const writePath1 = path.join(project1Path, 'writePath');
    const writePath2 = path.join(project2Path, 'writePath');

    // Create projects.json with project1 as a saved project (like smoke test)
    const projectsPath = path.join(tempUserDataPath, 'projects.json');
    const savedProject = {
      id: 'test-project-1',
      path: project1Path,
      name: 'project1',
      type: 'folder',
      lastOpened: Date.now(),
      voicetreeInitialized: true
    };
    await fs.writeFile(projectsPath, JSON.stringify([savedProject], null, 2), 'utf8');

    // Write vault config for BOTH projects so they load correctly when switched
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        lastDirectory: project1Path,
        vaultConfig: {
          [project1Path]: {
            writePath: writePath1,
            readPaths: []
          },
          [project2Path]: {
            writePath: writePath2,
            readPaths: []
          }
        }
      }, null, 2),
      'utf8'
    );
    console.log('[Lazy Persist Test] Config created for project1:', project1Path);
    console.log('[Lazy Persist Test] Config also includes project2:', project2Path);

    const electronApp = await electron.launch({
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
      timeout: 15000
    });

    await use(electronApp);

    // Graceful shutdown
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
  },

  appWindow: async ({ electronApp, project1Path }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15000 });

    // Log console messages for debugging
    window.on('console', msg => {
      const text = msg.text();
      if (text.includes('[loadFolder]') ||
          text.includes('graph:clear') ||
          text.includes('resolveLinkedNodes') ||
          text.includes('[handleFSEvent]')) {
        console.log(`[Browser] ${text}`);
      }
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');

    // Wait for project selection screen to load
    await window.waitForSelector('text=Voicetree', { timeout: 10000 });
    console.log('[Lazy Persist Test] Project selection screen loaded');

    // Wait for Recent Projects section to show our saved project
    await window.waitForSelector('text=Recent Projects', { timeout: 10000 });
    console.log('[Lazy Persist Test] Recent Projects section visible');

    // Click the saved project to navigate to graph view
    const projectButton = window.locator('button:has-text("project1")').first();
    await projectButton.click();
    console.log('[Lazy Persist Test] Clicked project1 to navigate to graph view');

    // Wait for graph view to load (cytoscape instance should become available)
    await window.waitForFunction(
      () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
      { timeout: 15000 }
    );
    console.log('[Lazy Persist Test] Graph view loaded');

    // Wait for initial graph load including transitive resolution
    await window.waitForTimeout(3000);

    await use(window);
  }
});

test.describe('Lazy-Loaded Nodes Persist on Folder Switch Bug', () => {
  /**
   * This test documents the bug: lazy-loaded nodes from the previous project
   * remain visible when switching to a completely different folder.
   *
   * The test should FAIL until the bug is fixed.
   */
  test('switching folders should clear lazy-loaded nodes from previous project', async ({
    appWindow,
    project1Path,
    project2Path
  }) => {
    test.setTimeout(60000);

    console.log('=== STEP 1: Verify project1 loaded with transitive nodes ===');

    // Get initial nodes from project1
    const project1Nodes = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return cy.nodes().filter(n => !n.data('isShadowNode')).map(n => ({
        id: n.id(),
        label: n.data('label') as string
      }));
    });

    console.log('Project 1 nodes:', JSON.stringify(project1Nodes, null, 2));

    // Verify transitive loading worked in project1
    const hasNodeA = project1Nodes.some(n => n.label === 'Node A');
    const hasNodeB = project1Nodes.some(n => n.label === 'Node B');
    const hasNodeC = project1Nodes.some(n => n.label === 'Node C');
    const hasOrphan = project1Nodes.some(n => n.label === 'Orphan Node');

    console.log('Project1 state: A=' + hasNodeA + ', B=' + hasNodeB + ', C=' + hasNodeC + ', orphan=' + hasOrphan);

    // A should be loaded (in writePath)
    expect(hasNodeA, 'Node A should be loaded from writePath').toBe(true);

    // B and C should be loaded (transitively via A -> B -> C)
    expect(hasNodeB, 'Node B should be lazy-loaded (A links to it)').toBe(true);
    expect(hasNodeC, 'Node C should be lazy-loaded transitively (A -> B -> C)').toBe(true);

    // Orphan should NOT be loaded (nothing links to it)
    expect(hasOrphan, 'Orphan should NOT be loaded (no incoming links)').toBe(false);

    const project1NodeCount = project1Nodes.length;
    console.log('Total nodes in project1:', project1NodeCount);
    expect(project1NodeCount).toBe(3); // A, B, C

    console.log('=== STEP 2: Switch to project2 ===');
    console.log('Switching from:', project1Path);
    console.log('Switching to:', project2Path);

    // Switch to project2 using startFileWatching API
    const switchResult = await appWindow.evaluate(async (newDir: string) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.startFileWatching(newDir);
    }, project2Path);

    console.log('Switch result:', switchResult);
    expect(switchResult.success).toBe(true);

    // Wait for folder load and graph update
    await appWindow.waitForTimeout(3000);

    console.log('=== STEP 3: Verify ONLY project2 nodes are visible ===');

    // Get current nodes after switch
    const currentNodes = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return cy.nodes().filter(n => !n.data('isShadowNode')).map(n => ({
        id: n.id(),
        label: n.data('label') as string
      }));
    });

    console.log('Current nodes after switch:', JSON.stringify(currentNodes, null, 2));

    // Check for project2 node
    const hasNodeX = currentNodes.some(n => n.label === 'Node X');
    console.log('Has Node X (from project2):', hasNodeX);
    expect(hasNodeX, 'Node X from project2 should be visible').toBe(true);

    // BUG ASSERTION: Check that NO nodes from project1 remain
    const project1NodesRemaining = currentNodes.filter(n =>
      n.label === 'Node A' ||
      n.label === 'Node B' ||
      n.label === 'Node C' ||
      n.label === 'Orphan Node'
    );

    console.log('Project1 nodes still visible (BUG if any):', JSON.stringify(project1NodesRemaining, null, 2));

    // Check for any paths from project1
    const nodesWithProject1Path = currentNodes.filter(n =>
      n.id.includes(project1Path)
    );
    console.log('Nodes with project1 path (BUG if any):', JSON.stringify(nodesWithProject1Path, null, 2));

    // THIS IS THE CRITICAL ASSERTION - catches the bug
    // ALL nodes from project1 should be cleared (including lazy-loaded ones)
    expect(project1NodesRemaining.length, 'No project1 nodes should remain after folder switch').toBe(0);
    expect(nodesWithProject1Path.length, 'No paths from project1 should remain').toBe(0);

    // Total should be exactly 1 (Node X from project2)
    console.log('Total node count after switch:', currentNodes.length);
    expect(currentNodes.length, 'Only project2 nodes should be visible').toBe(1);

    console.log('');
    console.log('=== TEST SUMMARY ===');
    console.log('Lazy-loaded nodes persist on folder switch:');
    console.log(`- Project1 had ${project1NodeCount} nodes (including lazy-loaded B, C)`);
    console.log('- Switched to project2');
    console.log(`- Project1 nodes remaining: ${project1NodesRemaining.length} (should be 0)`);
    console.log(`- Project2 nodes visible: ${hasNodeX ? 1 : 0} (should be 1)`);
  });

  /**
   * Additional test: Verify this works with multiple folder switches.
   * Switch project1 -> project2 -> back to project1
   */
  test('multiple folder switches should consistently clear lazy-loaded nodes', async ({
    appWindow,
    project1Path,
    project2Path
  }) => {
    test.setTimeout(90000);

    console.log('=== Initial state: project1 loaded ===');

    // Verify project1 is loaded
    const initialNodes = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return cy.nodes().filter(n => !n.data('isShadowNode')).map(n => n.data('label') as string);
    });

    console.log('Initial project1 nodes:', initialNodes);
    expect(initialNodes).toContain('Node A');

    // SWITCH 1: project1 -> project2
    console.log('=== SWITCH 1: project1 -> project2 ===');

    await appWindow.evaluate(async (newDir: string) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.startFileWatching(newDir);
    }, project2Path);

    await appWindow.waitForTimeout(3000);

    const afterSwitch1 = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return cy.nodes().filter(n => !n.data('isShadowNode')).map(n => n.data('label') as string);
    });

    console.log('After switch 1 (project2):', afterSwitch1);
    expect(afterSwitch1).toContain('Node X');
    expect(afterSwitch1).not.toContain('Node A');
    expect(afterSwitch1).not.toContain('Node B');
    expect(afterSwitch1).not.toContain('Node C');

    // SWITCH 2: project2 -> back to project1
    console.log('=== SWITCH 2: project2 -> project1 ===');

    await appWindow.evaluate(async (newDir: string) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.startFileWatching(newDir);
    }, project1Path);

    await appWindow.waitForTimeout(3000);

    const afterSwitch2 = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return cy.nodes().filter(n => !n.data('isShadowNode')).map(n => n.data('label') as string);
    });

    console.log('After switch 2 (back to project1):', afterSwitch2);

    // Should have project1 nodes again (including lazy-loaded)
    expect(afterSwitch2).toContain('Node A');
    expect(afterSwitch2).toContain('Node B');
    expect(afterSwitch2).toContain('Node C');

    // Should NOT have project2 nodes
    expect(afterSwitch2).not.toContain('Node X');

    // Orphan should still not be loaded
    expect(afterSwitch2).not.toContain('Orphan Node');

    console.log('');
    console.log('=== TEST SUMMARY ===');
    console.log('Multiple folder switches verified:');
    console.log('- project1 -> project2: cleared project1 lazy nodes');
    console.log('- project2 -> project1: cleared project2, reloaded project1 lazy nodes');
  });
});

export { test };

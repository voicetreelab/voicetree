/**
 * BEHAVIORAL SPEC:
 * Test for transitive wikilink loading feature.
 *
 * When a folder is loaded, wikilinks in markdown files are transitively resolved:
 * - A.md links to B.md -> B.md is loaded
 * - B.md links to C.md -> C.md is loaded
 * - C.md links to D.md -> D.md is loaded
 * - This creates a "transitive closure" of all linked files
 *
 * The key function is resolveLinkedNodesInWatchedFolder() in
 * src/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/loadGraphFromDisk.ts
 *
 * TEST SETUP:
 * - tempDir/writePath/A.md -> [[B]] (entry point, in writePath)
 * - tempDir/chain/B.md -> [[C]] (outside writePath, inside watched folder)
 * - tempDir/chain/C.md -> [[D]]
 * - tempDir/chain/D.md (end of chain)
 * - tempDir/chain/orphan.md (no links to it - should NOT be loaded)
 *
 * EXPECTED OUTCOME:
 * - Loading the folder results in A, B, C, D being loaded transitively
 * - orphan.md is NOT loaded (nothing links to it)
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
  writePath: string;
  chainDir: string;
}>({
  /**
   * Creates a temp directory structure for testing transitive wikilink loading:
   *
   * tempDir/                    <- watched folder (root)
   *   writePath/                <- only A.md here (will be loaded immediately)
   *     A.md -> [[B]]
   *   chain/                    <- outside writePath, inside watched folder
   *     B.md -> [[C]]
   *     C.md -> [[D]]
   *     D.md (end of chain)
   *     orphan.md (no links to it)
   *
   * Expected behavior:
   * - A.md loaded because it's in writePath
   * - B.md, C.md, D.md loaded transitively via resolveLinkedNodesInWatchedFolder()
   * - orphan.md NOT loaded (nothing links to it)
   */
  tempDir: async ({}, use) => {
    const tempDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-transitive-chain-'));
    await use(tempDir);
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  chainDir: async ({ tempDir }, use) => {
    const chainDir: string = path.join(tempDir, 'chain');
    await fs.mkdir(chainDir);
    await use(chainDir);
  },

  writePath: async ({ tempDir, chainDir }, use) => {
    const writePath: string = path.join(tempDir, 'writePath');
    await fs.mkdir(writePath);

    // Only A.md is in writePath (this triggers the transitive loading)
    await fs.writeFile(
      path.join(writePath, 'A.md'),
      `# Node A
This is the entry point of the chain.
Links to: [[B]]
`
    );

    // B, C, D are outside writePath but inside watched folder
    await fs.writeFile(
      path.join(chainDir, 'B.md'),
      `# Node B
Second in the chain.
Links to: [[C]]
`
    );

    await fs.writeFile(
      path.join(chainDir, 'C.md'),
      `# Node C
Third in the chain.
Links to: [[D]]
`
    );

    await fs.writeFile(
      path.join(chainDir, 'D.md'),
      `# Node D
End of the chain. No outgoing links.
`
    );

    // Create an orphan node that should NOT be loaded (nothing links to it)
    await fs.writeFile(
      path.join(chainDir, 'orphan.md'),
      `# Orphan Node
This node has NO incoming links.
It should NOT be loaded via transitive resolution.
`
    );

    await use(writePath);
  },

  electronApp: async ({ tempDir, writePath }, use) => {
    const tempUserDataPath: string = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-transitive-chain-userdata-'));

    // Write config:
    // - watchedFolder (lastDirectory): tempDir (the root)
    // - writePath: tempDir/writePath (only A.md)
    // - This means B, C, D, orphan are in watched folder but outside writePath
    const configPath: string = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        lastDirectory: tempDir,
        vaultConfig: {
          [tempDir]: {
            writePath: writePath,
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

test.describe('Transitive Wikilink Loading Chain', () => {
  test('should load all transitively linked nodes A -> B -> C -> D', async ({ appWindow, tempDir }) => {
    test.setTimeout(30000);

    console.log('');
    console.log('=== TEST: Transitive Wikilink Loading Chain A -> B -> C -> D ===');
    console.log('tempDir:', tempDir);

    // Start file watching to trigger the load
    await appWindow.evaluate(async (dir: string) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      await api.main.startFileWatching(dir);
    }, tempDir);

    // Wait for initial load and transitive resolution (multiple hops need time)
    await appWindow.waitForTimeout(3000);

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

    // Core assertions: All 4 chain nodes should be loaded
    console.log('=== ASSERTIONS ===');
    console.log('Expected nodes: Node A, Node B, Node C, Node D');
    console.log('Should NOT have: Orphan Node');

    expect(nodeState.labels, 'Node A should be loaded').toContain('Node A');
    expect(nodeState.labels, 'Node B should be loaded (linked from A)').toContain('Node B');
    expect(nodeState.labels, 'Node C should be loaded (linked from B, transitive from A)').toContain('Node C');
    expect(nodeState.labels, 'Node D should be loaded (linked from C, transitive from A->B->C)').toContain('Node D');

    // Verify orphan is NOT loaded (lazy loading correctly excludes unlinked files)
    const hasOrphan: boolean = nodeState.labels.includes('Orphan Node');
    console.log('Has Orphan Node (should be false for correct lazy loading):', hasOrphan);
    expect(hasOrphan, 'Orphan node should NOT be loaded (no incoming links)').toBe(false);

    // Verify edge connections
    console.log('=== EDGE VERIFICATION ===');
    const hasAtoB: boolean = edgeState.some(e => e.sourceLabel === 'Node A' && e.targetLabel === 'Node B');
    const hasBtoC: boolean = edgeState.some(e => e.sourceLabel === 'Node B' && e.targetLabel === 'Node C');
    const hasCtoD: boolean = edgeState.some(e => e.sourceLabel === 'Node C' && e.targetLabel === 'Node D');

    console.log('A -> B edge exists:', hasAtoB);
    console.log('B -> C edge exists:', hasBtoC);
    console.log('C -> D edge exists:', hasCtoD);

    expect(hasAtoB, 'Edge A -> B should exist').toBe(true);
    expect(hasBtoC, 'Edge B -> C should exist').toBe(true);
    expect(hasCtoD, 'Edge C -> D should exist').toBe(true);
  });

  test('should handle deeper transitive chains (5+ hops)', async ({ appWindow, tempDir, chainDir }) => {
    test.setTimeout(30000);

    console.log('');
    console.log('=== TEST: Deeper Transitive Chain (5+ hops) ===');

    // Add more nodes to create a deeper chain: E -> F -> G
    await fs.writeFile(
      path.join(chainDir, 'E.md'),
      `# Node E
Fifth in extended chain.
Links to: [[F]]
`
    );

    await fs.writeFile(
      path.join(chainDir, 'F.md'),
      `# Node F
Sixth in extended chain.
Links to: [[G]]
`
    );

    await fs.writeFile(
      path.join(chainDir, 'G.md'),
      `# Node G
End of extended chain.
`
    );

    // Modify D to link to E (extending the chain)
    await fs.writeFile(
      path.join(chainDir, 'D.md'),
      `# Node D
Originally end of chain, now links to E.
Links to: [[E]]
`
    );

    // Wait for FS to settle
    await appWindow.waitForTimeout(500);

    // Start file watching
    await appWindow.evaluate(async (dir: string) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      await api.main.startFileWatching(dir);
    }, tempDir);

    // Wait for transitive resolution (7 nodes in chain needs time)
    await appWindow.waitForTimeout(4000);

    const nodeState = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return {
        nodeCount: cy.nodes().length,
        labels: cy.nodes().map(n => n.data('label') as string)
      };
    });

    console.log('Extended chain node state:', JSON.stringify(nodeState, null, 2));

    // All 7 nodes in the chain should be loaded
    expect(nodeState.labels).toContain('Node A');
    expect(nodeState.labels).toContain('Node B');
    expect(nodeState.labels).toContain('Node C');
    expect(nodeState.labels).toContain('Node D');
    expect(nodeState.labels).toContain('Node E');
    expect(nodeState.labels).toContain('Node F');
    expect(nodeState.labels).toContain('Node G');

    // Orphan should still NOT be loaded
    expect(nodeState.labels).not.toContain('Orphan Node');
  });

  test('should handle branching transitive links', async ({ appWindow, tempDir, writePath, chainDir }) => {
    test.setTimeout(30000);

    console.log('');
    console.log('=== TEST: Branching Transitive Links ===');
    console.log('Structure: A -> B -> C, A -> D (D has no link to B or C)');

    // Modify A to have two outgoing links (branching)
    await fs.writeFile(
      path.join(writePath, 'A.md'),
      `# Node A
This is the entry point with branching links.
Links to: [[B]] and [[D]]
`
    );

    // B still links to C
    await fs.writeFile(
      path.join(chainDir, 'B.md'),
      `# Node B
Branch 1: links to C.
Links to: [[C]]
`
    );

    // C is end of branch 1
    await fs.writeFile(
      path.join(chainDir, 'C.md'),
      `# Node C
End of branch 1.
`
    );

    // D is end of branch 2 (separate from B->C chain)
    await fs.writeFile(
      path.join(chainDir, 'D.md'),
      `# Node D
End of branch 2. No further links.
`
    );

    // Wait for FS to settle
    await appWindow.waitForTimeout(500);

    // Start file watching
    await appWindow.evaluate(async (dir: string) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      await api.main.startFileWatching(dir);
    }, tempDir);

    // Wait for transitive resolution
    await appWindow.waitForTimeout(3000);

    const nodeState = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return {
        labels: cy.nodes().map(n => n.data('label') as string)
      };
    });

    const edgeState = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      return cy.edges().map(e => ({
        sourceLabel: e.source().data('label') as string,
        targetLabel: e.target().data('label') as string
      }));
    });

    console.log('Branching node state:', JSON.stringify(nodeState, null, 2));
    console.log('Branching edge state:', JSON.stringify(edgeState, null, 2));

    // All 4 nodes in both branches should be loaded
    expect(nodeState.labels).toContain('Node A');
    expect(nodeState.labels).toContain('Node B');
    expect(nodeState.labels).toContain('Node C');
    expect(nodeState.labels).toContain('Node D');

    // Orphan should NOT be loaded
    expect(nodeState.labels).not.toContain('Orphan Node');

    // Verify both branches have correct edges
    const hasAtoB: boolean = edgeState.some(e => e.sourceLabel === 'Node A' && e.targetLabel === 'Node B');
    const hasAtoD: boolean = edgeState.some(e => e.sourceLabel === 'Node A' && e.targetLabel === 'Node D');
    const hasBtoC: boolean = edgeState.some(e => e.sourceLabel === 'Node B' && e.targetLabel === 'Node C');

    expect(hasAtoB, 'Edge A -> B should exist').toBe(true);
    expect(hasAtoD, 'Edge A -> D should exist').toBe(true);
    expect(hasBtoC, 'Edge B -> C should exist').toBe(true);
  });

  test('should handle circular links without infinite loop', async ({ appWindow, tempDir, writePath, chainDir }) => {
    test.setTimeout(30000);

    console.log('');
    console.log('=== TEST: Circular Links (cycle detection) ===');
    console.log('Structure: A -> B -> C -> A (circular)');

    // Create a circular chain: A -> B -> C -> A
    await fs.writeFile(
      path.join(writePath, 'A.md'),
      `# Node A
Start of circular chain.
Links to: [[B]]
`
    );

    await fs.writeFile(
      path.join(chainDir, 'B.md'),
      `# Node B
Middle of circular chain.
Links to: [[C]]
`
    );

    await fs.writeFile(
      path.join(chainDir, 'C.md'),
      `# Node C
Links back to A (circular).
Links to: [[A]]
`
    );

    // Delete D for this test (not part of the circular chain)
    await fs.rm(path.join(chainDir, 'D.md'));

    // Wait for FS to settle
    await appWindow.waitForTimeout(500);

    // Start file watching
    await appWindow.evaluate(async (dir: string) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      await api.main.startFileWatching(dir);
    }, tempDir);

    // Wait for resolution (should NOT hang due to cycle detection)
    await appWindow.waitForTimeout(3000);

    const nodeState = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not available');
      const ids: string[] = cy.nodes().map(n => n.id());
      const uniqueIds: string[] = Array.from(new Set(ids));
      return {
        labels: cy.nodes().map(n => n.data('label') as string),
        total: ids.length,
        unique: uniqueIds.length
      };
    });

    console.log('Circular chain node state:', JSON.stringify(nodeState, null, 2));

    // All 3 nodes in the circular chain should be loaded
    expect(nodeState.labels).toContain('Node A');
    expect(nodeState.labels).toContain('Node B');
    expect(nodeState.labels).toContain('Node C');

    // No duplicates should exist
    expect(nodeState.total).toBe(nodeState.unique);

    // Orphan should NOT be loaded
    expect(nodeState.labels).not.toContain('Orphan Node');
  });
});

export { test };

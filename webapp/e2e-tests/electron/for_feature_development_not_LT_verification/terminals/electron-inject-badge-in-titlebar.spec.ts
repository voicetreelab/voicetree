/**
 * BEHAVIORAL SPEC:
 * 1. Spawn a terminal with a context node via spawnTerminalWithContextNode.
 * 2. Verify the floating terminal window appears in the DOM.
 * 3. Check whether the .inject-badge element exists inside the terminal's title bar.
 * 4. If the badge exists, attempt to force-show it via the InjectBar registry.
 * 5. Take screenshots to document the state.
 * 6. (Pipeline test) Create a new node in the vault, verify badge becomes visible via the
 *    full pipeline: file watcher → graph delta → broadcastGraphDeltaToUI →
 *    refreshAllInjectBadges (debounced 500ms) → getUnseenNodesForTerminal → updateBadge.
 *
 * PURPOSE: Reproduce reported issue that the inject badge no longer appears in terminal titles,
 *          and verify the full visibility pipeline end-to-end.
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-inject-badge-test-'));

    // Create projects.json with a pre-saved project (required for project selection)
    const projectsPath = path.join(tempUserDataPath, 'projects.json');
    const savedProject = {
      id: 'inject-badge-test-project',
      path: FIXTURE_VAULT_PATH,
      name: 'example_small',
      type: 'folder',
      lastOpened: Date.now(),
      voicetreeInitialized: true
    };
    await fs.writeFile(projectsPath, JSON.stringify([savedProject], null, 2), 'utf8');

    // Legacy config for backwards compatibility
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: FIXTURE_VAULT_PATH }, null, 2), 'utf8');

    // Write settings.json with the echo command as a valid agent
    // (spawnTerminalWithContextNode validates commands against settings.agents)
    const settingsPath = path.join(tempUserDataPath, 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify({
      agents: [
        { name: 'TestEcho', command: 'echo INJECT_BADGE_TEST' }
      ]
    }, null, 2), 'utf8');
    console.log('[Test] Created config files for:', FIXTURE_VAULT_PATH);

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
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15000 });

    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');

    // Navigate through project selection screen
    await window.waitForSelector('text=Voicetree', { timeout: 10000 });
    console.log('[Test] Project selection screen loaded');

    // Wait for saved projects to appear and click to open
    await window.waitForSelector('text=Recent Projects', { timeout: 10000 });
    const projectButton = window.locator('button:has-text("example_small")').first();
    await projectButton.click();
    console.log('[Test] Clicked project to navigate to graph view');

    // Wait for cytoscape to initialize
    try {
      await window.waitForFunction(
        () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
        { timeout: 15000 }
      );
    } catch (error) {
      console.error('Failed to initialize cytoscape instance:', error);
      throw error;
    }

    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Inject Badge in Terminal Title Bar', () => {
  test('inject badge element should exist in the terminal title bar DOM after spawning an agent terminal', async ({ appWindow }) => {
    test.setTimeout(60000);

    console.log('=== STEP 1: Wait for auto-load to complete ===');
    await appWindow.waitForTimeout(2000);

    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) return 0;
        return cy.nodes().length;
      });
    }, {
      message: 'Waiting for graph to auto-load nodes',
      timeout: 20000,
      intervals: [500, 1000, 2000, 2000]
    }).toBeGreaterThan(0);

    const nodeCount = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      return cy ? cy.nodes().length : 0;
    });
    console.log(`Graph auto-loaded with ${nodeCount} nodes`);

    console.log('=== STEP 2: Pick a non-context node to spawn a terminal ===');
    const targetNodeId = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const nodes = cy.nodes().filter(n => !n.data('isContextNode'));
      if (nodes.length === 0) throw new Error('No non-context nodes available');
      return nodes[0].id();
    });
    console.log(`Target node: ${targetNodeId}`);

    console.log('=== STEP 3: Spawn terminal via spawnTerminalWithContextNode ===');
    const command = 'echo INJECT_BADGE_TEST';
    const terminalSpawnResult = await appWindow.evaluate(async ({ nodeId, cmd }) => {
      const w = (window as unknown as ExtendedWindow);
      const api = w.electronAPI;

      if (!api?.terminal || !api?.main) {
        throw new Error('electronAPI terminal/main not available');
      }

      return new Promise<{ terminalId: string; success: boolean }>((resolve) => {
        let capturedTerminalId: string | null = null;

        const timeout = setTimeout(() => {
          resolve({ terminalId: capturedTerminalId ?? '', success: capturedTerminalId !== null });
        }, 15000);

        api.terminal.onData((id, data) => {
          if (!capturedTerminalId) {
            capturedTerminalId = id;
            console.log(`[Test] Terminal ID captured: ${id}`);
          }

          if (data.includes('INJECT_BADGE_TEST')) {
            clearTimeout(timeout);
            setTimeout(() => {
              resolve({ terminalId: capturedTerminalId ?? '', success: true });
            }, 500);
          }
        });

        void api.main.spawnTerminalWithContextNode(nodeId, cmd, 0);
      });
    }, { nodeId: targetNodeId, cmd: command });

    expect(terminalSpawnResult.success).toBe(true);
    console.log(`Terminal spawned: ${terminalSpawnResult.terminalId}`);

    // Wait for DOM to settle
    await appWindow.waitForTimeout(1000);

    console.log('=== STEP 4: Check for floating terminal window in DOM ===');
    const floatingWindowCount = await appWindow.evaluate(() => {
      return document.querySelectorAll('.cy-floating-window').length;
    });
    console.log(`Floating windows found: ${floatingWindowCount}`);
    expect(floatingWindowCount).toBeGreaterThan(0);

    console.log('=== STEP 5: Check for terminal title bar ===');
    const titleBarCount = await appWindow.evaluate(() => {
      return document.querySelectorAll('.terminal-title-bar').length;
    });
    console.log(`Terminal title bars found: ${titleBarCount}`);
    expect(titleBarCount).toBeGreaterThan(0);

    console.log('=== STEP 6: Check for inject-badge element in title bar ===');
    const injectBadgeInfo = await appWindow.evaluate(() => {
      // Check all title bars for inject-badge
      const titleBars = document.querySelectorAll('.terminal-title-bar');
      const results: Array<{
        titleBarIndex: number;
        hasBadge: boolean;
        badgeDisplay: string;
        badgeHTML: string;
        titleBarChildClasses: string[];
      }> = [];

      titleBars.forEach((tb, i) => {
        const badge = tb.querySelector('.inject-badge');
        const childClasses = Array.from(tb.children).map(c => c.className);
        results.push({
          titleBarIndex: i,
          hasBadge: badge !== null,
          badgeDisplay: badge ? (badge as HTMLElement).style.display : 'N/A (not found)',
          badgeHTML: badge ? badge.outerHTML : 'N/A (not found)',
          titleBarChildClasses: childClasses,
        });
      });

      // Also check if inject-badge exists anywhere in the document
      const globalBadges = document.querySelectorAll('.inject-badge');

      return {
        titleBarResults: results,
        globalBadgeCount: globalBadges.length,
      };
    });

    console.log('=== INJECT BADGE INVESTIGATION RESULTS ===');
    console.log(`Global .inject-badge elements in document: ${injectBadgeInfo.globalBadgeCount}`);
    for (const result of injectBadgeInfo.titleBarResults) {
      console.log(`Title bar ${result.titleBarIndex}:`);
      console.log(`  Has .inject-badge: ${result.hasBadge}`);
      console.log(`  Badge display style: ${result.badgeDisplay}`);
      console.log(`  Badge HTML: ${result.badgeHTML}`);
      console.log(`  Title bar children classes: ${JSON.stringify(result.titleBarChildClasses)}`);
    }

    // Take screenshot of the terminal
    await appWindow.screenshot({
      path: 'e2e-tests/screenshots/inject-badge-test-terminal.png'
    });
    console.log('Screenshot saved: inject-badge-test-terminal.png');

    console.log('=== STEP 7: Check if InjectBar registry has an entry ===');
    const registryCheck = await appWindow.evaluate((_terminalId) => {
      // Try to access the module registry - this may not be accessible from the page context
      // Instead, check if the badge element exists in the floating window
      const floatingWindows = document.querySelectorAll('.cy-floating-window');
      const results: Array<{
        windowIndex: number;
        hasTitleBar: boolean;
        hasContextBadge: boolean;
        hasTrafficLights: boolean;
        hasInjectBadge: boolean;
        titleBarInnerHTML: string;
      }> = [];

      floatingWindows.forEach((fw, i) => {
        const titleBar = fw.querySelector('.terminal-title-bar');
        results.push({
          windowIndex: i,
          hasTitleBar: titleBar !== null,
          hasContextBadge: titleBar?.querySelector('.terminal-context-badge') !== null,
          hasTrafficLights: titleBar?.querySelector('.terminal-traffic-lights') !== null,
          hasInjectBadge: titleBar?.querySelector('.inject-badge') !== null,
          titleBarInnerHTML: titleBar ? titleBar.innerHTML.substring(0, 500) : 'N/A',
        });
      });

      return results;
    }, terminalSpawnResult.terminalId);

    console.log('=== FLOATING WINDOW DOM STRUCTURE ===');
    for (const result of registryCheck) {
      console.log(`Window ${result.windowIndex}:`);
      console.log(`  Has title bar: ${result.hasTitleBar}`);
      console.log(`  Has context badge: ${result.hasContextBadge}`);
      console.log(`  Has traffic lights: ${result.hasTrafficLights}`);
      console.log(`  Has inject badge: ${result.hasInjectBadge}`);
      console.log(`  Title bar HTML: ${result.titleBarInnerHTML}`);
    }

    console.log('=== STEP 8: Force badge visible and screenshot ===');
    // Even if there are 0 unseen nodes, the badge element should be in the DOM.
    // Force it visible to verify it renders correctly.
    const forcedBadgeResult = await appWindow.evaluate(() => {
      const badges = document.querySelectorAll('.inject-badge');
      let madeVisible = false;
      badges.forEach(badge => {
        (badge as HTMLElement).style.display = '';
        const textEl = badge.querySelector('.inject-badge-text');
        if (textEl) {
          textEl.textContent = '3 unseen (test)';
        }
        madeVisible = true;
      });
      return { badgeCount: badges.length, madeVisible };
    });

    console.log(`Force-visible result: ${JSON.stringify(forcedBadgeResult)}`);

    if (forcedBadgeResult.madeVisible) {
      await appWindow.waitForTimeout(500);
      await appWindow.screenshot({
        path: 'e2e-tests/screenshots/inject-badge-test-forced-visible.png'
      });
      console.log('Screenshot saved: inject-badge-test-forced-visible.png');
    }

    // The core assertion: the inject-badge element should exist in the DOM
    // It may be hidden (display:none) if there are 0 unseen nodes, but it should be present
    const badgeExistsInAnyTitleBar = injectBadgeInfo.titleBarResults.some(r => r.hasBadge);

    console.log('');
    console.log('=== TEST VERDICT ===');
    if (badgeExistsInAnyTitleBar) {
      console.log('PASS: .inject-badge element EXISTS in terminal title bar');
      console.log('The badge is present in the DOM. If it is not visible, it may be because there are 0 unseen nodes (display: none when count is 0).');
    } else {
      console.log('FAIL: .inject-badge element is MISSING from terminal title bar');
      console.log('This confirms the reported bug - the inject badge is not being mounted into the title bar.');
    }

    // Assert: badge must exist in the DOM
    expect(badgeExistsInAnyTitleBar, 'inject-badge element should exist in terminal title bar').toBe(true);
  });

  test('badge becomes visible when new nearby unseen nodes are created in vault (full pipeline)', async ({ appWindow }) => {
    test.setTimeout(90000);

    // Pre-test cleanup: remove any leftover test files from previous failed runs
    const voicetreeDir = path.join(FIXTURE_VAULT_PATH, 'voicetree');
    try {
      const files = await fs.readdir(voicetreeDir);
      for (const file of files) {
        if (file.startsWith('test_pipeline_unseen_')) {
          const filePath = path.join(voicetreeDir, file);
          fsSync.unlinkSync(filePath);
          console.log(`[Pipeline] Pre-test cleanup: removed leftover ${file}`);
        }
      }
    } catch {
      // Directory might not exist or be inaccessible
    }

    console.log('=== PIPELINE TEST STEP 1: Wait for auto-load to complete ===');
    await appWindow.waitForTimeout(2000);

    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) return 0;
        return cy.nodes().length;
      });
    }, {
      message: 'Waiting for graph to auto-load nodes',
      timeout: 20000,
      intervals: [500, 1000, 2000, 2000]
    }).toBeGreaterThan(0);

    const nodeCount = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      return cy ? cy.nodes().length : 0;
    });
    console.log(`[Pipeline] Graph auto-loaded with ${nodeCount} nodes`);

    console.log('=== PIPELINE TEST STEP 2: Pick a non-context node ===');
    const targetNodeId = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const nodes = cy.nodes().filter(n => !n.data('isContextNode'));
      if (nodes.length === 0) throw new Error('No non-context nodes available');
      return nodes[0].id();
    });
    console.log(`[Pipeline] Target node: ${targetNodeId}`);

    console.log('=== PIPELINE TEST STEP 3: Spawn terminal ===');
    const command = 'echo INJECT_BADGE_TEST';
    const terminalSpawnResult = await appWindow.evaluate(async ({ nodeId, cmd }) => {
      const w = (window as unknown as ExtendedWindow);
      const api = w.electronAPI;

      if (!api?.terminal || !api?.main) {
        throw new Error('electronAPI terminal/main not available');
      }

      return new Promise<{ terminalId: string; success: boolean }>((resolve) => {
        let capturedTerminalId: string | null = null;

        const timeout = setTimeout(() => {
          resolve({ terminalId: capturedTerminalId ?? '', success: capturedTerminalId !== null });
        }, 15000);

        api.terminal.onData((id, data) => {
          if (!capturedTerminalId) {
            capturedTerminalId = id;
          }

          if (data.includes('INJECT_BADGE_TEST')) {
            clearTimeout(timeout);
            setTimeout(() => {
              resolve({ terminalId: capturedTerminalId ?? '', success: true });
            }, 500);
          }
        });

        void api.main.spawnTerminalWithContextNode(nodeId, cmd, 0);
      });
    }, { nodeId: targetNodeId, cmd: command });

    expect(terminalSpawnResult.success).toBe(true);
    console.log(`[Pipeline] Terminal spawned: ${terminalSpawnResult.terminalId}`);

    // Wait for DOM to settle and initial badge refresh to complete
    await appWindow.waitForTimeout(2000);

    console.log('=== PIPELINE TEST STEP 4: Verify badge starts hidden (0 unseen nodes) ===');
    const initialBadgeDisplay = await appWindow.evaluate(() => {
      const badges = document.querySelectorAll('.inject-badge');
      if (badges.length === 0) return 'NOT_FOUND';
      return (badges[0] as HTMLElement).style.display;
    });
    console.log(`[Pipeline] Initial badge display: "${initialBadgeDisplay}"`);
    // Badge should be hidden (display: none) since there are no unseen nodes yet
    expect(initialBadgeDisplay).toBe('none');

    console.log('=== PIPELINE TEST STEP 5: Create new markdown file in vault ===');
    // Creating a new .md file in the vault triggers:
    // file watcher 'add' → handleFSEventWithStateAndUISides → applyGraphDeltaToMemState →
    // broadcastGraphDeltaToUI → refreshAllInjectBadges (debounced 500ms) →
    // getUnseenNodesForTerminal → updateInjectBadge IPC → badge visible
    const testNodeFilename = `test_pipeline_unseen_${Date.now()}.md`;
    const testNodePath = path.join(FIXTURE_VAULT_PATH, 'voicetree', testNodeFilename);

    // Extract target node basename for the wikilink
    const targetBasename = path.basename(targetNodeId);

    const testNodeContent = [
      '---',
      'position:',
      '  x: 600',
      '  y: 600',
      'isContextNode: false',
      '---',
      '# Pipeline Test Unseen Node',
      '',
      'This node was created during the E2E pipeline test to verify inject badge visibility.',
      '',
      '-----------------',
      '_Links:_',
      'Parent:',
      `- test_link [[${targetBasename}]]`,
      '',
    ].join('\n');

    try {
      await fs.writeFile(testNodePath, testNodeContent, 'utf8');
      console.log(`[Pipeline] Created test node file: ${testNodePath}`);
      console.log(`[Pipeline] Wikilink target: ${targetBasename}`);

      console.log('=== PIPELINE TEST STEP 6: Wait for badge to become visible ===');
      // Timing: chokidar stabilityThreshold (100ms) + file read + graph delta processing +
      // refreshAllInjectBadges debounce (500ms) + getUnseenNodesForTerminal + IPC
      // Total expected: ~1-3 seconds
      await expect.poll(async () => {
        return appWindow.evaluate(() => {
          const badges = document.querySelectorAll('.inject-badge');
          if (badges.length === 0) return 'NOT_FOUND';
          return (badges[0] as HTMLElement).style.display;
        });
      }, {
        message: 'Waiting for inject badge to become visible after creating new nearby node',
        timeout: 15000,
        intervals: [1000, 1000, 1000, 2000, 2000, 3000]
      }).not.toBe('none');

      console.log('=== PIPELINE TEST STEP 7: Verify badge text shows unseen count ===');
      const badgeInfo = await appWindow.evaluate(() => {
        const badge = document.querySelector('.inject-badge');
        if (!badge) return { display: 'NOT_FOUND', text: '' };
        return {
          display: (badge as HTMLElement).style.display,
          text: badge.querySelector('.inject-badge-text')?.textContent ?? '',
        };
      });
      console.log(`[Pipeline] Badge info: display="${badgeInfo.display}", text="${badgeInfo.text}"`);
      expect(badgeInfo.text).toMatch(/\d+ unseen/);

      // Take screenshot documenting the visible badge
      await appWindow.screenshot({
        path: 'e2e-tests/screenshots/inject-badge-pipeline-test-visible.png'
      });
      console.log('[Pipeline] Screenshot saved: inject-badge-pipeline-test-visible.png');

      console.log('');
      console.log('=== PIPELINE TEST VERDICT ===');
      console.log('PASS: Full pipeline verified — file watcher → graph delta → refreshAllInjectBadges → badge visible');
    } finally {
      // Stop file watcher before cleanup to release chokidar file handles
      try {
        await appWindow.evaluate(async () => {
          const api = (window as unknown as ExtendedWindow).electronAPI;
          if (api) {
            await api.main.stopFileWatching();
          }
        });
        await appWindow.waitForTimeout(500);
      } catch {
        // Best-effort — app may already be closing
      }

      // Delete test file. If this fails (e.g. due to lingering file handles),
      // the pre-test cleanup at the start of the test handles leftovers.
      try {
        fsSync.unlinkSync(testNodePath);
        console.log(`[Pipeline] Cleaned up test file: ${testNodePath}`);
      } catch (cleanupErr) {
        console.warn(`[Pipeline] Cleanup deferred to pre-test: ${cleanupErr}`);
      }
    }
  });
});

export { test };

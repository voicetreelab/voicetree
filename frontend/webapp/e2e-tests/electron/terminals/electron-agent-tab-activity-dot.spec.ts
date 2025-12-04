/**
 * BEHAVIORAL SPEC:
 * E2E test for agent tab activity dot indicator
 *
 * This test verifies:
 * 1. Load example_small fixture
 * 2. Create a context node from a node
 * 3. Spawn terminal attached to the context node (creates agent tab)
 * 4. Add a new node that creates an outgoing edge from the context node
 * 5. Verify the activity dot appears on the agent tab
 * 6. Click the tab and verify dot disappears
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

// Use absolute paths for example_folder_fixtures
const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

// Type definitions
interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

// Extend test with Electron app
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  tempFixturePath: string;
}>({
  // Create a temp copy of the fixture to avoid modifying original
  tempFixturePath: async ({}, use) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-activity-dot-test-'));

    // Copy fixture to temp directory
    await fs.cp(FIXTURE_VAULT_PATH, tempDir, { recursive: true });

    await use(tempDir);

    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  electronApp: async ({ tempFixturePath: _tempFixturePath }, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-activity-dot-userdata-'));

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1'
      },
      timeout: 10000
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
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Agent Tab Activity Dot E2E', () => {
  test('should show activity dot when context node gets new outgoing edge', async ({ appWindow, tempFixturePath }) => {
    test.setTimeout(60000);

    console.log('=== STEP 1: Load the test vault ===');
    const watchResult = await appWindow.evaluate(async (vaultPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.startFileWatching(vaultPath);
    }, tempFixturePath);

    expect(watchResult.success).toBe(true);
    console.log('✓ File watching started');

    await appWindow.waitForTimeout(2000);

    console.log('=== STEP 2: Create context node from Node 5 ===');
    const parentNodeId = '5_Immediate_Test_Observation_No_Output.md';

    const contextNodeId = await appWindow.evaluate(async (nodeId) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.createContextNode(nodeId);
    }, parentNodeId);

    console.log(`✓ Context node created: ${contextNodeId}`);
    expect(contextNodeId).toBeTruthy();
    expect(contextNodeId).toMatch(/^ctx-nodes\//);

    await appWindow.waitForTimeout(1000);

    console.log('=== STEP 3: Spawn terminal on context node via main process ===');
    // Use spawnTerminalWithContextNode which properly orchestrates terminal creation
    // It creates the terminal UI and adds to TerminalStore
    await appWindow.evaluate(async (ctxNodeId) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api?.main?.spawnTerminalWithContextNode) {
        throw new Error('electronAPI.main.spawnTerminalWithContextNode not available');
      }

      // Use simple echo command, terminalCount 0
      await api.main.spawnTerminalWithContextNode(ctxNodeId, 'echo "Terminal ready"', 0);
    }, contextNodeId);

    console.log('✓ Terminal spawn initiated');

    // Wait for terminal to be created in UI
    await appWindow.waitForTimeout(2500);

    console.log('=== STEP 4: Verify agent tab exists ===');
    const agentTabsBar = await appWindow.locator('[data-testid="agent-tabs-bar"]');
    await expect(agentTabsBar).toBeVisible();

    const agentTab = await appWindow.locator('.agent-tab');
    await expect(agentTab).toBeVisible();
    console.log('✓ Agent tab visible');

    console.log('=== STEP 5: Verify no activity dot initially ===');
    const initialDot = await appWindow.locator('.agent-tab-activity-dot').count();
    expect(initialDot).toBe(0);
    console.log('✓ No activity dot initially');

    console.log('=== STEP 6: Create two new child nodes from context node ===');
    // Get watch status to find the watched directory
    const watchStatus = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getWatchStatus();
    });

    const watchDir = watchStatus.directory!;
    const contextNodePath = path.join(watchDir, contextNodeId);

    // Create first child node file in ctx-nodes folder
    const childNode1FileName = 'agent_produced_child_1.md';
    const childNode1Path = path.join(watchDir, `ctx-nodes/${childNode1FileName}`);
    await fs.writeFile(childNode1Path, `---
title: "Agent Produced Child 1"
---

# Agent Produced Child 1

This is the first node produced by the agent.
`, 'utf-8');
    console.log('✓ Created first child node file');

    // Create second child node file in ctx-nodes folder
    const childNode2FileName = 'agent_produced_child_2.md';
    const childNode2Path = path.join(watchDir, `ctx-nodes/${childNode2FileName}`);
    await fs.writeFile(childNode2Path, `---
title: "Agent Produced Child 2"
---

# Agent Produced Child 2

This is the second node produced by the agent.
`, 'utf-8');
    console.log('✓ Created second child node file');

    // Wait for file watcher to pick up the new files
    await appWindow.waitForTimeout(2000);

    // Now modify the context node to add wikilinks to both children
    // This creates two outgoing edges from context node, should show 2 dots
    // NOTE: Must use wikilink syntax [[link]] - standard markdown links [text](url) are NOT edges
    const contextContent = await fs.readFile(contextNodePath, 'utf-8');
    const updatedContextContent = contextContent + `\n\n- produced [[${childNode1FileName}]]\n- produced [[${childNode2FileName}]]\n`;
    await fs.writeFile(contextNodePath, updatedContextContent, 'utf-8');
    console.log('✓ Added wikilinks from context node to both children');

    // Wait for file watcher to process the change and trigger delta
    await appWindow.waitForTimeout(3000);

    console.log('=== STEP 7: Verify two activity dots appear ===');
    const activityDots = await appWindow.locator('.agent-tab-activity-dot');
    await expect(activityDots).toHaveCount(2, { timeout: 5000 });
    console.log('✓ Two activity dots are visible!');

    console.log('=== STEP 8: Take screenshot ===');
    await appWindow.screenshot({
      path: 'e2e-tests/test-results/agent-tab-activity-dot.png',
      fullPage: true
    });
    console.log('✓ Screenshot saved to e2e-tests/test-results/agent-tab-activity-dot.png');

    console.log('=== STEP 9: Click agent tab and verify dot disappears ===');
    await agentTab.click();
    await appWindow.waitForTimeout(500);

    const dotAfterClick = await appWindow.locator('.agent-tab-activity-dot').count();
    expect(dotAfterClick).toBe(0);
    console.log('✓ Activity dot disappeared after clicking tab');

    console.log('');
    console.log('=== TEST SUMMARY ===');
    console.log('✓ Vault loaded');
    console.log('✓ Context node created');
    console.log('✓ Terminal spawned with agent tab');
    console.log('✓ No activity dot initially');
    console.log('✓ Child node created and linked from context node');
    console.log('✓ Activity dot appeared (new outgoing edge detected)');
    console.log('✓ Activity dot cleared on tab click');
    console.log('');
    console.log('✅ AGENT TAB ACTIVITY DOT TEST PASSED');
  });
});

export { test };

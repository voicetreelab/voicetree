/**
 * BEHAVIORAL SPEC:
 * E2E test for the agent permission mode prompt that appears on first Claude agent spawn.
 *
 * This test verifies the COMPLETE flow for both choices:
 * 1. Auto-run choice: Settings are updated to include --dangerously-skip-permissions flag
 * 2. Safe Mode choice: Settings keep the original command without the flag
 *
 * TEST APPROACH:
 * - Uses AGENT_PERMISSION_TEST_RESPONSE env var to simulate dialog responses
 * - Uses echo command (with 'claude' prefix) to avoid running actual Claude
 * - Verifies settings.agentPermissionModeChosen is set to true after prompt
 * - Verifies settings.agents[0].command has correct flag presence
 *
 * EXPECTED OUTCOME:
 * ✅ Auto-run test: Command gets --dangerously-skip-permissions flag added
 * ✅ Safe Mode test: Command stays without the flag
 * ✅ Both tests: agentPermissionModeChosen is set to true
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
import type { VTSettings } from '@/pure/settings';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

/**
 * Create test fixture with specified permission response
 */
function createTestFixture(permissionResponse: 'auto-run' | 'safe-mode') {
  return base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
    tempUserDataPath: string;
  }>({
    tempUserDataPath: async ({}, use) => {
      const tempPath = await fs.mkdtemp(path.join(os.tmpdir(), `voicetree-permission-${permissionResponse}-test-`));
      await use(tempPath);
      await fs.rm(tempPath, { recursive: true, force: true });
    },

    electronApp: async ({ tempUserDataPath }, use) => {
      // Write config to auto-load test vault
      const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
      await fs.writeFile(configPath, JSON.stringify({
        lastDirectory: FIXTURE_VAULT_PATH,
        suffixes: { [FIXTURE_VAULT_PATH]: '' }
      }, null, 2), 'utf8');

      // Write initial settings with agentPermissionModeChosen: false
      // Use echo command that starts with "claude" to trigger permission check
      const settingsPath = path.join(tempUserDataPath, 'settings.json');
      const initialSettings: Partial<VTSettings> = {
        agentPermissionModeChosen: false,
        agents: [
          { name: 'Claude', command: 'claude echo "PERMISSION_TEST_MARKER"' }
        ],
        terminalSpawnPathRelativeToWatchedDirectory: '/'
      };
      await fs.writeFile(settingsPath, JSON.stringify(initialSettings, null, 2), 'utf8');
      console.log(`[Test] Created settings with agentPermissionModeChosen: false`);

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
          AGENT_PERMISSION_TEST_RESPONSE: permissionResponse
        },
        timeout: 15000
      });

      await use(electronApp);

      try {
        const window = await electronApp.firstWindow();
        await window.evaluate(async () => {
          const api = (window as unknown as ExtendedWindow).electronAPI;
          if (api) await api.main.stopFileWatching();
        });
        await window.waitForTimeout(300);
      } catch {
        console.log('Note: Could not stop file watching during cleanup');
      }

      await electronApp.close();
    },

    appWindow: async ({ electronApp }, use) => {
      const window = await electronApp.firstWindow({ timeout: 15000 });

      window.on('console', msg => {
        const text = msg.text();
        // Log permission-related messages for debugging
        if (text.includes('Permission') || text.includes('permission')) {
          console.log(`BROWSER [${msg.type()}]:`, text);
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
}

// Test for Auto-run choice
const autoRunTest = createTestFixture('auto-run');

autoRunTest.describe('Agent Permission Prompt - Auto-run Choice', () => {
  autoRunTest('should add --dangerously-skip-permissions flag when Auto-run is chosen', async ({ appWindow, tempUserDataPath }) => {
    autoRunTest.setTimeout(30000);

    console.log('=== STEP 1: Verify initial settings state ===');
    const initialSettings = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.loadSettings();
    }) as VTSettings;

    console.log('Initial settings:', JSON.stringify(initialSettings, null, 2));
    expect(initialSettings.agentPermissionModeChosen).toBeFalsy();
    expect(initialSettings.agents[0].command).not.toContain('--dangerously-skip-permissions');
    console.log('✓ Initial settings verified: no permission flag, agentPermissionModeChosen is false');

    console.log('=== STEP 2: Wait for graph to load ===');
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        return cy ? cy.nodes().length : 0;
      });
    }, { message: 'Waiting for nodes to load', timeout: 10000 }).toBeGreaterThan(0);
    console.log('✓ Graph loaded');

    console.log('=== STEP 3: Get a node to spawn terminal from ===');
    const targetNodeId = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const nodes = cy.nodes();
      // Find a non-context node (one with .md extension)
      for (let i = 0; i < nodes.length; i++) {
        const id = nodes[i].id();
        if (id.endsWith('.md') && !id.startsWith('ctx-nodes/')) {
          return id;
        }
      }
      return nodes[0].id();
    });
    console.log(`✓ Target node: ${targetNodeId}`);

    console.log('=== STEP 4: Trigger terminal spawn (this triggers permission prompt) ===');
    // Call the main process to spawn terminal - this should trigger permission prompt
    await appWindow.evaluate(async (nodeId) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      // This calls spawnTerminalWithContextNode which triggers the permission check
      await api.main.spawnTerminalWithContextNode(nodeId, undefined, 0);
    }, targetNodeId);

    // Wait for settings to be saved
    await appWindow.waitForTimeout(1000);

    console.log('=== STEP 5: Verify settings were updated ===');
    const updatedSettings = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.loadSettings();
    }) as VTSettings;

    console.log('Updated settings:', JSON.stringify(updatedSettings, null, 2));

    // Verify agentPermissionModeChosen is now true
    expect(updatedSettings.agentPermissionModeChosen).toBe(true);
    console.log('✓ agentPermissionModeChosen is now true');

    // Verify Claude agent command has the flag
    const claudeAgent = updatedSettings.agents.find(a => a.name === 'Claude');
    expect(claudeAgent).toBeDefined();
    expect(claudeAgent!.command).toContain('--dangerously-skip-permissions');
    console.log('✓ Claude agent command contains --dangerously-skip-permissions flag');

    // Also verify the settings file on disk
    const settingsPath = path.join(tempUserDataPath, 'settings.json');
    const savedSettingsRaw = await fs.readFile(settingsPath, 'utf8');
    const savedSettings = JSON.parse(savedSettingsRaw) as VTSettings;
    expect(savedSettings.agentPermissionModeChosen).toBe(true);
    expect(savedSettings.agents[0].command).toContain('--dangerously-skip-permissions');
    console.log('✓ Settings file on disk verified');

    console.log('');
    console.log('=== TEST SUMMARY ===');
    console.log('✓ Initial settings had no permission flag');
    console.log('✓ Terminal spawn triggered permission prompt');
    console.log('✓ Auto-run choice was simulated via env var');
    console.log('✓ Settings updated with --dangerously-skip-permissions flag');
    console.log('✓ agentPermissionModeChosen set to true');
    console.log('');
    console.log('✅ AUTO-RUN PERMISSION TEST PASSED');
  });
});

// Test for Safe Mode choice
const safeModeTest = createTestFixture('safe-mode');

safeModeTest.describe('Agent Permission Prompt - Safe Mode Choice', () => {
  safeModeTest('should NOT add --dangerously-skip-permissions flag when Safe Mode is chosen', async ({ appWindow, tempUserDataPath }) => {
    safeModeTest.setTimeout(30000);

    console.log('=== STEP 1: Verify initial settings state ===');
    const initialSettings = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.loadSettings();
    }) as VTSettings;

    console.log('Initial settings:', JSON.stringify(initialSettings, null, 2));
    expect(initialSettings.agentPermissionModeChosen).toBeFalsy();
    expect(initialSettings.agents[0].command).not.toContain('--dangerously-skip-permissions');
    const originalCommand = initialSettings.agents[0].command;
    console.log('✓ Initial settings verified: no permission flag, agentPermissionModeChosen is false');

    console.log('=== STEP 2: Wait for graph to load ===');
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        return cy ? cy.nodes().length : 0;
      });
    }, { message: 'Waiting for nodes to load', timeout: 10000 }).toBeGreaterThan(0);
    console.log('✓ Graph loaded');

    console.log('=== STEP 3: Get a node to spawn terminal from ===');
    const targetNodeId = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const nodes = cy.nodes();
      for (let i = 0; i < nodes.length; i++) {
        const id = nodes[i].id();
        if (id.endsWith('.md') && !id.startsWith('ctx-nodes/')) {
          return id;
        }
      }
      return nodes[0].id();
    });
    console.log(`✓ Target node: ${targetNodeId}`);

    console.log('=== STEP 4: Trigger terminal spawn (this triggers permission prompt) ===');
    await appWindow.evaluate(async (nodeId) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      await api.main.spawnTerminalWithContextNode(nodeId, undefined, 0);
    }, targetNodeId);

    await appWindow.waitForTimeout(1000);

    console.log('=== STEP 5: Verify settings were updated ===');
    const updatedSettings = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.loadSettings();
    }) as VTSettings;

    console.log('Updated settings:', JSON.stringify(updatedSettings, null, 2));

    // Verify agentPermissionModeChosen is now true (prompt was shown)
    expect(updatedSettings.agentPermissionModeChosen).toBe(true);
    console.log('✓ agentPermissionModeChosen is now true');

    // Verify Claude agent command does NOT have the flag
    const claudeAgent = updatedSettings.agents.find(a => a.name === 'Claude');
    expect(claudeAgent).toBeDefined();
    expect(claudeAgent!.command).not.toContain('--dangerously-skip-permissions');
    expect(claudeAgent!.command).toBe(originalCommand);
    console.log('✓ Claude agent command does NOT contain --dangerously-skip-permissions flag');

    // Also verify the settings file on disk
    const settingsPath = path.join(tempUserDataPath, 'settings.json');
    const savedSettingsRaw = await fs.readFile(settingsPath, 'utf8');
    const savedSettings = JSON.parse(savedSettingsRaw) as VTSettings;
    expect(savedSettings.agentPermissionModeChosen).toBe(true);
    expect(savedSettings.agents[0].command).not.toContain('--dangerously-skip-permissions');
    console.log('✓ Settings file on disk verified');

    console.log('');
    console.log('=== TEST SUMMARY ===');
    console.log('✓ Initial settings had no permission flag');
    console.log('✓ Terminal spawn triggered permission prompt');
    console.log('✓ Safe Mode choice was simulated via env var');
    console.log('✓ Settings NOT modified (no --dangerously-skip-permissions)');
    console.log('✓ agentPermissionModeChosen set to true');
    console.log('');
    console.log('✅ SAFE MODE PERMISSION TEST PASSED');
  });
});

export { autoRunTest, safeModeTest };

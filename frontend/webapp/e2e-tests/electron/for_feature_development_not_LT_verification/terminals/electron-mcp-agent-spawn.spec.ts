/**
 * E2E Test: MCP spawn_agent + list_agents
 *
 * Verifies:
 * 1) MCP server is reachable and can initialize
 * 2) spawn_agent spawns a terminal for an existing node
 * 3) list_agents returns the spawned agent with status
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');
const MCP_URL = 'http://localhost:3001/mcp';
const TARGET_NODE_ID = '1_VoiceTree_Website_Development_and_Node_Display_Bug.md';

interface ExtendedWindow {
  electronAPI?: {
    main: {
      startFileWatching: (dir: string) => Promise<{ success: boolean; directory?: string; error?: string }>;
      stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
      getWatchStatus: () => Promise<{ isWatching: boolean; directory?: string; vaultSuffix: string }>;
      saveSettings: (settings: Record<string, unknown>) => Promise<void>;
    };
  };
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  tempUserDataPath: string;
}>({
  tempUserDataPath: async ({}, use) => {
    const tempPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-mcp-spawn-test-'));
    await use(tempPath);
    await fs.rm(tempPath, { recursive: true, force: true });
  },

  electronApp: async ({ tempUserDataPath }, use) => {
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
      timeout: 5000
    });

    const electronProcess = electronApp.process();
    if (electronProcess?.stdout) {
      electronProcess.stdout.on('data', (chunk: Buffer) => {
        console.log(`[MAIN STDOUT] ${chunk.toString().trim()}`);
      });
    }
    if (electronProcess?.stderr) {
      electronProcess.stderr.on('data', (chunk: Buffer) => {
        console.error(`[MAIN STDERR] ${chunk.toString().trim()}`);
      });
    }

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
    await new Promise(resolve => setTimeout(resolve, 2000));
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 60000 });

    window.on('console', msg => {
      if (!msg.text().includes('Electron Security Warning')) {
        console.log(`BROWSER [${msg.type()}]:`, msg.text());
      }
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);
    await use(window);
  }
});

async function waitForMcpServer(maxRetries = 60, delayMs = 1000): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(MCP_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 0,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'healthcheck', version: '1.0.0' } }
        })
      });
      console.log(`[MCP Spawn Test] Health check status: ${response.status}`);
      if (response.status > 0) {
        return true;
      }
    } catch {
      console.log(`[MCP Spawn Test] Server not ready, attempt ${i + 1}/${maxRetries}`);
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return false;
}

async function mcpRequest(method: string, params: Record<string, unknown> = {}, id = 1): Promise<unknown> {
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
  });

  const text = await response.text();
  return JSON.parse(text);
}

async function mcpCallToolRaw(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const response = await mcpRequest('tools/call', {
    name: toolName,
    arguments: args
  }) as { result?: { content?: Array<{ type: string; text: string }>; isError?: boolean }; error?: { message: string } };

  if (response.error) {
    throw new Error(`MCP error: ${response.error.message}`);
  }

  const content = response.result?.content?.[0]?.text;
  if (!content) {
    throw new Error('MCP response missing content');
  }

  return JSON.parse(content);
}

test.describe('MCP Agent Spawn E2E', () => {
  test.describe.configure({ mode: 'serial', timeout: 90000 });

  test('spawn_agent creates a terminal and list_agents returns it', async ({ appWindow }) => {
    await appWindow.waitForTimeout(2000);

    const serverReady = await waitForMcpServer();
    expect(serverReady).toBe(true);

    const watchResult = await appWindow.evaluate(async (vaultPath) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.startFileWatching(vaultPath);
    }, FIXTURE_VAULT_PATH);

    expect(watchResult.success).toBe(true);
    await appWindow.waitForTimeout(3000);

    const watchStatus = await appWindow.evaluate(async () => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getWatchStatus();
    });

    const vaultPath = watchStatus.vaultSuffix
      ? path.join(watchStatus.directory ?? FIXTURE_VAULT_PATH, watchStatus.vaultSuffix)
      : (watchStatus.directory ?? FIXTURE_VAULT_PATH);

    await appWindow.evaluate(async () => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      await api.main.saveSettings({
        terminalSpawnPathRelativeToWatchedDirectory: '../',
        agents: [{ name: 'MCP Test Agent', command: 'echo MCP_AGENT_TEST' }],
        shiftEnterSendsOptionEnter: true,
        INJECT_ENV_VARS: {}
      });
    });

    await mcpRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'e2e-test', version: '1.0.0' }
    });

    const setVaultResponse = await mcpCallToolRaw('set_vault_path', { vaultPath });
    expect((setVaultResponse as { success: boolean }).success).toBe(true);

    const spawnResponse = await mcpCallToolRaw('spawn_agent', { nodeId: TARGET_NODE_ID }) as {
      success: boolean;
      terminalId: string;
      nodeId: string;
      contextNodeId: string;
    };

    expect(spawnResponse.success).toBe(true);
    expect(spawnResponse.nodeId).toBe(TARGET_NODE_ID);
    expect(spawnResponse.terminalId).toBeTruthy();
    expect(spawnResponse.contextNodeId).toBeTruthy();

    await expect.poll(async () => {
      const listResponse = await mcpCallToolRaw('list_agents', {}) as {
        agents: Array<{
          terminalId: string;
          title: string;
          contextNodeId: string;
          status: 'running' | 'exited';
          newNodes: Array<{ nodeId: string; title: string }>;
        }>;
      };

      return listResponse.agents.find(agent => agent.terminalId === spawnResponse.terminalId);
    }, {
      message: 'Waiting for spawned agent to appear in list_agents',
      timeout: 10000,
      intervals: [250, 500, 1000]
    }).toBeTruthy();
  });
});

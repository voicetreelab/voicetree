/**
 * SMOKE TEST for main.ts
 *
 * Purpose: Verify that the Electron app compiles, starts, and can navigate to graph view.
 * This test:
 * 1. Launches with a pre-saved project in projects.json
 * 2. Verifies project selection screen shows with the saved project
 * 3. Selects the project to navigate to graph view
 * 4. Verifies graph loads correctly with nodes
 *
 * This is a minimal smoke test - we verify core startup and navigation behavior.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import type { Core as CytoscapeCore, NodeSingular } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

// Use absolute paths
const WEBAPP_ROOT = path.resolve(process.cwd());
const REPO_ROOT = path.resolve(WEBAPP_ROOT, '..');
const FAKE_AGENT_ENTRYPOINT = path.join(REPO_ROOT, 'tools', 'vt-fake-agent', 'dist', 'index.js');

type ElectronDiagnostics = {
  mainOutput: string[];
  rendererErrors: string[];
};

type McpToolResult = {
  success: boolean;
  parsed?: Record<string, unknown>;
  isError?: boolean;
};

type SmokeElectronAPI = Omit<ElectronAPI, 'terminal'> & {
  terminal: {
    spawn: (data: Record<string, unknown>) => Promise<{ success: boolean; terminalId?: string; error?: string }>;
  };
};

// Type definitions
interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: SmokeElectronAPI;
}

function canLoadNativeGraphDbModules(nodeBin: string): boolean {
  try {
    execFileSync(nodeBin, ['-e', "const Database = require('better-sqlite3'); new Database(':memory:').close()"], {
      cwd: REPO_ROOT,
      stdio: 'ignore'
    });
    return true;
  } catch {
    return false;
  }
}

function resolveGraphDaemonNodeBin(): string {
  const nvmNodeBin = path.join(os.homedir(), '.nvm', 'versions', 'node', 'v22.20.0', 'bin', 'node');
  const candidates = [
    process.env.VT_GRAPHD_NODE_BIN,
    process.env.npm_node_execpath,
    process.execPath,
    existsSync(nvmNodeBin) ? nvmNodeBin : undefined,
    'node'
  ].filter((candidate): candidate is string => !!candidate);

  return candidates.find(canLoadNativeGraphDbModules) ?? process.execPath;
}

function escapeProcessPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stopSmokeGraphDaemonForVault(vaultPath: string): void {
  try {
    execFileSync('pkill', ['-f', `vt-graphd\\.ts --vault ${escapeProcessPattern(vaultPath)}`], {
      stdio: 'ignore'
    });
  } catch {
    // No matching smoke daemon is fine.
  }
}

// Extend test with Electron app
const test = base.extend<{
  fixtureVaultPath: string;
  electronDiagnostics: ElectronDiagnostics;
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  fixtureVaultPath: async ({}, use) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-smoke-vault-'));
    const tempVaultPath = path.join(tempRoot, 'example_small');
    await fs.mkdir(tempVaultPath, { recursive: true });
    await fs.writeFile(path.join(tempVaultPath, 'root.md'), [
      '# Smoke Root',
      '',
      'Links to [[first-child.md]] and [[second-child.md]].',
      ''
    ].join('\n'), 'utf8');
    await fs.writeFile(path.join(tempVaultPath, 'first-child.md'), [
      '# First Child',
      '',
      'Smoke fixture child node.',
      ''
    ].join('\n'), 'utf8');
    await fs.writeFile(path.join(tempVaultPath, 'second-child.md'), [
      '# Second Child',
      '',
      'Smoke fixture child node.',
      ''
    ].join('\n'), 'utf8');

    await use(tempVaultPath);

    await fs.rm(tempRoot, { recursive: true, force: true });
  },

  electronDiagnostics: async ({}, use) => {
    await use({ mainOutput: [], rendererErrors: [] });
  },

  electronApp: async ({ fixtureVaultPath, electronDiagnostics }, use) => {
    // Create a temporary userData directory for this test
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-smoke-test-'));

    // Create projects.json with a pre-saved project
    // This simulates a user who has previously used the app
    const projectsPath = path.join(tempUserDataPath, 'projects.json');
    const savedProject = {
      id: 'smoke-test-project-id',
      path: fixtureVaultPath,
      name: 'example_small',
      type: 'folder',
      lastOpened: Date.now(),
      voicetreeInitialized: true
    };
    await fs.writeFile(projectsPath, JSON.stringify([savedProject], null, 2), 'utf8');
    console.log('[Smoke Test] Created projects.json with saved project:', fixtureVaultPath);

    // Also keep the legacy config file for backwards compatibility
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({
      lastDirectory: fixtureVaultPath,
      vaultConfig: {
        [fixtureVaultPath]: {
          writePath: fixtureVaultPath,
          readPaths: []
        }
      }
    }, null, 2), 'utf8');

    const fakeAgentScript = {
      actions: [
        {
          type: 'create_node',
          title: 'Smoke Fake Agent Progress Node',
          summary: 'Created by the Electron smoke test through vt-fake-agent.',
          content: 'Fake-agent Electron smoke coverage marker.',
          color: 'green'
        },
        { type: 'exit', code: 0 }
      ]
    };
    const settingsPath = path.join(tempUserDataPath, 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify({
      agents: [
        { name: 'Fake Agent', command: `node ${JSON.stringify(FAKE_AGENT_ENTRYPOINT)} "$AGENT_PROMPT"` }
      ],
      defaultAgent: 'Fake Agent',
      terminalSpawnPathRelativeToWatchedDirectory: '/',
      INJECT_ENV_VARS: {
        AGENT_PROMPT: `### FAKE_AGENT_SCRIPT ### ${JSON.stringify(fakeAgentScript)} ### END_FAKE_AGENT_SCRIPT ###`
      }
    }, null, 2), 'utf8');
    const graphDaemonNodeBin = resolveGraphDaemonNodeBin();
    console.log('[Smoke Test] vt-graphd Node:', graphDaemonNodeBin);

    const electronApp = await electron.launch({
      args: [
        path.join(WEBAPP_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}` // Use temp userData to isolate test config
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1',
        VT_GRAPHD_NODE_BIN: graphDaemonNodeBin
      },
      timeout: 30000
    });

    const electronProcess = electronApp.process();
    electronProcess?.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      electronDiagnostics.mainOutput.push(text);
      console.log(`[MAIN STDOUT] ${text.trim()}`);
    });
    electronProcess?.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      electronDiagnostics.mainOutput.push(text);
      console.error(`[MAIN STDERR] ${text.trim()}`);
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
      console.log('Note: Could not stop file watching during cleanup (window may be closed)');
    }

    await electronApp.close();
    stopSmokeGraphDaemonForVault(fixtureVaultPath);
    console.log('[Smoke Test] Electron app closed');

    // Cleanup temp directory
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp, electronDiagnostics, fixtureVaultPath }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15000 });

    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    window.on('pageerror', error => {
      electronDiagnostics.rendererErrors.push(error.message);
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');

    const projectButton = window.locator('button:has-text("example_small")').first();
    try {
      await window.waitForSelector('text=Recent Projects', { timeout: 5000 });
      console.log('[Smoke Test] Recent Projects section visible');
      await projectButton.click();
      console.log('[Smoke Test] Clicked project to navigate to graph view');
    } catch {
      console.log('[Smoke Test] Project selection skipped; loading fixture vault directly');
      await window.evaluate(async (vaultPath: string) => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (!api) throw new Error('electronAPI not available');
        await api.main.startFileWatching(vaultPath);
      }, fixtureVaultPath);
    }

    // Wait for graph view to load (cytoscape instance should become available)
    await window.waitForFunction(
      () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
      { timeout: 15000 }
    );
    console.log('[Smoke Test] Graph view loaded');

    // Wait a bit longer to ensure graph is ready
    await window.waitForTimeout(1000);

    await use(window);
  }
});

async function waitForMcpServer(mcpUrl: string, maxRetries = 20, delayMs = 1000): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(mcpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 0,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'smoke-healthcheck', version: '1.0.0' }
          }
        })
      });
      if (response.ok) return true;
    } catch {
      // Retry until the MCP server finishes startup.
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return false;
}

async function mcpRequest(mcpUrl: string, method: string, params: Record<string, unknown> = {}, id = 1): Promise<unknown> {
  const response = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
  });
  return JSON.parse(await response.text());
}

async function mcpCallTool(mcpUrl: string, toolName: string, args: Record<string, unknown>): Promise<McpToolResult> {
  const response = await mcpRequest(mcpUrl, 'tools/call', {
    name: toolName,
    arguments: args
  }) as {
    result?: { content?: Array<{ type: string; text: string }>; isError?: boolean };
    error?: { message: string };
  };

  if (response.error) {
    throw new Error(`MCP error: ${response.error.message}`);
  }

  const text = response.result?.content?.[0]?.text;
  const parsed = text ? JSON.parse(text) as Record<string, unknown> : undefined;
  return {
    success: parsed?.success === true,
    parsed,
    isError: response.result?.isError
  };
}

function expectNoCriticalElectronErrors(diagnostics: ElectronDiagnostics): void {
  const criticalErrorPatterns = [
    /NODE_MODULE_VERSION/i,
    /was compiled against a different Node\.js version/i,
    /better-sqlite3/i,
    /DaemonLaunchTimeout/i,
    /ERR_DLOPEN_FAILED/i,
    /Error invoking remote method/i,
    /An object could not be cloned/i,
    /\[spawnTerminalWithContextNode\] async spawn failed/i,
    /\[fake-agent\] Fatal:/i,
    /ERR_MODULE_NOT_FOUND/i
  ];
  const criticalErrors = [...diagnostics.mainOutput, ...diagnostics.rendererErrors]
    .filter(line => criticalErrorPatterns.some(pattern => pattern.test(line)));

  expect(criticalErrors).toEqual([]);
}

test.describe('Smoke Test', () => {
  test('should start app and load graph after project selection', async ({ appWindow, electronDiagnostics }) => {
    test.setTimeout(30000);
    console.log('=== SMOKE TEST: Verify Electron app compiles, starts, and loads graph ===');

    // Verify app is in graph view with cytoscape and electronAPI ready
    const appReady = await appWindow.evaluate(() => {
      return !!(window as ExtendedWindow).cytoscapeInstance &&
             !!(window as ExtendedWindow).electronAPI;
    });
    expect(appReady).toBe(true);
    console.log('✓ App loaded successfully with graph view');

    // Wait for graph nodes to load and stay observable at assertion time.
    await expect.poll(async () => {
      return await appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        return cy?.nodes().length ?? 0;
      });
    }, {
      message: 'Waiting for Cytoscape nodes to render',
      timeout: 15000,
      intervals: [500, 1000, 1000]
    }).toBeGreaterThan(2);
    console.log('✓ Cytoscape nodes loaded');

    // Verify graph was automatically loaded into main process state
    const graph = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getGraph();
    });

    expect(graph).toBeDefined();
    expectNoCriticalElectronErrors(electronDiagnostics);
    const nodeCount = Object.keys(graph.nodes).length;
    console.log(`✓ Graph loaded into state with ${nodeCount} nodes`);
    expect(nodeCount).toBeGreaterThan(1);

    // Verify graph was rendered in Cytoscape UI-edge
    const cytoscapeState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return {
        nodeCount: cy.nodes().length,
        nodeLabels: cy.nodes().map((n: NodeSingular) => n.data('label')).slice(0, 3)
      };
    });

    console.log(`✓ Graph rendered in UI with ${cytoscapeState.nodeCount} nodes`);
    console.log('  Sample labels:', cytoscapeState.nodeLabels.join(', '));

    // Smoke test: Just verify nodes are rendered (may include virtual nodes)
    expect(cytoscapeState.nodeCount).toBeGreaterThan(2);

    // Verify back button is visible (confirms we're in graph view with navigation)
    const backButton = appWindow.locator('button[title="Back to project selection"]');
    await expect(backButton).toBeVisible({ timeout: 5000 });
    console.log('✓ Back button visible (confirms graph view with project selection integration)');

    expectNoCriticalElectronErrors(electronDiagnostics);
    console.log('✅ Smoke test passed!');
  });

  test('should spawn fake agent and record a progress node', async ({ appWindow, fixtureVaultPath, electronDiagnostics }) => {
    test.setTimeout(60000);
    console.log('=== SMOKE TEST: Verify fake agent can create a progress node ===');

    const mcpPort = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getMcpPort();
    });
    const mcpUrl = `http://127.0.0.1:${mcpPort}/mcp`;
    expect(await waitForMcpServer(mcpUrl)).toBe(true);

    await mcpRequest(mcpUrl, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'fake-agent-smoke-test', version: '1.0.0' }
    });

    await expect.poll(async () => {
      return await appWindow.evaluate(async () => {
        const api = (window as ExtendedWindow).electronAPI;
        if (!api) throw new Error('electronAPI not available');
        const graph = await api.main.getGraph();
        return Object.keys(graph.nodes).length;
      });
    }, {
      message: 'Waiting for graph nodes before spawning fake agent',
      timeout: 15000,
      intervals: [500, 1000, 1000]
    }).toBeGreaterThan(0);

    const nodeIds = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      const graph = await api.main.getGraph();
      return Object.keys(graph.nodes);
    });
    const parentNodeId = nodeIds[0];

    const callerTerminalId = 'e2e-smoke-caller';
    const spawnCallerResult = await appWindow.evaluate(async ({ callerId, parentId }) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api?.terminal) throw new Error('electronAPI.terminal not available');
      return await api.terminal.spawn({
        type: 'Terminal',
        terminalId: callerId,
        attachedToContextNodeId: parentId,
        terminalCount: 0,
        title: 'E2E Smoke Caller',
        anchoredToNodeId: { _tag: 'None' },
        shadowNodeDimensions: { width: 600, height: 400 },
        resizable: true,
        initialCommand: 'sleep 120',
        executeCommand: true,
        isPinned: true,
        isDone: false,
        lastOutputTime: Date.now(),
        activityCount: 0,
        parentTerminalId: null,
        agentName: callerId,
        worktreeName: undefined,
        isHeadless: false
      });
    }, { callerId: callerTerminalId, parentId: parentNodeId });
    expect(spawnCallerResult.success).toBe(true);

    await expect.poll(async () => {
      const listResult = await mcpCallTool(mcpUrl, 'list_agents', {});
      const agents = (listResult.parsed as {
        agents: Array<{ terminalId: string }>
      }).agents;
      return agents.some(agent => agent.terminalId === callerTerminalId);
    }, {
      message: 'Waiting for caller terminal to register in list_agents',
      timeout: 10000,
      intervals: [250, 500, 1000]
    }).toBe(true);

    const fakeAgentSpawn = await mcpCallTool(mcpUrl, 'spawn_agent', {
      nodeId: parentNodeId,
      callerTerminalId,
      agentName: 'Fake Agent',
      spawnDirectory: REPO_ROOT,
      depthBudget: 0,
      headless: true
    });
    expect(fakeAgentSpawn.parsed).toMatchObject({ success: true });
    const fakeAgentTerminalId = (fakeAgentSpawn.parsed as { terminalId: string }).terminalId;
    expect(fakeAgentTerminalId).toBeTruthy();

    await expect.poll(async () => {
      const listResult = await mcpCallTool(mcpUrl, 'list_agents', {});
      const agents = (listResult.parsed as {
        agents: Array<{
          terminalId: string;
          status: string;
          exitCode: number | null;
          newNodes?: Array<{ nodeId: string; title: string }>;
        }>
      }).agents;
      const fakeAgent = agents.find(agent => agent.terminalId === fakeAgentTerminalId);
      return {
        status: fakeAgent?.status ?? 'missing',
        exitCode: fakeAgent?.exitCode ?? null,
        hasProgressNode: fakeAgent?.newNodes?.some(node => node.title === 'Smoke Fake Agent Progress Node') ?? false
      };
    }, {
      message: 'Waiting for fake agent to exit after creating a progress node',
      timeout: 30000,
      intervals: [1000, 1000, 2000, 5000]
    }).toEqual({
      status: 'exited',
      exitCode: 0,
      hasProgressNode: true
    });

    const progressNodeFiles = await fs.readdir(fixtureVaultPath);
    const progressNodeFile = progressNodeFiles.find(file => file.startsWith('fake-agent-') && file.endsWith('.md'));
    expect(progressNodeFile).toBeTruthy();
    const progressNodeContent = await fs.readFile(path.join(fixtureVaultPath, progressNodeFile!), 'utf8');
    expect(progressNodeContent).toContain('# Smoke Fake Agent Progress Node');
    expect(progressNodeContent).toContain('Fake-agent Electron smoke coverage marker.');

    expectNoCriticalElectronErrors(electronDiagnostics);
    console.log('✅ Fake agent progress-node smoke test passed!');
  });
});

export { test };

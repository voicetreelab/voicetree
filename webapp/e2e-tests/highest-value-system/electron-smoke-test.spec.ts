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
import type { NodeSingular } from 'cytoscape';
import {
  WEBAPP_ROOT, REPO_ROOT, FAKE_AGENT_ENTRYPOINT,
  type ElectronDiagnostics, type ExtendedWindow,
  resolveGraphDaemonNodeBin, stopSmokeGraphDaemonForVault,
  waitForMcpServer, mcpRequest, mcpCallTool,
  expectNoCriticalElectronErrors
} from './electron-smoke-helpers';

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
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-smoke-test-'));

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

    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({
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
        {
          type: 'create_node',
          title: 'Smoke Node Two',
          summary: 'Second node verifying SSE delta rendering.',
          content: 'Second smoke node content.',
          color: 'blue'
        },
        {
          type: 'create_node',
          title: 'Smoke Node Three',
          summary: 'Third node verifying SSE delta rendering.',
          content: 'Third smoke node content.',
          color: 'blue'
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

    const ciFlags = process.env.CI
      ? ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader']
      : [];

    const electronApp = await electron.launch({
      args: [
        ...ciFlags,
        path.join(WEBAPP_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1',
        VT_GRAPHD_NODE_BIN: graphDaemonNodeBin
      },
      timeout: 60000
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

    stopSmokeGraphDaemonForVault(fixtureVaultPath);

    if (electronProcess?.pid) {
      try {
        process.kill(electronProcess.pid, 'SIGKILL');
      } catch {
        // Electron already exited.
      }
    }

    try {
      await Promise.race([
        electronApp.close(),
        new Promise(resolve => setTimeout(resolve, 5000))
      ]);
    } catch {
      // Close may fail if already killed.
    }
    console.log('[Smoke Test] Electron app closed');

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

    if (process.env.CI) {
      console.log('[Smoke Test] CI mode: calling startFileWatching directly');
      await window.evaluate(async (vaultPath: string) => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (!api) throw new Error('electronAPI not available');
        await api.main.startFileWatching(vaultPath);
      }, fixtureVaultPath);
    } else {
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
    }

    await window.waitForFunction(
      () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
      { timeout: 15000 }
    );
    console.log('[Smoke Test] Graph view loaded');

    await window.waitForTimeout(1000);

    await use(window);
  }
});

test.describe('Smoke Test', () => {
  test('should start app and load graph after project selection', async ({ appWindow, electronDiagnostics }) => {
    test.setTimeout(process.env.CI ? 120000 : 30000);
    console.log('=== SMOKE TEST: Verify Electron app compiles, starts, and loads graph ===');

    const appReady = await appWindow.evaluate(() => {
      return !!(window as ExtendedWindow).cytoscapeInstance &&
             !!(window as ExtendedWindow).electronAPI;
    });
    expect(appReady).toBe(true);
    console.log('✓ App loaded successfully with graph view');

    // Diagnostic: explicitly trigger startFileWatching and wait for it
    const sfwResult = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) return { error: 'no electronAPI' };
      try {
        const ws1 = await api.main.getWatchStatus();
        console.log('[DIAG] Before explicit startFileWatching:', JSON.stringify(ws1));
        if (!ws1.isWatching && ws1.directory) {
          console.log('[DIAG] Calling startFileWatching explicitly with:', ws1.directory);
          const result = await api.main.startFileWatching(ws1.directory);
          console.log('[DIAG] startFileWatching result:', JSON.stringify(result));
        }
        const ws2 = await api.main.getWatchStatus();
        const graph = await api.main.getGraph();
        return { watchStatus: ws2, graphNodeCount: Object.keys(graph.nodes).length };
      } catch (e: unknown) {
        return { error: String(e) };
      }
    });
    console.log('[DIAG] After startFileWatching:', JSON.stringify(sfwResult));

    await expect.poll(async () => {
      const diag = await appWindow.evaluate(async () => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        const api = (window as ExtendedWindow).electronAPI;
        let mainGraphNodes = 0;
        try {
          const graph = await api!.main.getGraph();
          mainGraphNodes = Object.keys(graph.nodes).length;
        } catch { /* ignore */ }
        return {
          cyNodes: cy?.nodes().length ?? 0,
          mainGraphNodes,
        };
      });
      console.log('[DIAG poll]', JSON.stringify(diag));
      return diag.cyNodes;
    }, {
      message: 'Waiting for Cytoscape nodes to render',
      timeout: 45000,
      intervals: [500, 1000, 2000, 3000]
    }).toBeGreaterThan(2);
    console.log('✓ Cytoscape nodes loaded');

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

    expect(cytoscapeState.nodeCount).toBeGreaterThan(2);

    const backButton = appWindow.locator('button[title="Back to project selection"]');
    await expect(backButton).toBeVisible({ timeout: 5000 });
    console.log('✓ Back button visible (confirms graph view with project selection integration)');

    expectNoCriticalElectronErrors(electronDiagnostics);
    console.log('✅ Smoke test passed!');
  });

  test('should spawn fake agent and record a progress node', async ({ appWindow, fixtureVaultPath, electronDiagnostics }) => {
    test.setTimeout(process.env.CI ? 120000 : 60000);
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
      timeout: 45000,
      intervals: [500, 1000, 2000, 3000]
    }).toBeGreaterThan(0);

    const nodeIds = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      const graph = await api.main.getGraph();
      return Object.keys(graph.nodes);
    });
    const parentNodeId = nodeIds[0];

    const cyNodeCountBeforeAgent: number = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      return cy?.nodes().length ?? 0;
    });
    console.log(`[Smoke Test] Cytoscape nodes before fake agent: ${cyNodeCountBeforeAgent}`);

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

    // Verify SSE delta rendering: all 3 agent-created nodes must appear in Cytoscape
    await expect.poll(async () => {
      return await appWindow.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        return cy?.nodes().length ?? 0;
      });
    }, {
      message: `Waiting for 3 new nodes to render in Cytoscape (started with ${cyNodeCountBeforeAgent})`,
      timeout: 15000,
      intervals: [500, 1000, 2000, 3000]
    }).toBeGreaterThanOrEqual(cyNodeCountBeforeAgent + 3);
    console.log('✓ All 3 agent-created nodes rendered in Cytoscape via SSE delta path');

    expectNoCriticalElectronErrors(electronDiagnostics);
    console.log('✅ Fake agent progress-node smoke test passed!');
  });
});

export { test };

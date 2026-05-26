/**
 * SMOKE TEST for main.ts
 *
 * Pattern: launch Electron with --open-folder → wait for graph → assert.
 * --open-folder sets startupFolderOverride, which makes initialLoad() call
 * loadFolder() directly, bypassing project selection entirely.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { randomUUID } from 'crypto';
import type { NodeSingular } from 'cytoscape';
import { closeElectronAppForSmoke } from './electron-smoke-test/electron-app-close';
import {
  WEBAPP_ROOT, REPO_ROOT, FAKE_AGENT_ENTRYPOINT,
  type ElectronDiagnostics, type ExtendedWindow,
  resolveGraphDaemonNodeBin, stopSmokeGraphDaemonForVault, stopSmokeTmuxServer,
  waitForMcpServer, mcpRequest, mcpCallTool,
  expectNoCriticalElectronErrors
} from './electron-smoke-helpers';

// Extend test with Electron app
const test = base.extend<{
  fixtureVaultPath: string;
  tempUserDataPath: string;
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

  tempUserDataPath: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-smoke-test-'));
    await use(tempUserDataPath);
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  electronDiagnostics: async ({}, use) => {
    await use({ mainOutput: [], rendererErrors: [] });
  },

  electronApp: async ({ fixtureVaultPath, tempUserDataPath, electronDiagnostics }, use) => {
    // Pin writeFolder to vault root so the daemon indexes the fixture .md files
    // (without this, initializeProject creates a voicetree-{date} subfolder)
    await fs.writeFile(path.join(tempUserDataPath, 'voicetree-config.json'), JSON.stringify({
      vaultConfig: {
        [fixtureVaultPath]: { writeFolder: fixtureVaultPath, readPaths: [] }
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
    await fs.writeFile(path.join(tempUserDataPath, 'settings.json'), JSON.stringify({
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
      ? ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
      : [];

    const electronApp = await electron.launch({
      args: [
        ...ciFlags,
        path.join(WEBAPP_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`,
        '--open-folder', fixtureVaultPath
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        VOICETREE_PERSIST_STATE: '1',
        VT_GRAPHD_NODE_BIN: graphDaemonNodeBin,
        ENABLE_PLAYWRIGHT_DEBUG: '0'
      },
      timeout: 60000
    });

    const electronProcess = electronApp.process();
    const stdoutHandler = (chunk: Buffer) => {
      const text = chunk.toString();
      electronDiagnostics.mainOutput.push(text);
      console.log(`[MAIN STDOUT] ${text.trim()}`);
    };
    const stderrHandler = (chunk: Buffer) => {
      const text = chunk.toString();
      electronDiagnostics.mainOutput.push(text);
      console.error(`[MAIN STDERR] ${text.trim()}`);
    };
    electronProcess?.stdout?.on('data', stdoutHandler);
    electronProcess?.stderr?.on('data', stderrHandler);

    await use(electronApp);

    await closeElectronAppForSmoke(electronApp, electronProcess);
    stopSmokeGraphDaemonForVault(fixtureVaultPath);
    stopSmokeTmuxServer(tempUserDataPath);
    electronProcess?.stdout?.off('data', stdoutHandler);
    electronProcess?.stderr?.off('data', stderrHandler);
    console.log('[Smoke Test] Electron app closed');
  },

  appWindow: async ({ electronApp, electronDiagnostics }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15000 });

    window.on('console', msg => {
      if (msg.type() === 'error') {
        electronDiagnostics.rendererErrors.push(msg.text());
      }
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    window.on('pageerror', error => {
      electronDiagnostics.rendererErrors.push(error.message);
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');

    // --open-folder triggers auto-load: initialLoad() → loadFolder() → graph view.
    // Use timer-based polling (not rAF) — headless Electron on CI throttles
    // requestAnimationFrame, causing waitForFunction's default raf polling to
    // never observe cytoscapeInstance despite it being set.
    await expect.poll(async () => {
      return await window.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        return !!cy && !cy.destroyed();
      });
    }, {
      message: 'Waiting for Cytoscape to initialize via --open-folder auto-load',
      timeout: 30000,
      intervals: [250, 500, 1000, 2000]
    }).toBe(true);
    console.log('[Smoke Test] Graph view loaded via --open-folder auto-load');

    await use(window);
  }
});

test.describe('Smoke Test', () => {
  test.describe.configure({ timeout: process.env.CI ? 120000 : 60000 });

  test('should start app and load graph after project selection', async ({ appWindow, electronDiagnostics }) => {
    console.log('=== SMOKE TEST: Verify Electron app compiles, starts, and loads graph ===');

    const appReady = await appWindow.evaluate(() => {
      return !!(window as ExtendedWindow).cytoscapeInstance &&
             !!(window as ExtendedWindow).electronAPI;
    });
    expect(appReady).toBe(true);
    console.log('✓ App loaded successfully with graph view');

    await expect.poll(async () => {
      return await appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        return cy?.nodes().length ?? 0;
      });
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

    const callerTerminalId = `e2e-smoke-caller-${randomUUID().slice(0, 8)}`;
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
    const spawnPayload = fakeAgentSpawn.parsed as { success: boolean; error?: string; terminalId?: string };
    if (!spawnPayload.success) {
      console.error('[smoke] spawn_agent failed:', JSON.stringify(spawnPayload, null, 2));
    }
    expect(spawnPayload, `spawn_agent error: ${spawnPayload.error ?? 'unknown'}`).toMatchObject({ success: true });
    const fakeAgentTerminalId = spawnPayload.terminalId!;
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
      const exitCode = fakeAgent?.exitCode ?? null;
      return {
        status: fakeAgent?.status ?? 'missing',
        exitCodeOk: exitCode === null || exitCode === 0,
        hasProgressNode: fakeAgent?.newNodes?.some(node => node.title === 'Smoke Fake Agent Progress Node') ?? false
      };
    }, {
      message: 'Waiting for fake agent to exit after creating a progress node',
      timeout: 30000,
      intervals: [1000, 1000, 2000, 5000]
    }).toEqual({
      status: 'exited',
      exitCodeOk: true,
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

    // Caller terminal cleanup is handled by the fixture-owned tmux server
    // teardown, which is scoped to this test's temporary app-support path.

    expectNoCriticalElectronErrors(electronDiagnostics);
    console.log('✅ Fake agent progress-node smoke test passed!');
  });
});

export { test };

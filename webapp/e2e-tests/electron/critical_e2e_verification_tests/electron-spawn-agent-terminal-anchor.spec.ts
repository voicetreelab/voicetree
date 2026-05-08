import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  FAKE_AGENT_ENTRYPOINT,
  REPO_ROOT,
  WEBAPP_ROOT,
  type ElectronDiagnostics,
  type ExtendedWindow,
  expectNoCriticalElectronErrors,
  getCiElectronFlags,
  mcpCallTool,
  mcpRequest,
  resolveGraphDaemonNodeBin,
  robustElectronTeardown,
  safeStopFileWatching,
  stopSmokeGraphDaemonForVault,
  waitForMcpServer,
} from './electron-smoke-helpers';

const test = base.extend<{
  fixtureVaultPath: string;
  tempUserDataPath: string;
  electronDiagnostics: ElectronDiagnostics;
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  fixtureVaultPath: async ({}, use) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-anchor-vault-'));
    const tempVaultPath = path.join(tempRoot, 'anchor-vault');
    await fs.mkdir(tempVaultPath, { recursive: true });
    await fs.writeFile(
      path.join(tempVaultPath, 'Root.md'),
      '# Root\n\nSpawn-agent terminal anchoring parent.\n',
      'utf8',
    );
    await use(tempVaultPath);

    await fs.rm(tempRoot, { recursive: true, force: true });
  },

  tempUserDataPath: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-anchor-user-data-'));
    await use(tempUserDataPath);
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  electronDiagnostics: async ({}, use) => {
    await use({ mainOutput: [], rendererErrors: [] });
  },

  electronApp: async ({ fixtureVaultPath, tempUserDataPath, electronDiagnostics }, use) => {
    await fs.writeFile(path.join(tempUserDataPath, 'voicetree-config.json'), JSON.stringify({
      vaultConfig: {
        [fixtureVaultPath]: { writePath: fixtureVaultPath, readPaths: [] },
      },
    }, null, 2), 'utf8');

    const fakeAgentScript = {
      actions: [
        { type: 'log', message: 'anchor e2e fake agent started' },
        { type: 'delay', ms: 60_000 },
      ],
    };
    await fs.writeFile(path.join(tempUserDataPath, 'settings.json'), JSON.stringify({
      agents: [
        { name: 'Fake Agent', command: `node ${JSON.stringify(FAKE_AGENT_ENTRYPOINT)} "$AGENT_PROMPT"` },
      ],
      defaultAgent: 'Fake Agent',
      terminalSpawnPathRelativeToWatchedDirectory: '/',
      INJECT_ENV_VARS: {
        AGENT_PROMPT: `### FAKE_AGENT_SCRIPT ### ${JSON.stringify(fakeAgentScript)} ### END_FAKE_AGENT_SCRIPT ###`,
      },
    }, null, 2), 'utf8');

    const electronApp = await electron.launch({
      args: [
        ...getCiElectronFlags(),
        path.join(WEBAPP_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`,
        '--open-folder',
        fixtureVaultPath,
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1',
        VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
      },
      timeout: 60_000,
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
    await safeStopFileWatching(electronApp);
    await robustElectronTeardown(electronApp);
  },

  appWindow: async ({ electronApp, electronDiagnostics }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15_000 });

    window.on('console', msg => {
      if (!msg.text().includes('Electron Security Warning')) {
        console.log(`BROWSER [${msg.type()}]:`, msg.text());
      }
    });
    window.on('pageerror', error => {
      electronDiagnostics.rendererErrors.push(error.message);
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await expect.poll(async () => {
      return await window.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        return Boolean(cy && !cy.destroyed() && cy.nodes().length > 0);
      });
    }, {
      message: 'Waiting for the temp vault graph to render',
      timeout: 45_000,
      intervals: [250, 500, 1000, 2000],
    }).toBe(true);

    await use(window);
  },
});

type AnchorState = {
  taskNodeInCy: boolean;
  terminalExists: boolean;
  left: string;
  top: string;
  shadowExists: boolean;
  edgeExists: boolean;
  edgeSource: string | null;
  edgeTarget: string | null;
};

async function readAnchorState(appWindow: Page, terminalId: string, taskNodeId: string): Promise<AnchorState> {
  return await appWindow.evaluate(({ terminalId: targetTerminalId, taskNodeId: targetTaskNodeId }) => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');

    const terminalElement = Array.from(document.querySelectorAll<HTMLElement>('.cy-floating-window-terminal'))
      .find(element => element.getAttribute('data-floating-window-id') === targetTerminalId);
    const shadowNodeId = `${targetTerminalId}-anchor-shadowNode`;
    const edgeId = `edge-${targetTaskNodeId}-${shadowNodeId}`;
    const edge = cy.getElementById(edgeId);

    return {
      taskNodeInCy: cy.getElementById(targetTaskNodeId).length > 0,
      terminalExists: Boolean(terminalElement),
      left: terminalElement?.style.left ?? '',
      top: terminalElement?.style.top ?? '',
      shadowExists: cy.getElementById(shadowNodeId).length > 0,
      edgeExists: edge.length > 0,
      edgeSource: edge.length > 0 ? edge.source().id() : null,
      edgeTarget: edge.length > 0 ? edge.target().id() : null,
    };
  }, { terminalId, taskNodeId });
}

test.describe('spawn_agent terminal anchoring', () => {
  test('anchors the spawned interactive terminal to the new task node', async ({ appWindow, fixtureVaultPath, electronDiagnostics }) => {
    test.setTimeout(process.env.CI ? 120_000 : 90_000);

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
      clientInfo: { name: 'spawn-anchor-e2e', version: '1.0.0' },
    });

    const watchResult = await appWindow.evaluate(async (vaultPath) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.startFileWatching(vaultPath);
    }, fixtureVaultPath);
    expect(watchResult.success).toBe(true);

    await expect.poll(async () => {
      return await appWindow.evaluate(async () => {
        const api = (window as ExtendedWindow).electronAPI;
        if (!api) throw new Error('electronAPI not available');
        const graph = await api.main.getGraph();
        return Object.keys(graph.nodes).length;
      });
    }, {
      message: 'Waiting for graph state after explicit file watching start',
      timeout: 15_000,
      intervals: [250, 500, 1000],
    }).toBeGreaterThan(0);

    const parentNodeId = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      const graph = await api.main.getGraph();
      const nodeIds = Object.keys(graph.nodes);
      if (nodeIds.length === 0) throw new Error('No graph nodes loaded');
      return nodeIds[0];
    });

    const callerTerminalId = 'e2e-anchor-caller';
    const callerSpawn = await appWindow.evaluate(async ({ callerTerminalId, parentNodeId }) => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api?.terminal) throw new Error('electronAPI.terminal not available');
      return await api.terminal.spawn({
        type: 'Terminal',
        terminalId: callerTerminalId,
        attachedToContextNodeId: parentNodeId,
        terminalCount: 0,
        title: 'E2E Anchor Caller',
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
        agentName: callerTerminalId,
        worktreeName: undefined,
        isHeadless: false,
      });
    }, { callerTerminalId, parentNodeId });
    expect(callerSpawn.success).toBe(true);

    await expect.poll(async () => {
      const listResult = await mcpCallTool(mcpUrl, 'list_agents', {});
      const agents = (listResult.parsed as { agents: Array<{ terminalId: string }> }).agents;
      return agents.some(agent => agent.terminalId === callerTerminalId);
    }, {
      message: 'Waiting for caller terminal to register before MCP spawn_agent',
      timeout: 10_000,
      intervals: [250, 500, 1000],
    }).toBe(true);

    const spawnResult = await mcpCallTool(mcpUrl, 'spawn_agent', {
      task: 'E2E spawned terminal anchor task',
      parentNodeId,
      callerTerminalId,
      agentName: 'Fake Agent',
      spawnDirectory: REPO_ROOT,
      depthBudget: 0,
      headless: false,
    });
    expect(spawnResult.parsed, `spawn_agent failed: ${JSON.stringify(spawnResult.parsed, null, 2)}`).toMatchObject({ success: true });

    const spawnPayload = spawnResult.parsed as { terminalId: string; taskNodeId: string };
    expect(spawnPayload.terminalId).toBeTruthy();
    expect(spawnPayload.taskNodeId).toBeTruthy();

    await appWindow.evaluate((nodeId) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const previousTimer = (window as unknown as { __anchorRemovalTimer?: number }).__anchorRemovalTimer;
      if (previousTimer) window.clearInterval(previousTimer);
      const removeRenderedTaskNode = () => {
        cy.remove(cy.getElementById(nodeId));
      };
      removeRenderedTaskNode();
      const timer = window.setInterval(removeRenderedTaskNode, 50);
      (window as unknown as { __anchorRemovalTimer?: number }).__anchorRemovalTimer = timer;
      window.setTimeout(() => {
        window.clearInterval(timer);
        (window as unknown as { __anchorRemovalTimer?: number }).__anchorRemovalTimer = undefined;
      }, 4_000);
    }, spawnPayload.taskNodeId);

    await expect.poll(async () => {
      return await appWindow.evaluate((nodeId) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        return (cy?.getElementById(nodeId).length ?? 0) === 0;
      }, spawnPayload.taskNodeId);
    }, {
      message: 'Waiting for the task node to be absent from Cytoscape before spawn',
      timeout: 15_000,
      intervals: [250, 500, 1000],
    }).toBe(true);

    await expect.poll(async () => {
      const state = await readAnchorState(appWindow, spawnPayload.terminalId, spawnPayload.taskNodeId);
      return state.terminalExists;
    }, {
      message: 'Waiting for spawned terminal to appear while the task node is absent from Cytoscape',
      timeout: 15_000,
      intervals: [250, 500, 1000],
    }).toBe(true);

    await appWindow.waitForTimeout(4_200);

    await fs.writeFile(
      spawnPayload.taskNodeId,
      `# E2E spawned terminal anchor task\n\nUpdated after spawn_agent so the watcher projects this task node back into Cytoscape.\n\n${Date.now()}\n`,
      'utf8',
    );

    await expect.poll(async () => {
      const state = await readAnchorState(appWindow, spawnPayload.terminalId, spawnPayload.taskNodeId);
      return state.taskNodeInCy &&
        state.terminalExists &&
        state.left !== '100px' &&
        state.top !== '100px' &&
        state.shadowExists &&
        state.edgeExists &&
        state.edgeSource === spawnPayload.taskNodeId &&
        state.edgeTarget === `${spawnPayload.terminalId}-anchor-shadowNode`;
    }, {
      message: 'Waiting for spawned terminal to anchor after the task node re-enters Cytoscape',
      timeout: 30_000,
      intervals: [250, 500, 1000, 2000],
    }).toBe(true);

    const anchorState = await readAnchorState(appWindow, spawnPayload.terminalId, spawnPayload.taskNodeId);
    expect(anchorState).toMatchObject({
      taskNodeInCy: true,
      terminalExists: true,
      shadowExists: true,
      edgeExists: true,
      edgeSource: spawnPayload.taskNodeId,
      edgeTarget: `${spawnPayload.terminalId}-anchor-shadowNode`,
    });
    expect(anchorState.left).not.toBe('100px');
    expect(anchorState.top).not.toBe('100px');

    expectNoCriticalElectronErrors(electronDiagnostics);
  });
});

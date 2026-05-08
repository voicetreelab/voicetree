/**
 * E2E: Real agent spawn + sub-agent orchestration
 *
 * Spawns a REAL Sonnet agent on a node whose content instructs it to
 * spawn one Sonnet and one Codex headful sub-agent, each creating a
 * hello-world node. Asserts agent counts and node creation over time.
 *
 * NOT for CI — burns real API credits.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  WEBAPP_ROOT,
  type ExtendedWindow,
  getCiElectronFlags,
  resolveGraphDaemonNodeBin,
  robustElectronTeardown,
  safeStopFileWatching,
  stopSmokeGraphDaemonForVault,
  waitForMcpServer,
  mcpRequest,
  mcpCallTool,
} from './electron-smoke-helpers';

const SCREENSHOT_DIR = path.join(WEBAPP_ROOT, 'test-results', 'real-agent-spawn');

const TASK_NODE_CONTENT = `# please spawn one sonnet and one codex headfull agents each to make a hello world node, and do nothing else
`;

const test = base.extend<{
  fixtureVaultPath: string;
  tempUserDataPath: string;
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  fixtureVaultPath: async ({}, use) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-real-agent-vault-'));
    const vaultPath = path.join(tempRoot, 'test-vault');
    await fs.mkdir(vaultPath, { recursive: true });
    await fs.writeFile(
      path.join(vaultPath, 'task.md'),
      TASK_NODE_CONTENT,
      'utf8',
    );
    await use(vaultPath);
    await fs.rm(tempRoot, { recursive: true, force: true });
  },

  tempUserDataPath: async ({}, use) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-real-agent-udata-'));
    await use(dir);
    await fs.rm(dir, { recursive: true, force: true });
  },

  electronApp: async ({ fixtureVaultPath, tempUserDataPath }, use) => {
    await fs.writeFile(path.join(tempUserDataPath, 'voicetree-config.json'), JSON.stringify({
      vaultConfig: {
        [fixtureVaultPath]: { writePath: fixtureVaultPath, readPaths: [] },
      },
    }, null, 2), 'utf8');

    await fs.writeFile(path.join(tempUserDataPath, 'settings.json'), JSON.stringify({
      agents: [
        { name: 'Claude Sonnet', command: 'CLAUDE_CODE_NO_FLICKER=1 claude --dangerously-skip-permissions --model sonnet "$AGENT_PROMPT"' },
        { name: 'Codex', command: 'codex --yolo "$AGENT_PROMPT"' },
      ],
      defaultAgent: 'Claude Sonnet',
      terminalSpawnPathRelativeToWatchedDirectory: '/',
      INJECT_ENV_VARS: {
        AGENT_PROMPT: `Read the task at $CONTEXT_NODE_PATH and execute it.
You have VoiceTree MCP tools available (spawn_agent, create_graph, list_agents).
Your terminal ID is $VOICETREE_TERMINAL_ID. MCP port: $VOICETREE_MCP_PORT.
DEPTH_BUDGET = $DEPTH_BUDGET`,
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
        VOICETREE_PERSIST_STATE: '1',
        VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
        VT_GRAPHD_BIN: [
          resolveGraphDaemonNodeBin(),
          '--import', path.resolve(WEBAPP_ROOT, '../node_modules/tsx/dist/loader.mjs'),
          path.resolve(WEBAPP_ROOT, '../packages/systems/graph-db-server/bin/vt-graphd.ts'),
        ].join(' '),
      },
      timeout: 60_000,
    });

    const proc = electronApp.process();
    proc?.stdout?.on('data', (c: Buffer) => console.log(`[MAIN] ${c.toString().trim()}`));
    proc?.stderr?.on('data', (c: Buffer) => console.error(`[MAIN ERR] ${c.toString().trim()}`));

    await use(electronApp);

    stopSmokeGraphDaemonForVault(fixtureVaultPath);
    await safeStopFileWatching(electronApp);
    await robustElectronTeardown(electronApp);
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15_000 });
    window.on('console', msg => {
      if (!msg.text().includes('Electron Security Warning'))
        console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });
    window.on('pageerror', err => console.error('PAGE ERROR:', err.message));

    await window.waitForLoadState('domcontentloaded');
    await use(window);
  },
});

async function screenshot(page: Page, name: string): Promise<string> {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath });
  console.log(`📸 ${name}.png`);
  return filePath;
}

async function getAgentCount(mcpUrl: string): Promise<number> {
  const result = await mcpCallTool(mcpUrl, 'list_agents', {});
  const agents = (result.parsed as { agents: Array<{ terminalId: string }> }).agents;
  return agents.length;
}

async function getCytoscapeNodeCount(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    return cy?.nodes().length ?? 0;
  });
}

test.describe('Real agent spawn E2E', () => {
  test('sonnet agent spawns sonnet + codex sub-agents that create hello-world nodes', async ({ appWindow, fixtureVaultPath }) => {
    test.setTimeout(300_000); // 5 min — real agents need time

    // --- MCP setup ---
    const mcpPort: number = await appWindow.evaluate(async () => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getMcpPort();
    });
    const mcpUrl = `http://127.0.0.1:${mcpPort}/mcp`;
    expect(await waitForMcpServer(mcpUrl)).toBe(true);

    await mcpRequest(mcpUrl, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'real-agent-e2e', version: '1.0.0' },
    });

    // Write .mcp.json so spawned Claude agents discover this test's MCP server
    await fs.writeFile(path.join(fixtureVaultPath, '.mcp.json'), JSON.stringify({
      mcpServers: {
        voicetree: { type: 'http', url: `http://127.0.0.1:${mcpPort}/mcp` },
      },
    }, null, 2), 'utf8');
    console.log(`.mcp.json written for port ${mcpPort}`);

    // --- Start file watching explicitly ---
    const watchResult = await appWindow.evaluate(async (vaultPath) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.startFileWatching(vaultPath);
    }, fixtureVaultPath);
    expect(watchResult.success).toBe(true);

    await expect.poll(async () => {
      return await appWindow.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (!api) throw new Error('electronAPI not available');
        const graph = await api.main.getGraph();
        return Object.keys(graph.nodes).length;
      });
    }, {
      message: 'Waiting for graph nodes after file watching start',
      timeout: 15_000,
      intervals: [500, 1000],
    }).toBeGreaterThan(0);

    // --- Bootstrap caller terminal ---
    const callerTerminalId = 'e2e-real-agent-caller';
    const parentNodeId = await appWindow.evaluate(async () => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      const graph = await api.main.getGraph();
      const ids = Object.keys(graph.nodes);
      if (ids.length === 0) throw new Error('No graph nodes');
      return ids[0];
    });

    const callerSpawn = await appWindow.evaluate(async ({ callerTerminalId: cid, parentNodeId: pid }) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api?.terminal) throw new Error('electronAPI.terminal not available');
      return await api.terminal.spawn({
        type: 'Terminal',
        terminalId: cid,
        attachedToContextNodeId: pid,
        terminalCount: 0,
        title: 'E2E Real Agent Caller',
        anchoredToNodeId: { _tag: 'None' },
        shadowNodeDimensions: { width: 600, height: 400 },
        resizable: true,
        initialCommand: 'sleep 300',
        executeCommand: true,
        isPinned: true,
        isDone: false,
        lastOutputTime: Date.now(),
        activityCount: 0,
        parentTerminalId: null,
        agentName: cid,
        worktreeName: undefined,
        isHeadless: false,
      });
    }, { callerTerminalId, parentNodeId });
    expect(callerSpawn.success).toBe(true);

    await expect.poll(async () => {
      const result = await mcpCallTool(mcpUrl, 'list_agents', {});
      const agents = (result.parsed as { agents: Array<{ terminalId: string }> }).agents;
      return agents.some(a => a.terminalId === callerTerminalId);
    }, { message: 'Waiting for caller terminal', timeout: 10_000, intervals: [500, 1000] }).toBe(true);

    // --- Screenshot: initial state ---
    const screenshots: string[] = [];
    screenshots.push(await screenshot(appWindow, '01-initial-state'));

    // --- Spawn real Sonnet agent on task.md ---
    console.log('Spawning real Sonnet agent on task.md...');
    const spawnResult = await mcpCallTool(mcpUrl, 'spawn_agent', {
      nodeId: path.join(fixtureVaultPath, 'task.md'),
      callerTerminalId,
      agentName: 'Claude Sonnet',
      spawnDirectory: fixtureVaultPath,
      depthBudget: 3,
    });
    expect(spawnResult.parsed, `spawn_agent failed: ${JSON.stringify(spawnResult.parsed)}`).toMatchObject({ success: true });

    const rootAgentId = (spawnResult.parsed as { terminalId: string }).terminalId;
    console.log(`Root Sonnet agent spawned: ${rootAgentId}`);
    screenshots.push(await screenshot(appWindow, '02-after-spawn'));

    // --- Assert: at least 3 agents spawn (caller + root + sub-agents) ---
    // Wait 90s first, then dump diagnostics
    await appWindow.waitForTimeout(90_000);

    // Dump root agent terminal output for diagnostics
    const diagFile = path.join(SCREENSHOT_DIR, 'root-agent-output.txt');
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    try {
      const termOut = await mcpCallTool(mcpUrl, 'read_terminal_output', {
        terminalId: rootAgentId,
        callerTerminalId,
      });
      const output = (termOut.parsed as { output?: string })?.output ?? JSON.stringify(termOut.parsed, null, 2);
      await fs.writeFile(diagFile, output, 'utf8');
    } catch (err) {
      await fs.writeFile(diagFile, `read_terminal_output failed: ${err}`, 'utf8');
    }

    // Dump agent list
    const listResult = await mcpCallTool(mcpUrl, 'list_agents', {});
    await fs.writeFile(path.join(SCREENSHOT_DIR, 'agents-at-90s.json'), JSON.stringify(listResult.parsed, null, 2), 'utf8');

    await expect.poll(async () => {
      const result = await mcpCallTool(mcpUrl, 'list_agents', {});
      return (result.parsed as { agents: Array<{ terminalId: string }> }).agents.length;
    }, {
      message: 'Waiting for 3+ agents (root + sub-agents)',
      timeout: 150_000,
      intervals: [10_000, 15_000, 15_000, 15_000],
    }).toBeGreaterThanOrEqual(3);

    screenshots.push(await screenshot(appWindow, '03-agents-spawned'));

    // Fit graph
    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (cy) cy.fit();
    });
    screenshots.push(await screenshot(appWindow, '04-agents-fitted'));

    // --- Capture node count K at this point ---
    const K = await getCytoscapeNodeCount(appWindow);
    console.log(`Node count after agents spawned (K): ${K}`);

    // --- Assert: sub-agents create new nodes (fuzzy: at least 2 more) ---
    console.log(`Polling for at least ${K + 2} nodes (up to 3 min)...`);
    await expect.poll(async () => {
      const count = await getCytoscapeNodeCount(appWindow);
      console.log(`  nodes: ${count} (K=${K}, need >= ${K + 2})`);
      return count;
    }, {
      message: `Waiting for node count to grow by at least 2 from K=${K}`,
      timeout: 180_000,
      intervals: [5_000, 10_000, 10_000, 15_000],
    }).toBeGreaterThanOrEqual(K + 2);

    const finalNodeCount = await getCytoscapeNodeCount(appWindow);
    console.log(`Final node count: ${finalNodeCount} (K was ${K}, delta: +${finalNodeCount - K})`);
    screenshots.push(await screenshot(appWindow, '05-nodes-created'));

    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (cy) cy.fit();
    });
    screenshots.push(await screenshot(appWindow, '06-final-fitted'));

    // --- Assert: all spawned agents exit cleanly ---
    console.log('Polling for all agents to exit (up to 3 min)...');
    await expect.poll(async () => {
      const result = await mcpCallTool(mcpUrl, 'list_agents', {});
      const agents = (result.parsed as { agents: Array<{ terminalId: string; status: string }> }).agents;
      const nonCaller = agents.filter(a => a.terminalId !== callerTerminalId);
      const allExited = nonCaller.every(a => a.status === 'exited');
      console.log(`  agents: ${nonCaller.map(a => `${a.terminalId.slice(-8)}=${a.status}`).join(', ')}`);
      return allExited;
    }, {
      message: 'Waiting for all spawned agents to exit',
      timeout: 180_000,
      intervals: [5_000, 10_000, 10_000, 15_000],
    }).toBe(true);

    const finalResult = await mcpCallTool(mcpUrl, 'list_agents', {});
    const finalAgents = (finalResult.parsed as { agents: Array<{ terminalId: string; exitCode: number | null; status: string }> }).agents;
    for (const agent of finalAgents.filter(a => a.terminalId !== callerTerminalId)) {
      expect(agent.exitCode, `agent ${agent.terminalId} exited with code ${agent.exitCode}`).toBe(0);
    }

    screenshots.push(await screenshot(appWindow, '07-all-exited'));
    console.log('Screenshots:', screenshots);
  });
});

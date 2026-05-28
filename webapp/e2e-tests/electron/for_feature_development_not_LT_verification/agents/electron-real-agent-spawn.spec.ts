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
} from '../../critical_e2e_verification_tests/electron-smoke-helpers';
import {
  getBearerToken,
  getDaemonRpcUrl,
  rpcCallTool,
} from '../../critical_e2e_verification_tests/helpers/e2e-rpc-helpers';

const SCREENSHOT_DIR = path.join(WEBAPP_ROOT, 'test-results', 'real-agent-spawn');

const TASK_NODE_CONTENT = `# E2E real sub-agent orchestration task

Use the VoiceTree MCP spawn_agent tool exactly twice, then stop.

For both spawn_agent calls:
- Use your VOICETREE_TERMINAL_ID value as callerTerminalId.
- Use your TASK_NODE_PATH value as parentNodeId.
- Set headless to false.
- Set depthBudget to 0.
- Do not create the hello-world nodes yourself.

Spawn one child with agentName "Claude Sonnet" and task:
"Create one markdown node titled hello-world using the VoiceTree MCP create_graph tool, with summary and content exactly 'hello world from Claude Sonnet', then exit."

Spawn one child with agentName "Codex" and task:
"Create one markdown node titled hello-world using the VoiceTree MCP create_graph tool, with summary and content exactly 'hello world from Codex', then exit."
`;

const test = base.extend<{
  fixtureVaultPath: string;
  tempUserDataPath: string;
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  fixtureVaultPath: async ({}, use) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-real-agent-vault-'));
    const projectRoot = path.join(tempRoot, 'test-vault');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, 'task.md'),
      TASK_NODE_CONTENT,
      'utf8',
    );
    await use(projectRoot);
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
        [fixtureVaultPath]: { writeFolder: fixtureVaultPath, readPaths: [] },
      },
    }, null, 2), 'utf8');

    await fs.writeFile(path.join(tempUserDataPath, 'settings.json'), JSON.stringify({
      agents: [
        { name: 'Claude Sonnet', command: '/Users/bobbobby/.local/bin/claude --dangerously-skip-permissions --model sonnet -p "$AGENT_PROMPT"; exit' },
        { name: 'Codex', command: '/opt/homebrew/bin/codex exec --dangerously-bypass-approvals-and-sandbox "$AGENT_PROMPT"; exit' },
      ],
      defaultAgent: 'Claude Sonnet',
      terminalSpawnPathRelativeToWatchedDirectory: '/',
      INJECT_ENV_VARS: {
        AGENT_PROMPT: 'Read the task at $CONTEXT_NODE_PATH and execute it exactly. You have VoiceTree MCP tools available as mcp__voicetree__spawn_agent, mcp__voicetree__create_graph, mcp__voicetree__list_agents, and mcp__voicetree__read_terminal_output. When calling spawn_agent, use callerTerminalId=$VOICETREE_TERMINAL_ID and parentNodeId=$TASK_NODE_PATH unless the task says otherwise. Daemon URL: $VOICETREE_DAEMON_URL. DEPTH_BUDGET=$DEPTH_BUDGET. Do not ask for clarification.',
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
        npm_config_prefix: '',
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

async function getCytoscapeNodeCount(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    return cy?.nodes().length ?? 0;
  });
}

test.describe('Real agent spawn E2E', () => {
  test('sonnet agent spawns sonnet + codex sub-agents that create hello-world nodes', async ({ appWindow, fixtureVaultPath }) => {
    test.setTimeout(600_000); // 10 min — real agents need time

    // --- Daemon /rpc discovery ---
    // After the MCP→CLI cutover (2651ade78/fab76e7d4) the unified HTTP daemon
    // serves tool calls as JSON-RPC over POST /rpc, authorised by a bearer
    // token. Renderer accessors mainAPI.getDaemonUrl + mainAPI.getAuthToken are
    // the canonical discovery path; spawned subprocesses use
    // $VOICETREE_DAEMON_URL + $VOICETREE_VAULT_PATH/.voicetree/auth-token.
    const rpcUrl: string = await getDaemonRpcUrl(appWindow);
    const token: string = await getBearerToken(appWindow);

    // --- Start file watching explicitly ---
    const watchResult = await appWindow.evaluate(async (projectRoot) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.startFileWatching(projectRoot);
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
      const result = await rpcCallTool(rpcUrl, token,'list_agents', {});
      const agents = (result.parsed as { agents: Array<{ terminalId: string }> }).agents;
      return agents.some(a => a.terminalId === callerTerminalId);
    }, { message: 'Waiting for caller terminal', timeout: 10_000, intervals: [500, 1000] }).toBe(true);

    // --- Verify HTTP MCP via the production-written .mcp.json URL by writing one
    //     real progress node ourselves. This is the same call path the spawned
    //     external agents will take, exercised explicitly before we burn API credits. ---
    const probeNodeFilename = `e2e-mcp-http-probe-${Date.now()}`;
    const probeResult = await rpcCallTool(rpcUrl, token,'create_graph', {
      callerTerminalId,
      nodes: [{
        filename: probeNodeFilename,
        title: 'E2E MCP HTTP probe',
        summary: 'Written by electron-real-agent-spawn via the URL from .mcp.json to prove the production writer + HTTP MCP path round-trip works.',
      }],
    });
    expect(probeResult.parsed, `create_graph via .mcp.json URL failed: ${JSON.stringify(probeResult.parsed)}`).toMatchObject({ success: true });
    const probeNodePath = path.join(fixtureVaultPath, `${probeNodeFilename}.md`);
    expect(
      await fs.access(probeNodePath).then(() => true).catch(() => false),
      `progress node ${probeNodePath} was not written by create_graph`,
    ).toBe(true);
    console.log(`✓ Progress node written via .mcp.json HTTP MCP path: ${probeNodePath}`);

    // --- Screenshot: initial state ---
    const screenshots: string[] = [];
    screenshots.push(await screenshot(appWindow, '01-initial-state'));

    // --- Spawn real Sonnet agent on task.md ---
    console.log('Spawning real Sonnet agent on task.md...');
    const spawnResult = await rpcCallTool(rpcUrl, token,'spawn_agent', {
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
    await expect.poll(async () => {
      const result = await rpcCallTool(rpcUrl, token,'list_agents', {});
      return (result.parsed as { agents: Array<{ terminalId: string }> }).agents.length;
    }, {
      message: 'Waiting for 3+ agents (root + sub-agents)',
      timeout: 180_000,
      intervals: [5_000, 10_000, 10_000, 15_000],
    }).toBeGreaterThanOrEqual(3);

    // Dump diagnostics after agent count passes
    const diagFile = path.join(SCREENSHOT_DIR, 'root-agent-output.txt');
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    try {
      const termOut = await rpcCallTool(rpcUrl, token,'read_terminal_output', {
        terminalId: rootAgentId,
        callerTerminalId,
      });
      const output = (termOut.parsed as { output?: string })?.output ?? JSON.stringify(termOut.parsed, null, 2);
      await fs.writeFile(diagFile, output, 'utf8');
    } catch (err) {
      await fs.writeFile(diagFile, `read_terminal_output failed: ${err}`, 'utf8');
    }
    const listResult = await rpcCallTool(rpcUrl, token,'list_agents', {});
    await fs.writeFile(path.join(SCREENSHOT_DIR, 'agents-dump.json'), JSON.stringify(listResult.parsed, null, 2), 'utf8');

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

    // --- Assert: sub-agents create new nodes (fuzzy: at least 1 more) ---
    console.log(`Polling for at least ${K + 1} nodes (up to 5 min)...`);
    await expect.poll(async () => {
      const count = await getCytoscapeNodeCount(appWindow);
      console.log(`  nodes: ${count} (K=${K}, need >= ${K + 1})`);
      return count;
    }, {
      message: `Waiting for node count to grow by at least 1 from K=${K}`,
      timeout: 300_000,
      intervals: [5_000, 10_000, 10_000, 15_000],
    }).toBeGreaterThanOrEqual(K + 1);

    const finalNodeCount = await getCytoscapeNodeCount(appWindow);
    console.log(`Final node count: ${finalNodeCount} (K was ${K}, delta: +${finalNodeCount - K})`);
    screenshots.push(await screenshot(appWindow, '05-nodes-created'));

    await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (cy) cy.fit();
    });
    screenshots.push(await screenshot(appWindow, '06-final-fitted'));

    // --- Assert: root agent + at least 1 sub-agent exit cleanly ---
    // Codex can be slow, so only require root + 1 sub-agent to exit (proves full pipeline)
    console.log('Polling for root agent + at least 1 sub-agent to exit...');
    await expect.poll(async () => {
      const result = await rpcCallTool(rpcUrl, token,'list_agents', {});
      const agents = (result.parsed as { agents: Array<{ terminalId: string; status: string; exitCode: number | null }> }).agents;
      const nonCaller = agents.filter(a => a.terminalId !== callerTerminalId);
      const exitedAgents = nonCaller.filter(a => a.status === 'exited');
      console.log(`  exited: ${exitedAgents.length}/${nonCaller.length} — ${nonCaller.map(a => `${a.terminalId.slice(-8)}=${a.status}`).join(', ')}`);
      return exitedAgents.length;
    }, {
      message: 'Waiting for root + at least 1 sub-agent to exit',
      timeout: 300_000,
      intervals: [10_000, 15_000, 15_000, 15_000],
    }).toBeGreaterThanOrEqual(2);

    const finalResult = await rpcCallTool(rpcUrl, token,'list_agents', {});
    const finalAgents = (finalResult.parsed as { agents: Array<{ terminalId: string; exitCode: number | null; status: string }> }).agents;
    const exitedAgents = finalAgents.filter(a => a.terminalId !== callerTerminalId && a.status === 'exited');
    for (const agent of exitedAgents) {
      expect(agent.exitCode, `agent ${agent.terminalId} exited with code ${agent.exitCode}`).toBe(0);
    }

    screenshots.push(await screenshot(appWindow, '07-agents-exited'));
    console.log('Screenshots:', screenshots);
  });
});

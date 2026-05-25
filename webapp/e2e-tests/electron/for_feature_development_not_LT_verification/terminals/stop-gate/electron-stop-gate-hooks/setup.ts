import { spawnSync } from 'node:child_process';
import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

const PROJECT_ROOT = path.resolve(process.cwd());
const REPO_ROOT = path.resolve(PROJECT_ROOT, '..');
const VOICETREE_CLI_PATH = path.join(PROJECT_ROOT, 'src', 'shell', 'edge', 'main', 'cli', 'voicetree-cli.ts');
const STOP_GATE_SCRIPT_SOURCE = path.join(REPO_ROOT, 'brain', 'automation', 'stop-gate-audit.ts');

export const TARGET_NODE_ID = '1_VoiceTree_Website_Development_and_Node_Display_Bug.md';
export const NO_PROGRESS_TASK_NODE_ID = 'e2e-stop-gate-cli-no-progress-task.md';
export const PASS_TASK_NODE_ID = 'e2e-stop-gate-cli-pass-task.md';
export const PASS_PROGRESS_NODE_ID = 'e2e-stop-gate-cli-progress.md';
export const CALLER_TERMINAL_ID = 'e2e-hooks-test-caller';
export const NO_PROGRESS_CALLER_ID = 'e2e-hooks-cli-no-progress-caller';
export const PASS_CALLER_ID = 'e2e-hooks-cli-pass-caller';
export const HOOK_AGENT_NAME = 'Hook Test Agent';
export const TASK_SKILL_PATH = '~/brain/workflows/e2e-stop-gate-cli/SKILL.md';
export const SOFT_WORKFLOW_PATH = '~/brain/workflows/e2e-stop-gate-cli-inline/SKILL.md';

const TASK_SKILL_MARKDOWN = `---
name: e2e-stop-gate-cli
description: "Fixture skill for CLI stop-gate test."
---

# e2e-stop-gate-cli

## Outgoing Workflows
[${SOFT_WORKFLOW_PATH}]
`;

const SOFT_WORKFLOW_MARKDOWN = `---
name: e2e-stop-gate-cli-inline
description: "Fixture inline skill for CLI stop-gate test."
---

# e2e-stop-gate-cli-inline
`;

const TASK_NODE_CONTENT = `---
isContextNode: false
node_id: 100
status: claimed
---

### E2E stop-gate CLI task

This task requires reviewing ${TASK_SKILL_PATH} before stopping.
`;

interface ExtendedWindow {
  cytoscapeInstance?: {
    nodes: () => { length: number };
  };
  electronAPI?: {
    main: {
      stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
      getMcpPort: () => Promise<number>;
      getGraph: () => Promise<{ nodes: Record<string, unknown> }>;
    };
    terminal: {
      spawn: (data: Record<string, unknown>) => Promise<{ success: boolean; terminalId?: string; error?: string }>;
    };
  };
}

export const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  tempUserDataPath: string;
  tempHome: string;
  fixtureVaultPath: string;
}>({
  tempHome: async ({}, use) => {
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-hooks-test-home-'));

    const automationDir = path.join(tempHome, 'brain', 'automation');
    const workflowsDir = path.join(tempHome, 'brain', 'workflows');
    const taskSkillDir = path.join(workflowsDir, 'e2e-stop-gate-cli');
    const softSkillDir = path.join(workflowsDir, 'e2e-stop-gate-cli-inline');

    await fs.mkdir(automationDir, { recursive: true });
    await fs.mkdir(taskSkillDir, { recursive: true });
    await fs.mkdir(softSkillDir, { recursive: true });

    await fs.copyFile(
      STOP_GATE_SCRIPT_SOURCE,
      path.join(automationDir, 'stop-gate-audit.ts')
    );
    await fs.writeFile(
      path.join(automationDir, 'hooks.json'),
      JSON.stringify({
        Stop: [
          { type: 'command', command: 'node --experimental-strip-types ~/brain/automation/stop-gate-audit.ts' },
        ],
      }, null, 2)
    );

    await fs.writeFile(path.join(taskSkillDir, 'SKILL.md'), TASK_SKILL_MARKDOWN);
    await fs.writeFile(path.join(softSkillDir, 'SKILL.md'), SOFT_WORKFLOW_MARKDOWN);

    await use(tempHome);
    await fs.rm(tempHome, { recursive: true, force: true });
  },

  fixtureVaultPath: async ({}, use) => {
    const tempVaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-hooks-test-vault-'));
    const voicetreeDir = path.join(tempVaultPath, 'voicetree');

    await fs.mkdir(voicetreeDir, { recursive: true });
    await fs.writeFile(path.join(voicetreeDir, TARGET_NODE_ID), TASK_NODE_CONTENT);
    await fs.writeFile(path.join(voicetreeDir, NO_PROGRESS_TASK_NODE_ID), TASK_NODE_CONTENT);
    await fs.writeFile(path.join(voicetreeDir, PASS_TASK_NODE_ID), TASK_NODE_CONTENT);

    await use(tempVaultPath);
    await fs.rm(tempVaultPath, { recursive: true, force: true });
  },

  tempUserDataPath: async ({ fixtureVaultPath }, use) => {
    const tempPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-hooks-test-data-'));

    const savedProject = {
      id: 'hooks-test-project',
      path: fixtureVaultPath,
      name: 'hooks-cli-vault',
      type: 'folder',
      lastOpened: Date.now(),
      voicetreeInitialized: true,
    };
    await fs.writeFile(
      path.join(tempPath, 'projects.json'),
      JSON.stringify([savedProject], null, 2)
    );

    await fs.writeFile(
      path.join(tempPath, 'voicetree-config.json'),
      JSON.stringify({ lastDirectory: fixtureVaultPath }, null, 2)
    );

    await fs.writeFile(
      path.join(tempPath, 'settings.json'),
      JSON.stringify({
        agents: [{ name: HOOK_AGENT_NAME, command: 'echo done' }],
        terminalSpawnPathRelativeToWatchedDirectory: '/',
      }, null, 2)
    );

    await use(tempPath);
    await fs.rm(tempPath, { recursive: true, force: true });
  },

  electronApp: async ({ tempUserDataPath, tempHome }, use) => {
    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`
      ],
      env: {
        ...process.env,
        HOME: tempHome,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1'
      },
      timeout: 15000
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

    try {
      await window.waitForFunction(
        () => (window as unknown as ExtendedWindow).cytoscapeInstance,
        { timeout: 5000 }
      );
      console.log('[Hooks Test] Cytoscape initialized via auto-load');
    } catch {
      console.log('[Hooks Test] Auto-load timed out, clicking project...');
      const projectButton = window.locator('button').filter({ hasText: 'hooks-cli-vault' });
      await expect(projectButton.first()).toBeVisible({ timeout: 10000 });
      await projectButton.first().click();
      await window.waitForFunction(
        () => (window as unknown as ExtendedWindow).cytoscapeInstance,
        { timeout: 30000 }
      );
      console.log('[Hooks Test] Cytoscape initialized after project selection');
    }

    await window.waitForTimeout(1000);
    await use(window);
  }
});

type CliPayload = Record<string, unknown>;

type CliResult<T = CliPayload> = {
  status: number;
  payload?: T;
  stdout: string;
  stderr: string;
};

export function runCliCommand<T = CliPayload>(mcpPort: number, args: string[], terminalId?: string): CliResult<T> {
  const cliArgs = [
    '--experimental-strip-types',
    VOICETREE_CLI_PATH,
    '--json',
    '--port',
    String(mcpPort),
    ...(terminalId ? ['--terminal', terminalId] : []),
    ...args
  ];

  const result = spawnSync(process.execPath, cliArgs, {
    cwd: PROJECT_ROOT,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
  });

  if (result.error) {
    throw result.error;
  }

  const stdout = (result.stdout ?? '').toString().trim();
  const stderr = (result.stderr ?? '').toString().trim();

  let payload: T | undefined;
  if (stdout) {
    payload = JSON.parse(stdout) as T;
  }

  return {
    status: result.status ?? 0,
    payload,
    stdout,
    stderr,
  };
}

export async function waitForCliReady(mcpPort: number, terminalId?: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = runCliCommand(mcpPort, ['agent', 'list'], terminalId);
    if (result.status === 0 && result.payload && (result.payload as { success?: boolean }).success) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error('voicetree CLI did not become available via HTTP transport');
}

export async function getMcpPort(appWindow: Page): Promise<number> {
  return appWindow.evaluate(async () => {
    const api = (window as unknown as ExtendedWindow).electronAPI;
    if (!api) {
      throw new Error('electronAPI not available');
    }

    return await api.main.getMcpPort();
  });
}

export async function waitForGraphNodes(appWindow: Page): Promise<void> {
  await expect.poll(async () => {
    return appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      return cy ? cy.nodes().length : 0;
    });
  }, {
    message: 'Waiting for graph nodes to load',
    timeout: 15000,
    intervals: [500, 1000, 1000],
  }).toBeGreaterThan(0);
}

export async function resolveNodeId(appWindow: Page, nodeFileName: string): Promise<string> {
  const nodeIds = await appWindow.evaluate(async () => {
    const api = (window as unknown as ExtendedWindow).electronAPI;
    if (!api) {
      throw new Error('electronAPI not available');
    }

    const graph = await api.main.getGraph();
    return Object.keys(graph.nodes);
  });

  const nodeId = nodeIds.find((candidate: string) =>
    candidate.endsWith(`/${nodeFileName}`) || candidate.includes(nodeFileName)
  );

  if (!nodeId) {
    throw new Error(`Could not locate node in graph: ${nodeFileName}`);
  }

  return nodeId;
}

export async function registerCallerTerminal(
  appWindow: Page,
  nodeId: string,
  callerId: string,
): Promise<void> {
  const callerSpawnResult = await appWindow.evaluate(async ({ nodeId: attachedNodeId, callerId: terminalId }) => {
    const api = (window as unknown as ExtendedWindow).electronAPI;
    if (!api?.terminal) {
      throw new Error('electronAPI.terminal not available');
    }

    return await api.terminal.spawn({
      type: 'Terminal',
      terminalId,
      attachedToContextNodeId: attachedNodeId,
      terminalCount: 0,
      title: 'E2E Hooks Test Caller',
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
      agentName: callerId,
      worktreeName: undefined,
      isHeadless: false
    });
  }, { nodeId, callerId });

  expect(callerSpawnResult.success).toBe(true);
  await appWindow.waitForTimeout(500);
}

export async function createProgressNode(
  projectRoot: string,
  nodeName: string,
  agentName: string,
  mentions: string[],
): Promise<void> {
  await fs.writeFile(
    path.join(projectRoot, 'voicetree', nodeName),
    [
      '---',
      `agent_name: ${agentName}`,
      '---',
      '',
      '# Progress',
      '',
      ...mentions,
      '',
    ].join('\n')
  );
}

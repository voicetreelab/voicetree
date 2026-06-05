/**
 * E2E Test: Stop Gate Hook Runner Full Flow (BF-047)
 *
 * Tests the stop-gate hook pipeline via the VoiceTree CLI:
 * 1. Agent close is blocked when stop-gate obligations are unmet.
 * 2. Agent close passes when obligations are satisfied.
 * 3. list_agents exposes parentTerminalId and taskNodePath.
 *
 * Test Setup: Temporary HOME overrides hooks.json + automation script + workflow SKILL.md
 * references for each run. Projects are loaded from a temporary fixture project.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import {
  createProgressNode,
  getDaemonPort,
  registerCallerTerminal,
  resolveNodeId,
  runCliCommand as runCliCommandRaw,
  waitForCliReady as waitForCliReadyRaw,
} from './stop-gate-hooks-helpers';
import type { CliPayload, CliResult } from './stop-gate-hooks-helpers';

function runCliCommand<T = CliPayload>(daemonPort: number, args: string[], terminalId?: string): CliResult<T> {
  return runCliCommandRaw<T>(VOICETREE_CLI_PATH, PROJECT_ROOT, daemonPort, args, terminalId);
}

// Narrow a spawn payload's optional terminalId to the string the test relies on,
// failing loudly (with the same assertion intent) when the spawn produced none.
function requireTerminalId(payload: { terminalId?: string } | undefined): string {
  const terminalId = payload?.terminalId;
  if (!terminalId) {
    throw new Error('spawn payload should include terminalId');
  }
  return terminalId;
}

async function waitForCliReady(daemonPort: number, terminalId?: string): Promise<void> {
  return waitForCliReadyRaw(VOICETREE_CLI_PATH, PROJECT_ROOT, daemonPort, terminalId);
}

const PROJECT_ROOT = path.resolve(process.cwd());
const VOICETREE_CLI_PATH = path.join(PROJECT_ROOT, 'src', 'shell', 'edge', 'main', 'cli', 'voicetree-cli.ts');
// brain is no longer vendored under the repo; it lives at the canonical ~/brain.
// The stop-gate audit script moved under self-improvement-system/ in the brain restructure.
const STOP_GATE_SCRIPT_SOURCE = path.join(os.homedir(), 'brain', 'self-improvement-system', 'automation', 'stop-gate-audit.ts');
const TARGET_NODE_ID = '1_VoiceTree_Website_Development_and_Node_Display_Bug.md';
const NO_PROGRESS_TASK_NODE_ID = 'e2e-stop-gate-cli-no-progress-task.md';
const PASS_TASK_NODE_ID = 'e2e-stop-gate-cli-pass-task.md';
const PASS_PROGRESS_NODE_ID = 'e2e-stop-gate-cli-progress.md';
const CALLER_TERMINAL_ID = 'e2e-hooks-test-caller';
const NO_PROGRESS_CALLER_ID = 'e2e-hooks-cli-no-progress-caller';
const PASS_CALLER_ID = 'e2e-hooks-cli-pass-caller';
const HOOK_AGENT_NAME = 'Hook Test Agent';
const TASK_SKILL_PATH = '~/brain/workflows/e2e-stop-gate-cli/SKILL.md';
const SOFT_WORKFLOW_PATH = '~/brain/workflows/e2e-stop-gate-cli-inline/SKILL.md';
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
  hostAPI?: {
    main: {
      stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
      getDaemonUrl: () => Promise<string>;
      getGraph: () => Promise<{ nodes: Record<string, unknown> }>;
    };
    terminal: {
      spawn: (data: Record<string, unknown>) => Promise<{ success: boolean; terminalId?: string; error?: string }>;
    };
  };
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  tempUserDataPath: string;
  tempHome: string;
  fixtureProjectPath: string;
}>({
  tempHome: async ({}, use) => {
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-hooks-test-home-'));

    // HOME-mounted automation stack for this app instance:
    // - stop-gate-audit.ts command hook
    // - command hooks config (Stop: [{ type: 'command', ... }])
    // - workflow SKILL.md fixtures used by the audit
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

  fixtureProjectPath: async ({}, use) => {
    const tempProjectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-hooks-test-project-'));
    const voicetreeDir = path.join(tempProjectPath, 'voicetree');

    await fs.mkdir(voicetreeDir, { recursive: true });
    await fs.writeFile(path.join(voicetreeDir, TARGET_NODE_ID), TASK_NODE_CONTENT);
    await fs.writeFile(path.join(voicetreeDir, NO_PROGRESS_TASK_NODE_ID), TASK_NODE_CONTENT);
    await fs.writeFile(path.join(voicetreeDir, PASS_TASK_NODE_ID), TASK_NODE_CONTENT);

    await use(tempProjectPath);
    await fs.rm(tempProjectPath, { recursive: true, force: true });
  },

  tempUserDataPath: async ({fixtureProjectPath}, use) => {
    const tempPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-hooks-test-data-'));

    const savedProject = {
      id: 'hooks-test-project',
      path: fixtureProjectPath,
      name: 'hooks-cli-project',
      type: 'folder',
      lastOpened: Date.now(),
    };
    await fs.writeFile(
      path.join(tempPath, 'projects.json'),
      JSON.stringify([savedProject], null, 2)
    );

    await fs.writeFile(
      path.join(tempPath, 'voicetree-config.json'),
      JSON.stringify({ lastDirectory: fixtureProjectPath }, null, 2)
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
        const api = (window as unknown as ExtendedWindow).hostAPI;
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

    // Wait for Cytoscape (graph loaded via auto-project-load)
    try {
      await window.waitForFunction(
        () => (window as unknown as ExtendedWindow).cytoscapeInstance,
        { timeout: 5000 }
      );
      console.log('[Hooks Test] Cytoscape initialized via auto-load');
    } catch {
      console.log('[Hooks Test] Auto-load timed out, clicking project...');
      const projectButton = window.locator('button').filter({ hasText: 'hooks-cli-project' });
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

test.describe('Stop Gate Hook Runner E2E (BF-047)', () => {
  test.describe.configure({ mode: 'serial', timeout: 120000 });

  test('CLI self-close blocks when no progress node exists', async ({ appWindow }) => {
    const daemonPort = await getDaemonPort(appWindow);
    await waitForCliReady(daemonPort);

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

    const taskNodeId = await resolveNodeId(appWindow, NO_PROGRESS_TASK_NODE_ID);
    await registerCallerTerminal(appWindow, taskNodeId, NO_PROGRESS_CALLER_ID);

    const spawnResult = runCliCommand<{ success: boolean; terminalId: string; error?: string }>(
      daemonPort,
      ['agent', 'spawn', '--task', 'CLI no-progress stop-gate audit test', '--parent', taskNodeId],
      NO_PROGRESS_CALLER_ID
    );

    expect(spawnResult.status, `CLI spawn failed: ${spawnResult.stderr}`).toBe(0);
    const spawnPayload = spawnResult.payload;
    expect(spawnPayload?.success, `spawn payload: ${spawnResult.stdout}`).toBe(true);
    const spawnedAgentId = requireTerminalId(spawnPayload);

    const closeResult = runCliCommand<{ success: boolean; error?: string }>(
      daemonPort,
      ['agent', 'close', spawnedAgentId],
      spawnedAgentId
    );

    const closePayload = closeResult.payload;
    expect(closePayload?.success).toBe(false);
    expect(closePayload?.error ?? '').toContain('STOP GATE AUDIT FAILED');
    expect(closePayload?.error ?? '').toContain('No progress nodes created');
  });

  test('CLI self-close passes when stop-gate obligations are satisfied', async ({ appWindow, fixtureProjectPath }) => {
    const daemonPort = await getDaemonPort(appWindow);
    await waitForCliReady(daemonPort);

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

    const taskNodeId = await resolveNodeId(appWindow, PASS_TASK_NODE_ID);
    await registerCallerTerminal(appWindow, taskNodeId, PASS_CALLER_ID);

    const spawnResult = runCliCommand<{ success: boolean; terminalId: string; error?: string }>(
      daemonPort,
      ['agent', 'spawn', '--task', 'CLI pass stop-gate audit test', '--parent', taskNodeId],
      PASS_CALLER_ID
    );

    expect(spawnResult.status, `CLI spawn failed: ${spawnResult.stderr}`).toBe(0);
    const spawnPayload = spawnResult.payload;
    expect(spawnPayload?.success, `spawn payload: ${spawnResult.stdout}`).toBe(true);
    const spawnedAgentId = requireTerminalId(spawnPayload);

    await createProgressNode(
      fixtureProjectPath,
      PASS_PROGRESS_NODE_ID,
      HOOK_AGENT_NAME,
      [
        `I reviewed ${TASK_SKILL_PATH} and ${SOFT_WORKFLOW_PATH} in this stop-gate task.`,
      ]
    );

    const closeResult = runCliCommand<{ success: boolean; message?: string; error?: string }>(
      daemonPort,
      ['agent', 'close', spawnedAgentId],
      spawnedAgentId
    );

    const closePayload = closeResult.payload;
    expect(closePayload?.success).toBe(true);
  });

  test('list_agents exposes parentTerminalId and taskNodePath', async ({ appWindow }) => {
    const daemonPort = await getDaemonPort(appWindow);
    await waitForCliReady(daemonPort);

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

    const targetNodeId = await resolveNodeId(appWindow, TARGET_NODE_ID);
    await registerCallerTerminal(appWindow, targetNodeId, CALLER_TERMINAL_ID);

    const spawnResult = runCliCommand<{ success: boolean; terminalId: string; error?: string; }>(
      daemonPort,
      ['agent', 'spawn', '--node', targetNodeId],
      CALLER_TERMINAL_ID
    );

    expect(spawnResult.payload?.success).toBe(true);
    const spawnedAgentId = requireTerminalId(spawnResult.payload);

    let agent: {
      terminalId: string;
      parentTerminalId: string | null;
      taskNodePath: string | null;
      status: string;
    } | undefined;

    await expect.poll(async () => {
      const listResult = runCliCommand<{
        success: boolean;
        agents: Array<{
          terminalId: string;
          parentTerminalId: string | null;
          taskNodePath: string | null;
          status: string;
        }>;
      }>(daemonPort, ['agent', 'list']);
      const agents = listResult.payload?.agents;
      if (!agents) {
        return undefined;
      }

      agent = agents.find(entry => entry.terminalId === spawnedAgentId);
      return agent?.terminalId;
    }, {
      message: 'Waiting for spawned agent to appear in list_agents',
      timeout: 10000,
      intervals: [250, 500, 1000],
    }).toBeTruthy();

    expect(agent).toBeDefined();
    expect(agent!.parentTerminalId).toBe(CALLER_TERMINAL_ID);
    expect(agent!.taskNodePath).toBeTruthy();
    expect(agent!.taskNodePath).toContain(TARGET_NODE_ID);
  });
});

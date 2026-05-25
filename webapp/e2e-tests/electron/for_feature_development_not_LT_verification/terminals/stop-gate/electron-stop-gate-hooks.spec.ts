/**
 * E2E Test: Stop Gate Hook Runner Full Flow (BF-047)
 *
 * Tests the stop-gate hook pipeline via the VoiceTree CLI:
 * 1. Agent close is blocked when stop-gate obligations are unmet.
 * 2. Agent close passes when obligations are satisfied.
 * 3. list_agents exposes parentTerminalId and taskNodePath.
 *
 * Test Setup: Temporary HOME overrides hooks.json + automation script + workflow SKILL.md
 * references for each run. Projects are loaded from a temporary fixture vault.
 */

import { expect } from '@playwright/test';
import {
  CALLER_TERMINAL_ID,
  HOOK_AGENT_NAME,
  NO_PROGRESS_CALLER_ID,
  NO_PROGRESS_TASK_NODE_ID,
  PASS_CALLER_ID,
  PASS_PROGRESS_NODE_ID,
  PASS_TASK_NODE_ID,
  SOFT_WORKFLOW_PATH,
  TARGET_NODE_ID,
  TASK_SKILL_PATH,
  createProgressNode,
  getMcpPort,
  registerCallerTerminal,
  resolveNodeId,
  runCliCommand,
  test,
  waitForCliReady,
  waitForGraphNodes,
} from './electron-stop-gate-hooks/setup';

test.describe('Stop Gate Hook Runner E2E (BF-047)', () => {
  test.describe.configure({ mode: 'serial', timeout: 120000 });

  test('CLI self-close blocks when no progress node exists', async ({ appWindow }) => {
    const mcpPort = await getMcpPort(appWindow);
    await waitForCliReady(mcpPort);

    await waitForGraphNodes(appWindow);

    const taskNodeId = await resolveNodeId(appWindow, NO_PROGRESS_TASK_NODE_ID);
    await registerCallerTerminal(appWindow, taskNodeId, NO_PROGRESS_CALLER_ID);

    const spawnResult = runCliCommand<{ success: boolean; terminalId: string; error?: string }>(
      mcpPort,
      ['agent', 'spawn', '--task', 'CLI no-progress stop-gate audit test', '--parent', taskNodeId],
      NO_PROGRESS_CALLER_ID
    );

    expect(spawnResult.status, `CLI spawn failed: ${spawnResult.stderr}`).toBe(0);
    const spawnPayload = spawnResult.payload;
    expect(spawnPayload?.success, `spawn payload: ${spawnResult.stdout}`).toBe(true);
    const spawnedAgentId = spawnPayload?.terminalId;
    expect(spawnedAgentId, 'spawn payload should include terminalId').toBeTruthy();

    const closeResult = runCliCommand<{ success: boolean; error?: string }>(
      mcpPort,
      ['agent', 'close', spawnedAgentId],
      spawnedAgentId
    );

    const closePayload = closeResult.payload;
    expect(closePayload?.success).toBe(false);
    expect(closePayload?.error ?? '').toContain('STOP GATE AUDIT FAILED');
    expect(closePayload?.error ?? '').toContain('No progress nodes created');
  });

  test('CLI self-close passes when stop-gate obligations are satisfied', async ({ appWindow, fixtureVaultPath }) => {
    const mcpPort = await getMcpPort(appWindow);
    await waitForCliReady(mcpPort);

    await waitForGraphNodes(appWindow);

    const taskNodeId = await resolveNodeId(appWindow, PASS_TASK_NODE_ID);
    await registerCallerTerminal(appWindow, taskNodeId, PASS_CALLER_ID);

    const spawnResult = runCliCommand<{ success: boolean; terminalId: string; error?: string }>(
      mcpPort,
      ['agent', 'spawn', '--task', 'CLI pass stop-gate audit test', '--parent', taskNodeId],
      PASS_CALLER_ID
    );

    expect(spawnResult.status, `CLI spawn failed: ${spawnResult.stderr}`).toBe(0);
    const spawnPayload = spawnResult.payload;
    expect(spawnPayload?.success, `spawn payload: ${spawnResult.stdout}`).toBe(true);
    const spawnedAgentId = spawnPayload?.terminalId;
    expect(spawnedAgentId, 'spawn payload should include terminalId').toBeTruthy();

    await createProgressNode(
      fixtureVaultPath,
      PASS_PROGRESS_NODE_ID,
      HOOK_AGENT_NAME,
      [
        `I reviewed ${TASK_SKILL_PATH} and ${SOFT_WORKFLOW_PATH} in this stop-gate task.`,
      ]
    );

    const closeResult = runCliCommand<{ success: boolean; message?: string; error?: string }>(
      mcpPort,
      ['agent', 'close', spawnedAgentId],
      spawnedAgentId
    );

    const closePayload = closeResult.payload;
    expect(closePayload?.success).toBe(true);
  });

  test('list_agents exposes parentTerminalId and taskNodePath', async ({ appWindow }) => {
    const mcpPort = await getMcpPort(appWindow);
    await waitForCliReady(mcpPort);

    await waitForGraphNodes(appWindow);

    const targetNodeId = await resolveNodeId(appWindow, TARGET_NODE_ID);
    await registerCallerTerminal(appWindow, targetNodeId, CALLER_TERMINAL_ID);

    const spawnResult = runCliCommand<{ success: boolean; terminalId: string; error?: string; }>(
      mcpPort,
      ['agent', 'spawn', '--node', targetNodeId],
      CALLER_TERMINAL_ID
    );

    const spawnedAgentId = spawnResult.payload?.terminalId;
    expect(spawnResult.payload?.success).toBe(true);
    expect(spawnedAgentId, 'spawn payload should include terminalId').toBeTruthy();

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
      }>(mcpPort, ['agent', 'list']);
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

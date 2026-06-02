// Test-side helpers for electron-stop-gate-hooks.spec.ts. Extracted to keep the
// spec file under the 500-line cap. Each export is a deep function over inputs:
// the spec stays a flat sequence of assertions on observable results.

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

type AppWindowApi = {
  hostAPI?: {
    main: {
      getDaemonUrl: () => Promise<string>;
      getGraph: () => Promise<{ nodes: Record<string, unknown> }>;
    };
    terminal: {
      spawn: (data: Record<string, unknown>) => Promise<{ success: boolean; terminalId?: string; error?: string }>;
    };
  };
};

export type CliPayload = Record<string, unknown>;

export type CliResult<T = CliPayload> = {
  status: number;
  payload?: T;
  stdout: string;
  stderr: string;
};

export function runCliCommand<T = CliPayload>(
  cliPath: string,
  projectRoot: string,
  daemonPort: number,
  args: string[],
  terminalId?: string,
): CliResult<T> {
  const cliArgs = [
    '--experimental-strip-types',
    cliPath,
    '--json',
    '--port',
    String(daemonPort),
    ...(terminalId ? ['--terminal', terminalId] : []),
    ...args,
  ];

  const result = spawnSync(process.execPath, cliArgs, {
    cwd: projectRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
  });

  if (result.error) throw result.error;

  const stdout = (result.stdout ?? '').toString().trim();
  const stderr = (result.stderr ?? '').toString().trim();

  let payload: T | undefined;
  if (stdout) payload = JSON.parse(stdout) as T;

  return { status: result.status ?? 0, payload, stdout, stderr };
}

export async function waitForCliReady(
  cliPath: string,
  projectRoot: string,
  daemonPort: number,
  terminalId?: string,
): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = runCliCommand(cliPath, projectRoot, daemonPort, ['agent', 'list'], terminalId);
    if (result.status === 0 && result.payload && (result.payload as { success?: boolean }).success) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('voicetree CLI did not become available via HTTP transport');
}

export async function getDaemonPort(appWindow: Page): Promise<number> {
  const daemonUrl: string = await appWindow.evaluate(async () => {
    const api = (window as unknown as AppWindowApi).hostAPI;
    if (!api) throw new Error('hostAPI not available');
    return await api.main.getDaemonUrl();
  });
  const parsed: URL = new URL(daemonUrl);
  const port: number = parseInt(parsed.port, 10);
  if (!Number.isFinite(port)) {
    throw new Error(`Could not extract port from daemon URL: ${daemonUrl}`);
  }
  return port;
}

export async function resolveNodeId(appWindow: Page, nodeFileName: string): Promise<string> {
  const nodeIds = await appWindow.evaluate(async () => {
    const api = (window as unknown as AppWindowApi).hostAPI;
    if (!api) throw new Error('hostAPI not available');
    const graph = await api.main.getGraph();
    return Object.keys(graph.nodes);
  });

  const nodeId = nodeIds.find(
    (candidate: string) => candidate.endsWith(`/${nodeFileName}`) || candidate.includes(nodeFileName),
  );
  if (!nodeId) throw new Error(`Could not locate node in graph: ${nodeFileName}`);
  return nodeId;
}

export async function registerCallerTerminal(
  appWindow: Page,
  nodeId: string,
  callerId: string,
): Promise<void> {
  const callerSpawnResult = await appWindow.evaluate(
    async ({ nodeId: attachedNodeId, callerId: terminalId }) => {
      const api = (window as unknown as AppWindowApi).hostAPI;
      if (!api?.terminal) throw new Error('hostAPI.terminal not available');
      return api.terminal.spawn({
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
        isHeadless: false,
      });
    },
    { nodeId, callerId },
  );
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
    ].join('\n'),
  );
}

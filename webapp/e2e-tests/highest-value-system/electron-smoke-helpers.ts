import { expect } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

export const WEBAPP_ROOT = path.resolve(process.cwd());
export const REPO_ROOT = path.resolve(WEBAPP_ROOT, '..');
export const FAKE_AGENT_ENTRYPOINT = path.join(REPO_ROOT, 'tools', 'vt-fake-agent', 'dist', 'index.js');

export type ElectronDiagnostics = {
  mainOutput: string[];
  rendererErrors: string[];
};

export type McpToolResult = {
  success: boolean;
  parsed?: Record<string, unknown>;
  isError?: boolean;
};

export type SmokeElectronAPI = Omit<ElectronAPI, 'terminal'> & {
  terminal: {
    spawn: (data: Record<string, unknown>) => Promise<{ success: boolean; terminalId?: string; error?: string }>;
    kill: (terminalId: string) => Promise<{ success: boolean; error?: string }>;
  };
};

export interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: SmokeElectronAPI;
}

function canLoadNativeGraphDbModules(nodeBin: string): boolean {
  try {
    execFileSync(nodeBin, ['-e', "const { DatabaseSync } = require('node:sqlite'); new DatabaseSync(':memory:').close()"], {
      cwd: REPO_ROOT,
      stdio: 'ignore'
    });
    return true;
  } catch {
    return false;
  }
}

export function resolveGraphDaemonNodeBin(): string {
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

export function stopSmokeGraphDaemonForVault(vaultPath: string): void {
  try {
    execFileSync('pkill', ['-f', `vt-graphd\\.ts --vault ${escapeProcessPattern(vaultPath)}`], {
      stdio: 'ignore'
    });
  } catch {
    // No matching smoke daemon is fine.
  }
}

export async function waitForMcpServer(mcpUrl: string, maxRetries = 20, delayMs = 1000): Promise<boolean> {
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

export async function mcpRequest(mcpUrl: string, method: string, params: Record<string, unknown> = {}, id = 1): Promise<unknown> {
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

export async function mcpCallTool(mcpUrl: string, toolName: string, args: Record<string, unknown>): Promise<McpToolResult> {
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

export function expectNoCriticalElectronErrors(diagnostics: ElectronDiagnostics): void {
  const criticalErrorPatterns = [
    /NODE_MODULE_VERSION/i,
    /was compiled against a different Node\.js version/i,
    /DaemonLaunchTimeout/i,
    /ERR_DLOPEN_FAILED/i,
    /Error invoking remote method/i,
    /An object could not be cloned/i,
    /\[spawnTerminalWithContextNode\] async spawn failed/i,
    /\[fake-agent\] Fatal:/i,
    /ERR_MODULE_NOT_FOUND/i,
    /is not a function or its return value is not iterable/i
  ];
  const criticalErrors = [...diagnostics.mainOutput, ...diagnostics.rendererErrors]
    .filter(line => criticalErrorPatterns.some(pattern => pattern.test(line)));

  expect(criticalErrors).toEqual([]);
}

// Renderer-side discovery + JSON-RPC client for the unified HTTP daemon.
//
// All e2e specs that previously spoke the deleted HTTP MCP transport route
// through these helpers. URL discovery uses mainAPI.getDaemonUrl; the bearer
// token is read from the on-disk auth-token file under the active vault
// (BF-368 removed the renderer-callable getAuthToken — Main owns all
// WebSockets, and the renderer no longer holds the token). Out-of-process
// consumers (CLI, hook subprocesses, spawned agents) discover the token the
// same way. Wire shape is JSON-RPC 2.0 over POST /rpc with `Authorization:
// Bearer ${token}`. See packages/systems/vt-daemon/src/transport/httpServer.ts.

import type { Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

type DaemonAccess = {
  main: {
    getDaemonUrl: () => Promise<string>;
    getWatchStatus: () => Promise<{ isWatching: boolean; directory?: string }>;
  };
};

type RpcResponse = {
  result?: { content?: Array<{ type: string; text: string }>; isError?: boolean };
  error?: { code?: number; message: string };
};

export type RpcToolResult = {
  readonly success: boolean;
  readonly parsed?: Record<string, unknown>;
  readonly isError?: boolean;
};

export async function getDaemonRpcUrl(appWindow: Page): Promise<string> {
  const daemonUrl: string = await appWindow.evaluate(
    async (): Promise<string> => {
      const api = (window as unknown as { electronAPI?: DaemonAccess }).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return api.main.getDaemonUrl();
    }
  );
  return `${daemonUrl.replace(/\/+$/, '')}/rpc`;
}

export async function getBearerToken(appWindow: Page): Promise<string> {
  // BF-368 removed the renderer-callable getAuthToken. The active vault's
  // root path is reachable via getWatchStatus().directory; the daemon writes
  // its bearer token to `<vault>/.voicetree/auth-token` (out-of-process
  // consumers — CLI, hooks, spawned agents — read it the same way).
  const vaultRoot: string = await appWindow.evaluate(
    async (): Promise<string> => {
      const api = (window as unknown as { electronAPI?: DaemonAccess }).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      const status = await api.main.getWatchStatus();
      if (!status.directory) throw new Error('e2e: no active vault — call startFileWatching before getBearerToken');
      return status.directory;
    }
  );
  const tokenPath: string = path.join(vaultRoot, '.voicetree', 'auth-token');
  const raw: string = await fs.readFile(tokenPath, 'utf-8');
  return raw.trim();
}

async function rpc(rpcUrl: string, token: string, method: string, params: Record<string, unknown>): Promise<RpcResponse> {
  const response: Response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: randomUUID(),
      method,
      params,
    }),
  });
  return await response.json() as RpcResponse;
}

export async function rpcListTools(rpcUrl: string, token: string): Promise<unknown> {
  const result: RpcResponse = await rpc(rpcUrl, token, 'tools/list', {});
  if (result.error) throw new Error(`JSON-RPC error: ${result.error.message}`);
  return result.result;
}

export async function rpcCallTool(
  rpcUrl: string,
  token: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<RpcToolResult> {
  const response: RpcResponse = await rpc(rpcUrl, token, 'tools/call', {
    name: toolName,
    arguments: args,
  });
  if (response.error) throw new Error(`JSON-RPC error: ${response.error.message}`);
  const text: string | undefined = response.result?.content?.[0]?.text;
  const parsed: Record<string, unknown> | undefined = text
    ? JSON.parse(text) as Record<string, unknown>
    : undefined;
  return {
    success: parsed?.success === true,
    parsed,
    isError: response.result?.isError,
  };
}

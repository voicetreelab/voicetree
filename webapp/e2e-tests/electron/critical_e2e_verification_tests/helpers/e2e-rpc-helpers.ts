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
  result?: unknown;
  error?: { code?: number; message: string; data?: unknown };
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

// Post-BF-376, the unified HTTP daemon's RPC catalog dispatches by tool name
// directly (see packages/systems/vt-daemon/src/transport/rpcDispatch.ts —
// `catalog.get(method)`), without the MCP `tools/call` wrapping. The catalog
// handler returns either the MCP-style `{ content: [{ type, text }] }` shape
// (when the tool is reused for an MCP transport) or a plain JSON object. We
// normalise both shapes to `{ success, parsed, isError }`.
type McpStyleResult = {
  readonly content?: ReadonlyArray<{ readonly type: string; readonly text: string }>;
  readonly isError?: boolean;
};

function normaliseRpcResult(raw: unknown): RpcToolResult {
  if (raw && typeof raw === 'object' && 'content' in raw) {
    const mcp: McpStyleResult = raw as McpStyleResult;
    const text: string | undefined = mcp.content?.[0]?.text;
    const parsed: Record<string, unknown> | undefined = text
      ? JSON.parse(text) as Record<string, unknown>
      : undefined;
    return {
      success: parsed?.success === true || (mcp.isError !== true && parsed === undefined),
      parsed,
      isError: mcp.isError,
    };
  }
  const parsed: Record<string, unknown> | undefined = raw && typeof raw === 'object'
    ? raw as Record<string, unknown>
    : undefined;
  return {
    success: parsed?.success === true || (parsed !== undefined && !('success' in parsed)),
    parsed,
  };
}

export async function rpcCallTool(
  rpcUrl: string,
  token: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<RpcToolResult> {
  const response: RpcResponse = await rpc(rpcUrl, token, toolName, args);
  if (response.error) {
    // The dispatcher returns `tool_handler_failed` with the unwrapped payload
    // in `error.data` when the tool ran but reported an error. Surface that
    // payload so callers see the actual cause (not just the generic envelope
    // message). See packages/systems/vt-daemon/src/transport/rpcDispatch.ts.
    const detail: string = response.error.data !== undefined
      ? `: ${JSON.stringify(response.error.data)}`
      : '';
    throw new Error(`JSON-RPC error (${toolName}): ${response.error.message}${detail}`);
  }
  return normaliseRpcResult(response.result);
}

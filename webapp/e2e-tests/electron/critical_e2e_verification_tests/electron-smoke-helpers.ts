import { expect } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";
import { existsSync } from "fs";
import type { Core as CytoscapeCore } from "cytoscape";
import type { ElectronAPI } from "@/shell/electron";

export const WEBAPP_ROOT = path.resolve(process.cwd());
export const REPO_ROOT = path.resolve(WEBAPP_ROOT, "..");
export const FAKE_AGENT_ENTRYPOINT = path.join(
  REPO_ROOT,
  "tools",
  "vt-fake-agent",
  "dist",
  "index.js",
);

export type ElectronDiagnostics = {
  mainOutput: string[];
  rendererErrors: string[];
};

export type McpToolResult = {
  success: boolean;
  parsed?: Record<string, unknown>;
  isError?: boolean;
};

export type SmokeElectronAPI = Omit<ElectronAPI, "terminal"> & {
  terminal: {
    spawn: (
      data: Record<string, unknown>,
    ) => Promise<{ success: boolean; terminalId?: string; error?: string }>;
  };
};

export interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: SmokeElectronAPI;
}

export function resolveTmuxSessionNameForTest(terminalId: string): string {
  const matches = resolveTmuxSessionNamesForTest(terminalId);
  return matches.at(-1) ?? terminalId;
}

export function resolveTmuxSessionNamesForTest(terminalId: string): string[] {
  try {
    const sessions = execFileSync("tmux", ["list-sessions", "-F", "#S"], {
      encoding: "utf8",
    })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return sessions.filter(
      (session) => session === terminalId || session.endsWith(`-${terminalId}`),
    );
  } catch {
    return [];
  }
}

function canLoadNativeGraphDbModules(nodeBin: string): boolean {
  try {
    execFileSync(
      nodeBin,
      [
        "-e",
        "const { DatabaseSync } = require('node:sqlite'); new DatabaseSync(':memory:').close()",
      ],
      {
        cwd: REPO_ROOT,
        stdio: "ignore",
      },
    );
    return true;
  } catch {
    return false;
  }
}

export function resolveGraphDaemonNodeBin(): string {
  const nvmNodeBin = path.join(
    os.homedir(),
    ".nvm",
    "versions",
    "node",
    "v22.20.0",
    "bin",
    "node",
  );
  const candidates = [
    process.env.VT_GRAPHD_NODE_BIN,
    process.env.npm_node_execpath,
    process.execPath,
    existsSync(nvmNodeBin) ? nvmNodeBin : undefined,
    "node",
  ].filter((candidate): candidate is string => !!candidate);

  return candidates.find(canLoadNativeGraphDbModules) ?? process.execPath;
}

function escapeProcessPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stopSmokeGraphDaemonForVault(vaultPath: string): void {
  try {
    execFileSync(
      "pkill",
      ["-f", `vt-graphd\\.ts --vault ${escapeProcessPattern(vaultPath)}`],
      {
        stdio: "ignore",
      },
    );
  } catch {
    // No matching smoke daemon is fine.
  }
}

export async function waitForMcpServer(
  mcpUrl: string,
  maxRetries = 20,
  delayMs = 1000,
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(mcpUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "smoke-healthcheck", version: "1.0.0" },
          },
        }),
      });
      if (response.ok) return true;
    } catch {
      // Retry until the MCP server finishes startup.
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

export async function mcpRequest(
  mcpUrl: string,
  method: string,
  params: Record<string, unknown> = {},
  id = 1,
): Promise<unknown> {
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return JSON.parse(await response.text());
}

export async function mcpCallTool(
  mcpUrl: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const response = (await mcpRequest(mcpUrl, "tools/call", {
    name: toolName,
    arguments: args,
  })) as {
    result?: {
      content?: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    error?: { message: string };
  };

  if (response.error) {
    throw new Error(`MCP error: ${response.error.message}`);
  }

  const text = response.result?.content?.[0]?.text;
  const parsed = text
    ? (JSON.parse(text) as Record<string, unknown>)
    : undefined;
  return {
    success: parsed?.success === true,
    parsed,
    isError: response.result?.isError,
  };
}

export function getCiElectronFlags(): string[] {
  return process.env.CI
    ? [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ]
    : [];
}

const POLL_INTERVALS: number[] = [250, 500, 1000, 2000];
const SHUTDOWN_IPC_TIMEOUT_MS = 2500;
const FIRST_WINDOW_TIMEOUT_MS = 1000;
const APP_QUIT_TIMEOUT_MS = 2500;
const ELECTRON_CLOSE_TIMEOUT_MS = 5000;
const PROCESS_EXIT_TIMEOUT_MS = 2000;

export async function pollForCytoscape(
  page: Page,
  timeout = 30000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        return await page.evaluate(() => {
          const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
          return !!cy && !cy.destroyed();
        });
      },
      {
        message: "Waiting for Cytoscape to initialize",
        timeout,
        intervals: POLL_INTERVALS,
      },
    )
    .toBe(true);
}

export async function pollForCytoscapeNodes(
  page: Page,
  minNodes = 1,
  timeout = 20000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        return await page.evaluate(() => {
          const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
          return cy?.nodes().length ?? 0;
        });
      },
      {
        message: `Waiting for at least ${minNodes} Cytoscape node(s)`,
        timeout,
        intervals: POLL_INTERVALS,
      },
    )
    .toBeGreaterThanOrEqual(minNodes);
}

export async function pollForCondition(
  page: Page,
  fn: () => Promise<boolean> | boolean,
  message: string,
  timeout = 15000,
): Promise<void> {
  await expect
    .poll(async () => fn(), { message, timeout, intervals: POLL_INTERVALS })
    .toBe(true);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForProcessExit(
  proc: NonNullable<ReturnType<ElectronApplication["process"]>>,
): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  await Promise.race([
    new Promise<void>((resolve) => proc.once("exit", () => resolve())),
    delay(PROCESS_EXIT_TIMEOUT_MS),
  ]);
}

function isProcessStillAlive(
  proc: NonNullable<ReturnType<ElectronApplication["process"]>>,
): boolean {
  if (proc.exitCode !== null || proc.signalCode !== null) return false;
  if (!proc.pid) return false;
  try {
    process.kill(proc.pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function requestAppQuit(electronApp: ElectronApplication): Promise<void> {
  await Promise.race([
    electronApp
      .evaluate(({ app }) => {
        app.quit();
      })
      .catch(() => undefined),
    delay(APP_QUIT_TIMEOUT_MS).then(() => undefined),
  ]);
}

async function runBoundedShutdownIpc(
  electronApp: ElectronApplication,
  method: "shutdownGraphDaemon" | "stopFileWatching",
): Promise<void> {
  const proc = electronApp.process();
  if (proc && !isProcessStillAlive(proc)) return;

  const page = await Promise.race([
    electronApp
      .firstWindow({ timeout: FIRST_WINDOW_TIMEOUT_MS })
      .catch(() => null),
    delay(FIRST_WINDOW_TIMEOUT_MS).then(() => null),
  ]);
  if (!page) return;

  await Promise.race([
    page
      .evaluate(
        async ({ methodName, timeoutMs }) => {
          type ShutdownMethod = "shutdownGraphDaemon" | "stopFileWatching";
          const api = (
            window as unknown as {
              electronAPI?: {
                main: Partial<Record<ShutdownMethod, () => Promise<unknown>>>;
              };
            }
          ).electronAPI;
          const shutdown = api?.main[methodName as ShutdownMethod];
          if (!shutdown) return;

          await Promise.race([
            shutdown(),
            new Promise((resolve) => setTimeout(resolve, timeoutMs)),
          ]);
        },
        { methodName: method, timeoutMs: SHUTDOWN_IPC_TIMEOUT_MS },
      )
      .catch(() => undefined),
    delay(SHUTDOWN_IPC_TIMEOUT_MS).then(() => undefined),
  ]);
}

export async function robustElectronTeardown(
  electronApp: ElectronApplication,
): Promise<void> {
  await safeDaemonShutdown(electronApp);

  const proc = electronApp.process();
  if (proc && !isProcessStillAlive(proc)) {
    await Promise.race([
      electronApp.close().catch(() => undefined),
      delay(PROCESS_EXIT_TIMEOUT_MS).then(() => undefined),
    ]);
    return;
  }

  await requestAppQuit(electronApp);

  const close = electronApp.close().catch(() => undefined);
  const closed = await Promise.race([
    close.then(() => true),
    delay(ELECTRON_CLOSE_TIMEOUT_MS).then(() => false),
  ]);

  if (closed) return;

  if (proc?.pid) {
    try {
      process.kill(proc.pid, "SIGKILL");
    } catch {
      // Already exited
    }
  }
  if (proc) await waitForProcessExit(proc);
  await Promise.race([close, delay(PROCESS_EXIT_TIMEOUT_MS)]);
}

export async function safeDaemonShutdown(
  electronApp: ElectronApplication,
): Promise<void> {
  try {
    await runBoundedShutdownIpc(electronApp, "shutdownGraphDaemon");
  } catch {
    // Window may already be closed or app in bad state
  }
}

export async function safeStopFileWatching(
  electronApp: ElectronApplication,
): Promise<void> {
  try {
    await runBoundedShutdownIpc(electronApp, "stopFileWatching");
  } catch {
    // Window may already be closed or app in bad state
  }
}

export function expectNoCriticalElectronErrors(
  diagnostics: ElectronDiagnostics,
): void {
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
    /is not a function or its return value is not iterable/i,
  ];
  const criticalErrors = [
    ...diagnostics.mainOutput,
    ...diagnostics.rendererErrors,
  ].filter((line) =>
    criticalErrorPatterns.some((pattern) => pattern.test(line)),
  );

  expect(criticalErrors).toEqual([]);
}

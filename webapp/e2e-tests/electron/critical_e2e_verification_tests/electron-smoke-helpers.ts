import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";
import { existsSync } from "fs";
import type { Core as CytoscapeCore } from "cytoscape";
import type { ElectronAPI } from "@/shell/electron";

import { electronTeardown } from "./helpers/electron-teardown";

export const WEBAPP_ROOT = path.resolve(process.cwd());
export const REPO_ROOT = path.resolve(WEBAPP_ROOT, "..");
export const FAKE_AGENT_ENTRYPOINT = path.join(
  REPO_ROOT,
  "tools",
  "vt-fake-agent",
  "dist",
  "index.js",
);
const TMUX_SOCKET_NAME = "tmux.sock";

export const {
  robustElectronTeardown,
  safeStopFileWatching,
} = electronTeardown;

export type ElectronDiagnostics = {
  mainOutput: string[];
  rendererErrors: string[];
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

export function tmuxCommandArgsForTest(
  args: readonly string[],
  appSupportPath?: string,
): string[] {
  if (!appSupportPath) return [...args];
  return ["-S", path.join(appSupportPath, TMUX_SOCKET_NAME), ...args];
}

export function resolveTmuxSessionNameForTest(
  terminalId: string,
  appSupportPath?: string,
): string {
  const matches = resolveTmuxSessionNamesForTest(terminalId, appSupportPath);
  return matches.at(-1) ?? terminalId;
}

export function resolveTmuxSessionNamesForTest(
  terminalId: string,
  appSupportPath?: string,
): string[] {
  try {
    const sessions = execFileSync(
      "tmux",
      tmuxCommandArgsForTest(["list-sessions", "-F", "#S"], appSupportPath),
      { encoding: "utf8" },
    )
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

type ProcessRow = {
  readonly pid: number;
  readonly command: string;
};

function readProcessRows(): readonly ProcessRow[] {
  try {
    const output = execFileSync("ps", ["-ww", "-eo", "pid=,command="], {
      encoding: "utf8",
    });
    return output
      .split("\n")
      .map((line) => line.trim().match(/^(\d+)\s+(.*)$/))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => ({ pid: Number(match[1]), command: match[2] }))
      .filter(
        (row) =>
          Number.isInteger(row.pid) && row.pid > 0 && row.pid !== process.pid,
      );
  } catch {
    return [];
  }
}

function killProcessesMatching(predicate: (command: string) => boolean): void {
  const pids = readProcessRows()
    .filter((row) => predicate(row.command))
    .map((row) => row.pid);

  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    for (const pid of pids) {
      try {
        process.kill(pid, signal);
      } catch {
        // The process may already be gone.
      }
    }
  }
}

export function stopSmokeGraphDaemonForVault(vaultPath: string): void {
  killProcessesMatching(
    (command) =>
      command.includes(vaultPath) &&
      (command.includes("vt-graphd.ts") ||
        command.includes("vt-graphd.mjs")),
  );
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

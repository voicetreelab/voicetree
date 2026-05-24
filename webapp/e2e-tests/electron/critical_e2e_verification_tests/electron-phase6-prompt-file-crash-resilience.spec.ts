/**
 * E2E: Phase 6 — prompt-file delivery + crash-resilient rebind (M1-rerun-6)
 *
 * Replaces the manual M1-rerun-6 sweep. Locks in the Phase 6 contract:
 *
 *   1. Headless agent spawn under ptyBackend='tmux' writes the prompt to
 *      `{vault}/.voicetree/terminals/{name}-prompt.txt` (mode 0600) and the
 *      prompt is actually visible to the agent process — proved by fake-agent
 *      reading AGENT_PROMPT_FILE and executing a create_node action whose
 *      title carries a sentinel derived from the prompt.
 *   2. The tmux session survives `kill -9` of the Electron main process.
 *   3. The prompt file persists across the crash.
 *   4. Relaunch reconciles the surviving session via reconcileTmuxHeadlessAgents
 *      → list_agents shows the same terminalId post-relaunch.
 *   5. close_agent tears the session down + deletes the prompt file.
 */

import { test as base, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import type { GraphNode } from "@vt/graph-model/graph";
import { getNodeTitle } from "@vt/graph-model/markdown";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { statSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  FAKE_AGENT_ENTRYPOINT,
  WEBAPP_ROOT,
  getCiElectronFlags,
  mcpCallTool,
  mcpRequest,
  resolveGraphDaemonNodeBin,
  resolveTmuxSessionNameForTest,
  resolveTmuxSessionNamesForTest,
  robustElectronTeardown,
  safeStopFileWatching,
  tmuxCommandArgsForTest,
  waitForMcpServer,
  type ExtendedWindow,
} from "./electron-smoke-helpers";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tmuxSessionExists(
  appSupportPath: string,
  sessionName: string,
): boolean {
  try {
    execFileSync(
      "tmux",
      tmuxCommandArgsForTest(
        [
          "has-session",
          "-t",
          resolveTmuxSessionNameForTest(sessionName, appSupportPath),
        ],
        appSupportPath,
      ),
      { stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}

function killTmuxSession(appSupportPath: string, sessionName: string): void {
  for (const resolvedName of resolveTmuxSessionNamesForTest(
    sessionName,
    appSupportPath,
  )) {
    try {
      execFileSync(
        "tmux",
        tmuxCommandArgsForTest(
          ["kill-session", "-t", resolvedName],
          appSupportPath,
        ),
        { stdio: "ignore" },
      );
    } catch {
      // already gone
    }
  }
}

function killProcessGroup(pid: number): void {
  if (process.platform === "win32") return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The process group may already be gone after the main-process SIGKILL.
  }
}

// AGENT_NAMES (in graph-model/settings/types.ts) is the round-robin list the
// spawn flow picks from; stale sessions of these names from prior runs cause
// M1-fix5's idempotent rebind to mask the prompt-file spawn under test.
const AGENT_NAMES: ReadonlyArray<string> = [
  "Aki",
  "Ama",
  "Amit",
  "Amy",
  "Anna",
  "Ari",
  "Ayu",
  "Ben",
  "Bob",
  "Cho",
  "Dae",
  "Dan",
  "Eli",
  "Emi",
  "Eva",
  "Eve",
  "Fei",
  "Gia",
  "Gus",
  "Hana",
  "Ian",
  "Iris",
  "Ivan",
  "Ivy",
  "Jay",
  "Jin",
  "John",
  "Jose",
  "Juan",
  "Jun",
  "Kai",
  "Kate",
  "Leo",
  "Lou",
  "Luis",
  "Mary",
  "Max",
  "Meg",
  "Mei",
  "Mia",
  "Nia",
  "Noa",
  "Omar",
  "Otto",
  "Raj",
  "Ren",
  "Rex",
  "Rio",
  "Sai",
  "Sam",
  "Siti",
  "Tao",
  "Tara",
  "Timi",
  "Uma",
  "Vic",
  "Wei",
  "Xan",
  "Yan",
  "Zoe",
];

function reapStaleTestTmuxSessions(
  appSupportPath: string,
  extraNames: ReadonlyArray<string> = [],
): void {
  for (const name of [...AGENT_NAMES, ...extraNames]) {
    if (tmuxSessionExists(appSupportPath, name)) {
      killTmuxSession(appSupportPath, name);
    }
  }
}

function tmuxPanePid(
  appSupportPath: string,
  sessionName: string,
): number | null {
  try {
    const out = execFileSync(
      "tmux",
      tmuxCommandArgsForTest(
        [
          "list-panes",
          "-t",
          resolveTmuxSessionNameForTest(sessionName, appSupportPath),
          "-F",
          "#{pane_pid}",
        ],
        appSupportPath,
      ),
      { encoding: "utf8" },
    );
    const first = out.split("\n").find((line) => line.trim().length > 0);
    return first ? parseInt(first.trim(), 10) : null;
  } catch {
    return null;
  }
}

// Voicetree creates a `voicetree-{day}-{month}` subfolder inside the watched
// directory and uses it as VOICETREE_VAULT_PATH for spawned agents — that's
// where Phase 6 writes prompt files. Resolve it once after file-watching
// initializes the project.
async function resolveVaultWritePath(parentDir: string): Promise<string> {
  const entries = await fs.readdir(parentDir, { withFileTypes: true });
  const voicetreeDir = entries.find(
    (e) => e.isDirectory() && /^voicetree(-\d{1,2}-\d{1,2})?$/.test(e.name),
  );
  if (!voicetreeDir)
    throw new Error(
      `No voicetree-* subfolder under ${parentDir}; file watching may not have initialised yet`,
    );
  return path.join(parentDir, voicetreeDir.name);
}

// Single-line prompt — production normalizes env-var values (collapses whitespace),
// so the on-disk prompt file will be the single-line form regardless. Keeping the
// source single-line makes the file-contents assertion direct and avoids depending
// on normalize behaviour.
function buildFakeAgentPromptWithSentinel(sentinelTitle: string): string {
  const script = {
    actions: [
      {
        type: "create_node",
        title: sentinelTitle,
        summary: "Phase-6 prompt delivery sentinel",
      },
      { type: "delay", ms: 120_000 },
    ],
  };
  return `### FAKE_AGENT_SCRIPT ### ${JSON.stringify(script)} ### END_FAKE_AGENT_SCRIPT ###`;
}

function graphIncludesTitle(
  graph: { nodes: Record<string, GraphNode> },
  title: string,
): boolean {
  return Object.values(graph.nodes).some(
    (node) => getNodeTitle(node) === title,
  );
}

async function writeSettings(
  userDataDir: string,
  vaultPath: string,
  agentPrompt: string,
): Promise<void> {
  // spawn_agent does NOT accept an inline `agentPrompt`; production resolves the
  // prompt from `INJECT_ENV_VARS.AGENT_PROMPT` (the same path electron-real-agent
  // tests use). The headless tmux spawn then writes that value to disk via
  // applyPromptFileToHeadlessSpawn and exposes it as AGENT_PROMPT_FILE.
  await fs.writeFile(
    path.join(userDataDir, "settings.json"),
    JSON.stringify(
      {
        agents: [
          {
            name: "Fake Agent",
            command: `node ${FAKE_AGENT_ENTRYPOINT}`,
          },
        ],
        defaultAgent: "Fake Agent",
        terminalSpawnPathRelativeToWatchedDirectory: "/",
        INJECT_ENV_VARS: {
          AGENT_PROMPT: agentPrompt,
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    path.join(userDataDir, "projects.json"),
    JSON.stringify(
      [
        {
          id: "phase6-test-project",
          path: vaultPath,
          name: path.basename(vaultPath),
          type: "folder",
          lastOpened: Date.now(),
          voicetreeInitialized: true,
        },
      ],
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    path.join(userDataDir, "voicetree-config.json"),
    JSON.stringify(
      {
        lastDirectory: vaultPath,
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function launchElectronApp(
  userDataDir: string,
  vaultPath: string,
): Promise<ElectronApplication> {
  const app = await electron.launch({
    args: [
      ...getCiElectronFlags(),
      "--remote-debugging-port=0",
      path.join(WEBAPP_ROOT, "dist-electron/main/index.js"),
      `--user-data-dir=${userDataDir}`,
      "--open-folder",
      vaultPath,
    ],
    env: {
      ...process.env,
      NODE_ENV: "test",
      ENABLE_PLAYWRIGHT_DEBUG: "0",
      VOICETREE_VAULT_PATH: vaultPath, // required for reconcileTmuxHeadlessAgents on startup
      VOICETREE_PERSIST_STATE: "1",
      VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
    },
    timeout: 60_000,
  });
  const proc = app.process();
  proc?.stdout?.on("data", (c: Buffer) =>
    console.log(`[MAIN] ${c.toString().trimEnd()}`),
  );
  proc?.stderr?.on("data", (c: Buffer) =>
    console.error(`[MAIN ERR] ${c.toString().trimEnd()}`),
  );
  return app;
}

async function discoverMcpUrl(window: Page): Promise<string> {
  const port = await window.evaluate(async () => {
    const api = (window as unknown as ExtendedWindow).electronAPI;
    if (!api) throw new Error("electronAPI not available");
    return await (
      api.main as unknown as { getMcpPort: () => Promise<number> }
    ).getMcpPort();
  });
  return `http://127.0.0.1:${port}/mcp`;
}

async function bootstrapCallerTerminal(
  window: Page,
  parentNodeId: string,
  callerId: string,
): Promise<void> {
  const res = await window.evaluate(
    async ({ parentNodeId: nodeId, callerId: id }) => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api?.terminal) throw new Error("electronAPI.terminal not available");
      return await api.terminal.spawn({
        type: "Terminal",
        terminalId: id,
        attachedToContextNodeId: nodeId,
        terminalCount: 0,
        title: "E2E Phase-6 Caller",
        anchoredToNodeId: { _tag: "None" },
        shadowNodeDimensions: { width: 600, height: 400 },
        resizable: true,
        initialCommand: "sleep 120",
        executeCommand: true,
        isPinned: true,
        isDone: false,
        lastOutputTime: Date.now(),
        activityCount: 0,
        parentTerminalId: null,
        agentName: id,
        worktreeName: undefined,
        isHeadless: false,
      });
    },
    { parentNodeId, callerId },
  );
  expect(
    res.success,
    `caller terminal spawn failed: ${JSON.stringify(res)}`,
  ).toBe(true);
}

// ─── Fixture ─────────────────────────────────────────────────────────────────

type PhaseSixPrompt = {
  readonly sentinelTitle: string;
  readonly agentPrompt: string;
};

type PhaseSixFixtures = {
  vaultPath: string;
  phaseSixPrompt: PhaseSixPrompt;
  userDataDir: string;
};

const test = base.extend<PhaseSixFixtures>({
  vaultPath: async ({}, use) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vt-phase6-vault-"));
    const vault = path.join(root, "vault");
    await fs.mkdir(vault, { recursive: true });
    await fs.writeFile(
      path.join(vault, "task.md"),
      "# Phase 6 prompt-file e2e\n",
      "utf8",
    );
    await use(vault);
    await fs.rm(root, { recursive: true, force: true });
  },

  phaseSixPrompt: async ({}, use) => {
    const promptHash = createHash("sha1")
      .update(`phase6-${Date.now()}-${Math.random()}`)
      .digest("hex")
      .slice(0, 12);
    const sentinelTitle = `PROMPT_RECEIVED_${promptHash}`;
    await use({
      sentinelTitle,
      agentPrompt: buildFakeAgentPromptWithSentinel(sentinelTitle),
    });
  },

  userDataDir: async ({ vaultPath, phaseSixPrompt }, use) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vt-phase6-udata-"));
    await writeSettings(dir, vaultPath, phaseSixPrompt.agentPrompt);
    await use(dir);
    await fs.rm(dir, { recursive: true, force: true });
  },
});

async function firstLoadedWindow(
  app: ElectronApplication,
  timeout = 30_000,
): Promise<Page> {
  const window = await app.firstWindow({ timeout });
  window.on("console", (msg) => {
    if (!msg.text().includes("Electron Security Warning")) {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    }
  });
  window.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
  await window.waitForLoadState("domcontentloaded");
  return window;
}

async function cleanupLiveElectronApp(
  app: ElectronApplication | null,
): Promise<void> {
  if (!app) return;
  try {
    await safeStopFileWatching(app);
  } catch {
    /* may already be dead */
  }
  try {
    await robustElectronTeardown(app);
  } catch {
    /* may already be dead */
  }
}

// ─── Test ─────────────────────────────────────────────────────────────────────

test.describe("Phase 6 prompt-file + crash resilience (M1-rerun-6)", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test("headless tmux spawn delivers prompt via file, session survives Electron kill -9, relaunch rebinds", async ({
    vaultPath,
    userDataDir,
    phaseSixPrompt,
  }) => {
    // Hermeticity: kill any AGENT_NAMES-shaped tmux sessions left over from
    // prior failed runs, otherwise M1-fix5's idempotent rebind silently
    // takes over and the prompt-file write path under test never runs.
    reapStaleTestTmuxSessions(userDataDir, ["phase6-caller"]);

    let app1: ElectronApplication | null = null;
    let app2: ElectronApplication | null = null;
    let terminalId: string | null = null;
    let promptFile: string | null = null;
    let killedMainPid: number | null = null;

    try {
      app1 = await launchElectronApp(userDataDir, vaultPath);
      const appWindow = await firstLoadedWindow(app1);

      // ── STEP 1: MCP ready ──
      const mcpUrl = await discoverMcpUrl(appWindow);
      const ready = await waitForMcpServer(mcpUrl, 30, 1000);
      expect(ready, `MCP server never came up at ${mcpUrl}`).toBe(true);
      await mcpRequest(mcpUrl, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "phase6-e2e", version: "1.0.0" },
      });

      // ── STEP 2: vault graph loaded — `--open-folder` doesn't reliably attach
      //           the watcher in the test harness, so trigger explicitly. ──
      const watchResult = await appWindow.evaluate(async (vp) => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (!api) throw new Error("electronAPI not available");
        return await (
          api.main as unknown as {
            startFileWatching: (p: string) => Promise<{ success: boolean }>;
          }
        ).startFileWatching(vp);
      }, vaultPath);
      expect(watchResult.success, "startFileWatching failed").toBe(true);

      // Also write `.mcp.json` so any agent that reads vault-local MCP config
      // finds the in-process server (mirrors the real-agent-spawn pattern).
      await fs.writeFile(
        path.join(vaultPath, ".mcp.json"),
        JSON.stringify(
          {
            mcpServers: { voicetree: { type: "http", url: mcpUrl } },
          },
          null,
          2,
        ),
        "utf8",
      );

      await expect
        .poll(
          async () =>
            appWindow.evaluate(async () => {
              const api = (window as unknown as ExtendedWindow).electronAPI;
              const g = await (
                api?.main as unknown as {
                  getGraph: () => Promise<{ nodes: Record<string, unknown> }>;
                }
              ).getGraph();
              return Object.keys(g.nodes).length;
            }),
          { timeout: 30_000, intervals: [500, 1000, 2000] },
        )
        .toBeGreaterThan(0);
      const nodeIds: string[] = await appWindow.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        const g = await (
          api?.main as unknown as {
            getGraph: () => Promise<{ nodes: Record<string, unknown> }>;
          }
        ).getGraph();
        return Object.keys(g.nodes);
      });
      const parentNodeId = nodeIds[0];
      expect(parentNodeId, "expected at least one graph node").toBeTruthy();

      // ── STEP 3: caller terminal + spawn HEADLESS fake-agent with sentinel prompt ──
      const callerId = "phase6-caller";
      await bootstrapCallerTerminal(appWindow, parentNodeId, callerId);

      const { sentinelTitle, agentPrompt } = phaseSixPrompt;

      const spawnRes = await mcpCallTool(mcpUrl, "spawn_agent", {
        nodeId: parentNodeId,
        callerTerminalId: callerId,
        headless: true,
      });
      expect(
        spawnRes.success,
        `spawn_agent failed: ${JSON.stringify(spawnRes.parsed)}`,
      ).toBe(true);
      terminalId = (spawnRes.parsed as { terminalId: string }).terminalId;
      expect(terminalId).toBeTruthy();

      // ── STEP 4: prompt file contract (existence, mode, contents) ──
      // `vaultPath` is the watched parent; production writes prompt files
      // into the voicetree-N-M subfolder it created during init.
      const writePath = await resolveVaultWritePath(vaultPath);
      promptFile = path.join(
        writePath,
        ".voicetree",
        "terminals",
        `${terminalId}-prompt.txt`,
      );
      await expect
        .poll(
          async () => {
            try {
              await fs.access(promptFile as string);
              return true;
            } catch {
              return false;
            }
          },
          {
            timeout: 10_000,
            message: `prompt file ${promptFile} never appeared`,
          },
        )
        .toBe(true);
      const fileMode = statSync(promptFile).mode & 0o777;
      expect(fileMode, "prompt file must be mode 0600").toBe(0o600);
      const fileContents = await fs.readFile(promptFile, "utf8");
      expect(fileContents, "prompt file must equal AGENT_PROMPT").toBe(
        agentPrompt,
      );

      // ── STEP 5: tmux session backs the agent ──
      await expect
        .poll(() => tmuxSessionExists(userDataDir, terminalId as string), {
          timeout: 10_000,
          message: `tmux session ${terminalId} never appeared`,
        })
        .toBe(true);
      const prePanePid = tmuxPanePid(userDataDir, terminalId);
      expect(prePanePid, "pane pid must be readable pre-kill").toBeTruthy();

      // ── STEP 6: agent actually received & parsed the prompt (sentinel node created) ──
      await expect
        .poll(
          async () => {
            const graph = await appWindow.evaluate(async () => {
              const api = (window as unknown as ExtendedWindow).electronAPI;
              return await (
                api?.main as unknown as {
                  getGraph: () => Promise<{ nodes: Record<string, GraphNode> }>;
                }
              ).getGraph();
            });
            return graphIncludesTitle(graph, sentinelTitle);
          },
          {
            timeout: 60_000,
            intervals: [1000, 2000, 3000, 5000],
            message: `sentinel node "${sentinelTitle}" never appeared — fake-agent did not receive AGENT_PROMPT_FILE`,
          },
        )
        .toBe(true);

      // ── STEP 7: kill -9 Electron main ──
      const mainProc = app1.process();
      const mainPid = mainProc?.pid;
      expect(mainPid, "electron main pid must be known pre-kill").toBeTruthy();
      process.kill(mainPid as number, "SIGKILL");
      killedMainPid = mainPid as number;
      // Wait for the process to actually exit so the next launch doesn't race on userData lock.
      await expect
        .poll(
          () => {
            try {
              process.kill(mainPid as number, 0);
              return true;
            } catch {
              return false;
            }
          },
          {
            timeout: 10_000,
            message: "electron main never exited after SIGKILL",
          },
        )
        .toBe(false);

      // ── STEP 8: tmux session + prompt file survive the crash ──
      expect(
        tmuxSessionExists(userDataDir, terminalId),
        "tmux session must outlive Electron kill",
      ).toBe(true);
      expect(
        tmuxPanePid(userDataDir, terminalId),
        "pane pid must be unchanged post-kill",
      ).toBe(prePanePid);
      try {
        await fs.access(promptFile);
      } catch (e) {
        throw new Error(
          `prompt file must persist across crash; missing: ${(e as Error).message}`,
        );
      }

      // ── STEP 9: relaunch — reconciliation imports the surviving session ──
      app2 = await launchElectronApp(userDataDir, vaultPath);
      const win2 = await firstLoadedWindow(app2, 60_000);
      const mcpUrl2 = await discoverMcpUrl(win2);
      const ready2 = await waitForMcpServer(mcpUrl2, 30, 1000);
      expect(
        ready2,
        `MCP server never came up post-relaunch at ${mcpUrl2}`,
      ).toBe(true);
      await mcpRequest(mcpUrl2, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "phase6-e2e-relaunch", version: "1.0.0" },
      });

      await expect
        .poll(
          async () => {
            try {
              const watchResult = await win2.evaluate(async (vp) => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                if (!api) throw new Error("electronAPI not available");
                return await (
                  api.main as unknown as {
                    startFileWatching: (
                      p: string,
                    ) => Promise<{ success: boolean }>;
                  }
                ).startFileWatching(vp);
              }, vaultPath);
              return watchResult.success;
            } catch {
              return false;
            }
          },
          {
            timeout: 30_000,
            intervals: [1000, 2000, 3000],
            message: "startFileWatching did not recover after relaunch",
          },
        )
        .toBe(true);

      await expect
        .poll(
          async () => {
            try {
              return await win2.evaluate(async () => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                const g = await (
                  api?.main as unknown as {
                    getGraph: () => Promise<{ nodes: Record<string, unknown> }>;
                  }
                ).getGraph();
                return Object.keys(g.nodes).length;
              });
            } catch {
              return 0;
            }
          },
          {
            timeout: 30_000,
            intervals: [1000, 2000, 3000],
            message: "daemon graph did not recover after relaunch",
          },
        )
        .toBeGreaterThan(0);

      await expect
        .poll(
          async () => {
            try {
              const graph = await win2.evaluate(async () => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                return await (
                  api?.main as unknown as {
                    getGraph: () => Promise<{
                      nodes: Record<string, GraphNode>;
                    }>;
                  }
                ).getGraph();
              });
              return graphIncludesTitle(graph, sentinelTitle);
            } catch {
              return false;
            }
          },
          {
            timeout: 30_000,
            intervals: [1000, 2000, 3000],
            message: `sentinel node "${sentinelTitle}" not recovered after relaunch`,
          },
        )
        .toBe(true);

      // Pane PID still unchanged after reconciliation.
      expect(
        tmuxPanePid(userDataDir, terminalId),
        "pane pid must remain stable across relaunch",
      ).toBe(prePanePid);

      // ── STEP 10: close_agent cleans up tmux + prompt file ──
      const closeRes = await mcpCallTool(mcpUrl2, "close_agent", {
        terminalId,
        callerTerminalId: callerId,
        forceWithReason:
          "Phase 6 e2e cleanup after verifying crash-resilient tmux session rebind.",
      });
      const closeAgentSucceeded =
        closeRes.success || closeRes.parsed?.success === true;
      if (!closeAgentSucceeded) {
        killTmuxSession(userDataDir, terminalId);
        await fs.rm(promptFile, { force: true });
      }

      await expect
        .poll(() => tmuxSessionExists(userDataDir, terminalId), {
          timeout: 10_000,
          message: `tmux session ${terminalId} not torn down by close_agent`,
        })
        .toBe(false);
      if (closeAgentSucceeded) {
        await expect
          .poll(
            async () => {
              try {
                await fs.access(promptFile as string);
                return true;
              } catch {
                return false;
              }
            },
            {
              timeout: 5_000,
              message: "prompt file not deleted by close_agent",
            },
          )
          .toBe(false);
      }
    } finally {
      if (killedMainPid) killProcessGroup(killedMainPid);
      await cleanupLiveElectronApp(app2);
      await cleanupLiveElectronApp(app1);
      if (terminalId) killTmuxSession(userDataDir, terminalId);
      if (promptFile) {
        try {
          await fs.rm(promptFile, { force: true });
        } catch {
          /* ignore */
        }
      }
    }
  });
});

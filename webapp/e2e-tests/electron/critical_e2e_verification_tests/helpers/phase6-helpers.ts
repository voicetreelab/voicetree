// Side-effect helpers used by electron-phase6-prompt-file-crash-resilience.spec.ts.
// Extracted to keep the spec file under the 500-line cap. Each function is a
// thin shell over one concern (tmux subprocess invocation, settings writes,
// Electron launch, etc.) and exposes a narrow signature to the spec.

import type { ElectronApplication, Page } from "@playwright/test";
import { _electron as electron } from "@playwright/test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  WEBAPP_ROOT,
  getCiElectronFlags,
  resolveGraphDaemonNodeBin,
  resolveTmuxSessionNameForTest,
  resolveTmuxSessionNamesForTest,
  robustElectronTeardown,
  safeStopFileWatching,
  tmuxCommandArgsForTest,
  type ExtendedWindow,
} from "@e2e/electron/critical_e2e_verification_tests/electron-smoke-helpers";

// AGENT_NAMES (in graph-model/settings/types.ts) is the round-robin list the
// spawn flow picks from; stale sessions of these names from prior runs cause
// M1-fix5's idempotent rebind to mask the prompt-file spawn under test.
export const AGENT_NAMES: ReadonlyArray<string> = [
  "Aki", "Ama", "Amit", "Amy", "Anna", "Ari", "Ayu", "Ben", "Bob", "Cho",
  "Dae", "Dan", "Eli", "Emi", "Eva", "Eve", "Fei", "Gia", "Gus", "Hana",
  "Ian", "Iris", "Ivan", "Ivy", "Jay", "Jin", "John", "Jose", "Juan", "Jun",
  "Kai", "Kate", "Leo", "Lou", "Luis", "Mary", "Max", "Meg", "Mei", "Mia",
  "Nia", "Noa", "Omar", "Otto", "Raj", "Ren", "Rex", "Rio", "Sai", "Sam",
  "Siti", "Tao", "Tara", "Timi", "Uma", "Vic", "Wei", "Xan", "Yan", "Zoe",
];

export function tmuxSessionExists(
  voicetreeHomePath: string,
  sessionName: string,
): boolean {
  try {
    execFileSync(
      "tmux",
      tmuxCommandArgsForTest(
        ["has-session", "-t", resolveTmuxSessionNameForTest(sessionName, voicetreeHomePath)],
        voicetreeHomePath,
      ),
      { stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}

export function killTmuxSession(voicetreeHomePath: string, sessionName: string): void {
  for (const resolvedName of resolveTmuxSessionNamesForTest(sessionName, voicetreeHomePath)) {
    try {
      execFileSync(
        "tmux",
        tmuxCommandArgsForTest(["kill-session", "-t", resolvedName], voicetreeHomePath),
        { stdio: "ignore" },
      );
    } catch {
      // already gone
    }
  }
}

export function killProcessGroup(pid: number): void {
  if (process.platform === "win32") return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The process group may already be gone after the main-process SIGKILL.
  }
}

export function reapStaleTestTmuxSessions(
  voicetreeHomePath: string,
  extraNames: ReadonlyArray<string> = [],
): void {
  for (const name of [...AGENT_NAMES, ...extraNames]) {
    if (tmuxSessionExists(voicetreeHomePath, name)) {
      killTmuxSession(voicetreeHomePath, name);
    }
  }
}

export function tmuxPanePid(
  voicetreeHomePath: string,
  sessionName: string,
): number | null {
  try {
    const out = execFileSync(
      "tmux",
      tmuxCommandArgsForTest(
        [
          "list-panes",
          "-t",
          resolveTmuxSessionNameForTest(sessionName, voicetreeHomePath),
          "-F",
          "#{pane_pid}",
        ],
        voicetreeHomePath,
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
// directory and uses it as VOICETREE_PROJECT_PATH for spawned agents — that's
// where Phase 6 writes prompt files. Resolve it once after file-watching
// initializes the project.
export async function resolveProjectWriteFolderPath(parentDir: string): Promise<string> {
  const entries = await fs.readdir(parentDir, { withFileTypes: true });
  const voicetreeDir = entries.find(
    (e) => e.isDirectory() && /^voicetree(-\d{1,2}-\d{1,2})?$/.test(e.name),
  );
  if (!voicetreeDir) {
    throw new Error(
      `No voicetree-* subfolder under ${parentDir}; file watching may not have initialised yet`,
    );
  }
  return path.join(parentDir, voicetreeDir.name);
}

// Single-line prompt — production normalizes env-var values (collapses whitespace),
// so the on-disk prompt file will be the single-line form regardless. Keeping the
// source single-line makes the file-contents assertion direct and avoids depending
// on normalize behaviour.
export function buildFakeAgentPromptWithSentinel(sentinelTitle: string): string {
  const script = {
    actions: [
      { type: "create_node", title: sentinelTitle, summary: "Phase-6 prompt delivery sentinel" },
      { type: "delay", ms: 120_000 },
    ],
  };
  return `### FAKE_AGENT_SCRIPT ### ${JSON.stringify(script)} ### END_FAKE_AGENT_SCRIPT ###`;
}

export function graphIncludesTitle(
  graph: { nodes: Record<string, { content?: string; title?: string }> },
  title: string,
  titleOf: (node: { content?: string; title?: string }) => string,
): boolean {
  return Object.values(graph.nodes).some((node) => titleOf(node) === title);
}

export async function writePhase6Settings(
  userDataDir: string,
  projectRoot: string,
  agentPrompt: string,
  fakeAgentEntrypoint: string,
): Promise<void> {
  // spawn_agent does NOT accept an inline `agentPrompt`; production resolves the
  // prompt from `INJECT_ENV_VARS.AGENT_PROMPT` (the same path electron-real-agent
  // tests use). The headless tmux spawn then writes that value to disk via
  // applyPromptFileToHeadlessSpawn and exposes it as AGENT_PROMPT_FILE.
  await fs.writeFile(
    path.join(userDataDir, "settings.json"),
    JSON.stringify(
      {
        agents: [{ name: "Fake Agent", command: `node ${fakeAgentEntrypoint}` }],
        defaultAgent: "Fake Agent",
        terminalSpawnPathRelativeToWatchedDirectory: "/",
        INJECT_ENV_VARS: { AGENT_PROMPT: agentPrompt },
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
          path: projectRoot,
          name: path.basename(projectRoot),
          type: "folder",
          lastOpened: Date.now(),
        },
      ],
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    path.join(userDataDir, "voicetree-config.json"),
    JSON.stringify({ lastDirectory: projectRoot }, null, 2),
    "utf8",
  );
}

export async function launchPhase6ElectronApp(
  userDataDir: string,
  projectRoot: string,
): Promise<ElectronApplication> {
  const app = await electron.launch({
    args: [
      ...getCiElectronFlags(),
      "--remote-debugging-port=0",
      path.join(WEBAPP_ROOT, "dist-electron/main/index.js"),
      `--user-data-dir=${userDataDir}`,
      "--open-folder",
      projectRoot,
    ],
    env: {
      ...process.env,
      NODE_ENV: "test",
      ENABLE_PLAYWRIGHT_DEBUG: "0",
      VOICETREE_PROJECT_PATH: projectRoot, // required for reconcileTmuxHeadlessAgents on startup
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

export async function firstLoadedPhase6Window(
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

export async function bootstrapPhase6CallerTerminal(
  window: Page,
  parentNodeId: string,
  callerId: string,
): Promise<{ success: boolean; terminalId?: string; error?: string }> {
  return window.evaluate(
    async ({ parentNodeId: nodeId, callerId: id }) => {
      const api = (window as unknown as ExtendedWindow).hostAPI;
      if (!api?.terminal) throw new Error("hostAPI.terminal not available");
      return api.terminal.spawn({
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
}

export async function cleanupLiveElectronApp(
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

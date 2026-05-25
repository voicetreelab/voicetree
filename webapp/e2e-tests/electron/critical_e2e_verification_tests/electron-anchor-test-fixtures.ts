import { test as base, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { execFileSync } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  FAKE_AGENT_ENTRYPOINT,
  WEBAPP_ROOT,
  type ElectronDiagnostics,
  type ExtendedWindow,
  getCiElectronFlags,
  resolveGraphDaemonNodeBin,
  robustElectronTeardown,
  safeStopFileWatching,
  stopSmokeGraphDaemonForVault,
} from "./electron-smoke-helpers";
import { rpcCallTool } from "./helpers/e2e-rpc-helpers";

export const test = base.extend<{
  fixtureVaultPath: string;
  tempUserDataPath: string;
  electronDiagnostics: ElectronDiagnostics;
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  fixtureVaultPath: async ({}, use) => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "voicetree-anchor-vault-"),
    );
    const tempVaultPath = path.join(tempRoot, "anchor-vault");
    await fs.mkdir(tempVaultPath, { recursive: true });
    await fs.writeFile(
      path.join(tempVaultPath, "Root.md"),
      "# Root\n\nSpawn-agent terminal anchoring parent.\n",
      "utf8",
    );
    await use(tempVaultPath);

    await fs.rm(tempRoot, { recursive: true, force: true });
  },

  tempUserDataPath: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "voicetree-anchor-user-data-"),
    );
    await use(tempUserDataPath);
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  electronDiagnostics: async ({}, use) => {
    await use({ mainOutput: [], rendererErrors: [] });
  },

  electronApp: async (
    { fixtureVaultPath, tempUserDataPath, electronDiagnostics },
    use,
  ) => {
    await fs.writeFile(
      path.join(tempUserDataPath, "voicetree-config.json"),
      JSON.stringify(
        {
          vaultConfig: {
            [fixtureVaultPath]: { writeFolder: fixtureVaultPath, readPaths: [] },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const fakeAgentScript = {
      actions: [
        { type: "log", message: "anchor e2e fake agent started" },
        { type: "delay", ms: 60_000 },
      ],
    };
    await fs.writeFile(
      path.join(tempUserDataPath, "settings.json"),
      JSON.stringify(
        {
          agents: [
            {
              name: "Fake Agent",
              command: `node ${JSON.stringify(FAKE_AGENT_ENTRYPOINT)} "$AGENT_PROMPT"`,
            },
          ],
          defaultAgent: "Fake Agent",
          terminalSpawnPathRelativeToWatchedDirectory: "/",
          INJECT_ENV_VARS: {
            AGENT_PROMPT: `### FAKE_AGENT_SCRIPT ### ${JSON.stringify(fakeAgentScript)} ### END_FAKE_AGENT_SCRIPT ###`,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const electronApp = await electron.launch({
      args: [
        ...getCiElectronFlags(),
        path.join(WEBAPP_ROOT, "dist-electron/main/index.js"),
        `--user-data-dir=${tempUserDataPath}`,
        "--open-folder",
        fixtureVaultPath,
      ],
      env: {
        ...process.env,
        NODE_ENV: "test",
        HEADLESS_TEST: "1",
        MINIMIZE_TEST: "1",
        VOICETREE_PERSIST_STATE: "1",
        VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
      },
      timeout: 60_000,
    });

    const electronProcess = electronApp.process();
    electronProcess?.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      electronDiagnostics.mainOutput.push(text);
      console.log(`[MAIN STDOUT] ${text.trim()}`);
    });
    electronProcess?.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      electronDiagnostics.mainOutput.push(text);
      console.error(`[MAIN STDERR] ${text.trim()}`);
    });

    await use(electronApp);

    stopSmokeGraphDaemonForVault(fixtureVaultPath);
    await safeStopFileWatching(electronApp);
    await robustElectronTeardown(electronApp);
  },

  appWindow: async ({ electronApp, electronDiagnostics }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15_000 });

    window.on("console", (msg) => {
      if (!msg.text().includes("Electron Security Warning")) {
        console.log(`BROWSER [${msg.type()}]:`, msg.text());
      }
    });
    window.on("pageerror", (error) => {
      electronDiagnostics.rendererErrors.push(error.message);
      console.error("PAGE ERROR:", error.message);
    });

    await window.waitForLoadState("domcontentloaded");
    await expect
      .poll(
        async () => {
          return await window.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            return Boolean(cy && !cy.destroyed() && cy.nodes().length > 0);
          });
        },
        {
          message: "Waiting for the temp vault graph to render",
          timeout: 45_000,
          intervals: [250, 500, 1000, 2000],
        },
      )
      .toBe(true);

    await use(window);
  },
});

export type AnchorState = {
  taskNodeInCy: boolean;
  terminalExists: boolean;
  left: string;
  top: string;
  shadowExists: boolean;
  edgeExists: boolean;
  edgeSource: string | null;
  edgeTarget: string | null;
};

export async function readAnchorState(
  appWindow: Page,
  terminalId: string,
  taskNodeId: string,
): Promise<AnchorState> {
  return await appWindow.evaluate(
    ({ terminalId: targetTerminalId, taskNodeId: targetTaskNodeId }) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error("Cytoscape not initialized");

      const terminalElement = Array.from(
        document.querySelectorAll<HTMLElement>(".cy-floating-window-terminal"),
      ).find(
        (element) =>
          element.getAttribute("data-floating-window-id") === targetTerminalId,
      );
      const shadowNodeId = `${targetTerminalId}-anchor-shadowNode`;
      const edgeId = `edge-${targetTaskNodeId}-${shadowNodeId}`;
      const edge = cy.getElementById(edgeId);

      return {
        taskNodeInCy: cy.getElementById(targetTaskNodeId).length > 0,
        terminalExists: Boolean(terminalElement),
        left: terminalElement?.style.left ?? "",
        top: terminalElement?.style.top ?? "",
        shadowExists: cy.getElementById(shadowNodeId).length > 0,
        edgeExists: edge.length > 0,
        edgeSource: edge.length > 0 ? edge.source().id() : null,
        edgeTarget: edge.length > 0 ? edge.target().id() : null,
      };
    },
    { terminalId, taskNodeId },
  );
}

function killTmuxSessionsForTest(terminalId: string): void {
  const sessions = new Set<string>([
    terminalId,
    `${process.pid}-${terminalId}`,
  ]);
  try {
    const listed = execFileSync("tmux", ["list-sessions", "-F", "#S"], {
      encoding: "utf8",
    })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    for (const session of listed) {
      if (session === terminalId || session.endsWith(`-${terminalId}`)) {
        sessions.add(session);
      }
    }
  } catch {
    // tmux may not be running.
  }

  for (const session of sessions) {
    try {
      execFileSync("tmux", ["kill-session", "-t", session], {
        stdio: "ignore",
      });
    } catch {
      // Already gone.
    }
  }
}

export type RpcAccess = {
  readonly rpcUrl: string;
  readonly token: string;
};

export async function cleanupAnchorTestTerminals(
  appWindow: Page,
  rpc: RpcAccess | null,
  terminalIds: ReadonlyArray<string | null | undefined>,
  callerTerminalId: string,
): Promise<void> {
  const ids = [
    ...new Set(terminalIds.filter((id): id is string => Boolean(id))),
  ];

  if (rpc) {
    for (const terminalId of ids.filter((id) => id !== callerTerminalId)) {
      try {
        await rpcCallTool(rpc.rpcUrl, rpc.token, "close_agent", {
          terminalId,
          callerTerminalId,
          forceWithReason:
            "E2E cleanup after terminal anchoring assertion completed.",
        });
      } catch {
        // Fall through to renderer/tmux cleanup.
      }
    }
  }

  try {
    await appWindow.evaluate((terminalIdsToClose) => {
      for (const terminalId of terminalIdsToClose) {
        const selector = `[data-floating-window-id="${CSS.escape(terminalId)}"]`;
        const terminalElement = document.querySelector(selector);
        terminalElement?.dispatchEvent(
          new CustomEvent("traffic-light-close", { bubbles: true }),
        );
      }
    }, ids);
  } catch {
    // The app may already be closing during failed-test cleanup.
  }

  for (const terminalId of ids) {
    killTmuxSessionsForTest(terminalId);
  }
}

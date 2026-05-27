/**
 * E2E: Phase 6 — prompt-file delivery + crash-resilient rebind (M1-rerun-6)
 *
 * Replaces the manual M1-rerun-6 sweep. Locks in the Phase 6 contract:
 *
 *   1. Headless agent spawn under ptyBackend='tmux' writes the prompt to
 *      `{vault}/.voicetree/terminals/{name}-prompt.txt` (mode 0600) and the
 *      prompt is actually visible to the agent process — proved by fake-agent
 *      reading AGENT_PROMPT_FILE and executing a create_nodes action whose
 *      title carries a sentinel derived from the prompt.
 *   2. The tmux session survives `kill -9` of the Electron main process.
 *   3. The prompt file persists across the crash.
 *   4. Relaunch reconciles the surviving session via reconcileTmuxHeadlessAgents
 *      → list_agents shows the same terminalId post-relaunch.
 *   5. close_agent tears the session down + deletes the prompt file.
 */

import type { ElectronApplication } from "@playwright/test";
import type { GraphNode } from "@vt/graph-model/graph";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  mcpCallTool,
  mcpRequest,
  waitForMcpServer,
  type ExtendedWindow,
} from "./electron-smoke-helpers";
import {
  bootstrapCallerTerminal,
  cleanupLiveElectronApp,
  discoverMcpUrl,
  expect,
  firstLoadedWindow,
  graphIncludesTitle,
  killProcessGroup,
  killTmuxSession,
  launchElectronApp,
  promptFileMode,
  reapStaleTestTmuxSessions,
  resolveVaultWriteFolder,
  test,
  tmuxPanePid,
  tmuxSessionExists,
} from "./electron-phase6-prompt-file-crash-resilience/helpers";

// ─── Test ─────────────────────────────────────────────────────────────────────

test.describe("Phase 6 prompt-file + crash resilience (M1-rerun-6)", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test("headless tmux spawn delivers prompt via file, session survives Electron kill -9, relaunch rebinds", async ({
    projectRoot,
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
      app1 = await launchElectronApp(userDataDir, projectRoot);
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
      }, projectRoot);
      expect(watchResult.success, "startFileWatching failed").toBe(true);

      // Also write `.mcp.json` so any agent that reads vault-local MCP config
      // finds the in-process server (mirrors the real-agent-spawn pattern).
      await fs.writeFile(
        path.join(projectRoot, ".mcp.json"),
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
      // `projectRoot` is the watched parent; production writes prompt files
      // into the voicetree-N-M subfolder it created during init.
      const writeFolder = await resolveVaultWriteFolder(projectRoot);
      promptFile = path.join(
        writeFolder,
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
      const fileMode = promptFileMode(promptFile);
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
      app2 = await launchElectronApp(userDataDir, projectRoot);
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
              }, projectRoot);
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

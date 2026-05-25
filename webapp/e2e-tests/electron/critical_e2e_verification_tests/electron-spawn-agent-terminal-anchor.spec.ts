import { expect } from "@playwright/test";
import * as fs from "fs/promises";
import {
  REPO_ROOT,
  type ExtendedWindow,
  expectNoCriticalElectronErrors,
} from "./electron-smoke-helpers";
import {
  cleanupAnchorTestTerminals,
  type RpcAccess,
  test,
  readAnchorState,
} from "./electron-anchor-test-fixtures";
import {
  getBearerToken,
  getDaemonRpcUrl,
  rpcCallTool,
} from "./helpers/e2e-rpc-helpers";

test.describe("spawn_agent terminal anchoring", () => {
  test.describe.configure({ timeout: process.env.CI ? 120_000 : 90_000 });

  test("anchors the spawned interactive terminal to the new task node", async ({
    appWindow,
    fixtureVaultPath,
    electronDiagnostics,
  }) => {
    let rpc: RpcAccess | null = null;
    const callerTerminalId = "e2e-anchor-caller";
    let spawnedTerminalId: string | null = null;

    try {
      rpc = {
        rpcUrl: await getDaemonRpcUrl(appWindow),
        token: await getBearerToken(appWindow),
      };

      const watchResult = await appWindow.evaluate(async (projectRoot) => {
        const api = (window as ExtendedWindow).electronAPI;
        if (!api) throw new Error("electronAPI not available");
        return await api.main.startFileWatching(projectRoot);
      }, fixtureVaultPath);
      expect(watchResult.success).toBe(true);

      await expect
        .poll(
          async () => {
            return await appWindow.evaluate(async () => {
              const api = (window as ExtendedWindow).electronAPI;
              if (!api) throw new Error("electronAPI not available");
              const graph = await api.main.getGraph();
              return Object.keys(graph.nodes).length;
            });
          },
          {
            message:
              "Waiting for graph state after explicit file watching start",
            timeout: 15_000,
            intervals: [250, 500, 1000],
          },
        )
        .toBeGreaterThan(0);

      const parentNodeId = await appWindow.evaluate(async () => {
        const api = (window as ExtendedWindow).electronAPI;
        if (!api) throw new Error("electronAPI not available");
        const graph = await api.main.getGraph();
        const nodeIds = Object.keys(graph.nodes);
        if (nodeIds.length === 0) throw new Error("No graph nodes loaded");
        return nodeIds[0];
      });

      const callerSpawn = await appWindow.evaluate(
        async ({ callerTerminalId, parentNodeId }) => {
          const api = (window as ExtendedWindow).electronAPI;
          if (!api?.terminal)
            throw new Error("electronAPI.terminal not available");
          return await api.terminal.spawn({
            type: "Terminal",
            terminalId: callerTerminalId,
            attachedToContextNodeId: parentNodeId,
            terminalCount: 0,
            title: "E2E Anchor Caller",
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
            agentName: callerTerminalId,
            worktreeName: undefined,
            isHeadless: false,
          });
        },
        { callerTerminalId, parentNodeId },
      );
      expect(callerSpawn.success).toBe(true);

      await expect
        .poll(
          async () => {
            const listResult = await rpcCallTool(
              rpc!.rpcUrl,
              rpc!.token,
              "list_agents",
              {},
            );
            const agents = (
              listResult.parsed as { agents: Array<{ terminalId: string }> }
            ).agents;
            return agents.some(
              (agent) => agent.terminalId === callerTerminalId,
            );
          },
          {
            message:
              "Waiting for caller terminal to register before /rpc spawn_agent",
            timeout: 10_000,
            intervals: [250, 500, 1000],
          },
        )
        .toBe(true);

      const spawnResult = await rpcCallTool(rpc.rpcUrl, rpc.token, "spawn_agent", {
        task: "E2E spawned terminal anchor task",
        parentNodeId,
        callerTerminalId,
        agentName: "Fake Agent",
        spawnDirectory: REPO_ROOT,
        depthBudget: 0,
        headless: false,
      });
      expect(
        spawnResult.parsed,
        `spawn_agent failed: ${JSON.stringify(spawnResult.parsed, null, 2)}`,
      ).toMatchObject({ success: true });

      const spawnPayload = spawnResult.parsed as {
        terminalId: string;
        taskNodeId: string;
      };
      expect(spawnPayload.terminalId).toBeTruthy();
      expect(spawnPayload.taskNodeId).toBeTruthy();
      spawnedTerminalId = spawnPayload.terminalId;

      await appWindow.evaluate((nodeId) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error("Cytoscape not initialized");
        const previousTimer = (
          window as unknown as { __anchorRemovalTimer?: number }
        ).__anchorRemovalTimer;
        if (previousTimer) window.clearInterval(previousTimer);
        const removeRenderedTaskNode = () => {
          cy.remove(cy.getElementById(nodeId));
        };
        removeRenderedTaskNode();
        const timer = window.setInterval(removeRenderedTaskNode, 50);
        (
          window as unknown as { __anchorRemovalTimer?: number }
        ).__anchorRemovalTimer = timer;
        window.setTimeout(() => {
          window.clearInterval(timer);
          (
            window as unknown as { __anchorRemovalTimer?: number }
          ).__anchorRemovalTimer = undefined;
        }, 4_000);
      }, spawnPayload.taskNodeId);

      await expect
        .poll(
          async () => {
            return await appWindow.evaluate((nodeId) => {
              const cy = (window as unknown as ExtendedWindow)
                .cytoscapeInstance;
              return (cy?.getElementById(nodeId).length ?? 0) === 0;
            }, spawnPayload.taskNodeId);
          },
          {
            message:
              "Waiting for the task node to be absent from Cytoscape before spawn",
            timeout: 15_000,
            intervals: [250, 500, 1000],
          },
        )
        .toBe(true);

      await expect
        .poll(
          async () => {
            const state = await readAnchorState(
              appWindow,
              spawnPayload.terminalId,
              spawnPayload.taskNodeId,
            );
            return state.terminalExists;
          },
          {
            message:
              "Waiting for spawned terminal to appear while the task node is absent from Cytoscape",
            timeout: 15_000,
            intervals: [250, 500, 1000],
          },
        )
        .toBe(true);

      await appWindow.waitForTimeout(4_200);

      await fs.writeFile(
        spawnPayload.taskNodeId,
        `# E2E spawned terminal anchor task\n\nUpdated after spawn_agent so the watcher projects this task node back into Cytoscape.\n\n${Date.now()}\n`,
        "utf8",
      );

      await expect
        .poll(
          async () => {
            const state = await readAnchorState(
              appWindow,
              spawnPayload.terminalId,
              spawnPayload.taskNodeId,
            );
            return (
              state.taskNodeInCy &&
              state.terminalExists &&
              state.left !== "100px" &&
              state.top !== "100px" &&
              state.shadowExists &&
              state.edgeExists &&
              state.edgeSource === spawnPayload.taskNodeId &&
              state.edgeTarget ===
                `${spawnPayload.terminalId}-anchor-shadowNode`
            );
          },
          {
            message:
              "Waiting for spawned terminal to anchor after the task node re-enters Cytoscape",
            timeout: 30_000,
            intervals: [250, 500, 1000, 2000],
          },
        )
        .toBe(true);

      const anchorState = await readAnchorState(
        appWindow,
        spawnPayload.terminalId,
        spawnPayload.taskNodeId,
      );
      expect(anchorState).toMatchObject({
        taskNodeInCy: true,
        terminalExists: true,
        shadowExists: true,
        edgeExists: true,
        edgeSource: spawnPayload.taskNodeId,
        edgeTarget: `${spawnPayload.terminalId}-anchor-shadowNode`,
      });
      expect(anchorState.left).not.toBe("100px");
      expect(anchorState.top).not.toBe("100px");

      expectNoCriticalElectronErrors(electronDiagnostics);
    } finally {
      await cleanupAnchorTestTerminals(
        appWindow,
        rpc,
        [spawnedTerminalId, callerTerminalId],
        callerTerminalId,
      );
    }
  });
});

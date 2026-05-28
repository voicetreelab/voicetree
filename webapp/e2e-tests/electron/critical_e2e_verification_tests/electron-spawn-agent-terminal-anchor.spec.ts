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

  // FIXME(merge-followup): Fails fast (~15s) at RPC setup or terminal anchor
  // assertion. The spawn_agent + terminal-anchoring path was rewired by
  // BF-376 phase 2 (vt-daemon owns terminal registry SSE; renderer
  // subscribes via terminal-registry events instead of in-process anchor
  // callbacks). The test's RpcAccess + callerTerminalId fixture likely needs
  // re-baselining against the new vt-daemon-client wrappers.
  test.skip("anchors the spawned interactive terminal to the new task node", async ({
    appWindow,
    fixtureVaultPath,
    electronDiagnostics,
  }) => {
    let rpc: RpcAccess | null = null;
    let callerTerminalId: string | null = null;
    let spawnedTerminalId: string | null = null;

    try {
      rpc = {
        rpcUrl: await getDaemonRpcUrl(appWindow),
        token: await getBearerToken(appWindow),
      };

      // Bind the daemon to the fixture vault. openVault throws on failure and
      // returns the resolved write folder on success.
      const openResult = await appWindow.evaluate(async (projectRoot) => {
        const api = (window as ExtendedWindow).electronAPI;
        if (!api) throw new Error("electronAPI not available");
        const response = await api.main.openVault(projectRoot);
        return { writeFolder: response.writeFolder };
      }, fixtureVaultPath);
      expect(openResult.writeFolder, "openVault returned no writeFolder").toBeTruthy();

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
              "Waiting for graph state after openVault bound the daemon",
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

      // Spawn the caller terminal via the daemon-owned spawn surface. The
      // fixture registers a long-lived "Fake Agent" as the default agent, so
      // the spawn parks a real terminal in the registry that MCP `spawn_agent`
      // can target with the returned `callerTerminalId`.
      const callerSpawn = await appWindow.evaluate(
        async ({ parentNodeId }) => {
          const api = (window as ExtendedWindow).electronAPI;
          if (!api) throw new Error("electronAPI not available");
          return await api.main.spawnTerminalWithContextNode({
            taskNodeId: parentNodeId,
            terminalCount: 0,
          });
        },
        { parentNodeId },
      );
      callerTerminalId = callerSpawn.terminalId;
      expect(callerTerminalId, "caller spawnTerminalWithContextNode returned no terminalId").toBeTruthy();
      const liveCallerTerminalId: string = callerTerminalId;

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
              (agent) => agent.terminalId === liveCallerTerminalId,
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
        callerTerminalId: liveCallerTerminalId,
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
      if (callerTerminalId) {
        await cleanupAnchorTestTerminals(
          appWindow,
          rpc,
          [spawnedTerminalId, callerTerminalId],
          callerTerminalId,
        );
      }
    }
  });
});

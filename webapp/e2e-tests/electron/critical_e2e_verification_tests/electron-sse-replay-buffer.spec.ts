import { expect } from "@playwright/test";
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

test.describe("SSE replay buffer", () => {
  test("anchors terminal after SSE reconnect replays missed delta", async ({
    appWindow,
    fixtureVaultPath,
    electronDiagnostics,
  }) => {
    test.setTimeout(process.env.CI ? 120_000 : 90_000);
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
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (!api) throw new Error("electronAPI not available");
        const response = await api.main.openVault(projectRoot);
        return { writeFolder: response.writeFolder };
      }, fixtureVaultPath);
      expect(openResult.writeFolder, "openVault returned no writeFolder").toBeTruthy();

      await expect
        .poll(
          async () => {
            return await appWindow.evaluate(async () => {
              const api = (window as unknown as ExtendedWindow).electronAPI;
              if (!api) throw new Error("electronAPI not available");
              const graph = await api.main.getGraph();
              return Object.keys(graph.nodes).length;
            });
          },
          {
            message: "Waiting for graph state after openVault bound the daemon",
            timeout: 15_000,
            intervals: [250, 500, 1000],
          },
        )
        .toBeGreaterThan(0);

      // Pick the fixture's Root.md node deterministically by file path, instead
      // of relying on map iteration order. Node IDs are file paths in the
      // graph-db domain, so the fixture's Root.md surfaces as a suffix match.
      const parentNodeId = await appWindow.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (!api) throw new Error("electronAPI not available");
        const graph = await api.main.getGraph();
        const nodeIds = Object.keys(graph.nodes);
        const rootId = nodeIds.find(
          (id) =>
            id.endsWith("Root.md") || id.endsWith("/Root") || id === "Root.md",
        );
        if (!rootId)
          throw new Error(`No Root.md node loaded; got: ${nodeIds.join(", ")}`);
        return rootId;
      });

      // Spawn the caller terminal via the daemon-owned spawn surface. The
      // fixture registers a long-lived "Fake Agent" as the default agent, so
      // the spawn parks a real terminal in the registry that MCP `spawn_agent`
      // can target with the returned `callerTerminalId`.
      const callerSpawn = await appWindow.evaluate(
        async ({ parentNodeId }) => {
          const api = (window as unknown as ExtendedWindow).electronAPI;
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
            message: "Waiting for caller terminal to register",
            timeout: 10_000,
            intervals: [250, 500, 1000],
          },
        )
        .toBe(true);

      // Stop the main-process graph sync poller so the ONLY graph delivery
      // channel is SSE. Do not call stopFileWatching() here: that unloads the
      // active daemon/vault and leaves MCP spawn_agent without a write path.
      await appWindow.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (!api) throw new Error("electronAPI not available");
        await (
          api.main as Record<string, () => Promise<void>>
        ).__debugStopDaemonGraphSync();
      });

      // Lock SSE — drops the connection AND prevents auto-resubscription
      // (postDeltaThroughDaemon would otherwise silently reconnect SSE)
      await appWindow.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (!api) throw new Error("electronAPI not available");
        await (
          api.main as Record<string, () => Promise<void>>
        ).__debugLockSSE();
      });

      // Spawn agent while SSE is locked — deltas land in daemon replay buffer
      const spawnResult = await rpcCallTool(rpc.rpcUrl, rpc.token, "spawn_agent", {
        task: "E2E replay buffer regression task",
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

      // Wait for daemon to have the task node (confirms delta published while SSE was locked)
      await expect
        .poll(
          async () => {
            return await appWindow.evaluate(async (taskNodeId) => {
              const api = (window as unknown as ExtendedWindow).electronAPI;
              if (!api) throw new Error("electronAPI not available");
              const graph = await api.main.getGraph();
              return (
                taskNodeId in
                (
                  graph as Record<string, unknown> & {
                    nodes: Record<string, unknown>;
                  }
                ).nodes
              );
            }, spawnPayload.taskNodeId);
          },
          {
            message: "Waiting for daemon to register the spawned task node",
            timeout: 15_000,
            intervals: [250, 500, 1000],
          },
        )
        .toBe(true);

      // Capture the spawned terminal's pre-replay state as a baseline. The
      // task node and anchor edge must NOT exist in Cytoscape yet (file
      // watching stopped + SSE locked). The terminal's pre-replay position is
      // recorded so the post-replay position-change assertion is robust to
      // changes in the app's default un-anchored coordinates.
      const preReplayState = await readAnchorState(
        appWindow,
        spawnPayload.terminalId,
        spawnPayload.taskNodeId,
      );
      expect(
        preReplayState.taskNodeInCy,
        "Task node should not be in Cytoscape while SSE is locked",
      ).toBe(false);
      expect(
        preReplayState.edgeExists,
        "Anchor edge should not exist before SSE replay",
      ).toBe(false);

      // Unlock SSE, then trigger reconnection. The user-observable outcome we
      // are testing: a graph delta produced while SSE was disconnected becomes
      // visible (terminal anchors to its task node) after reconnection.
      await appWindow.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (!api) throw new Error("electronAPI not available");
        await (
          api.main as Record<string, () => Promise<void>>
        ).__debugUnlockSSE();
        await api.main.syncRendererSessionStateWithDaemon();
      });

      const expectedEdgeTarget = `${spawnPayload.terminalId}-anchor-shadowNode`;

      // Wait for the terminal to anchor (task node visible, shadow + edge wired
      // to the new task node, and the terminal has moved off its pre-replay
      // coordinates) after replay delivers the missed projected graph.
      await expect
        .poll(
          async () => {
            const state = await readAnchorState(
              appWindow,
              spawnPayload.terminalId,
              spawnPayload.taskNodeId,
            );
            const positionChanged =
              state.terminalExists &&
              (state.left !== preReplayState.left ||
                state.top !== preReplayState.top);
            return (
              state.taskNodeInCy &&
              positionChanged &&
              state.shadowExists &&
              state.edgeExists &&
              state.edgeSource === spawnPayload.taskNodeId &&
              state.edgeTarget === expectedEdgeTarget
            );
          },
          {
            message:
              "Waiting for terminal to anchor after SSE replay delivers the missed delta",
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
        edgeTarget: expectedEdgeTarget,
      });
      // The terminal's on-screen position must have changed from its pre-replay
      // baseline - that is the user-visible result of anchoring to the new node.
      expect(
        anchorState.left !== preReplayState.left ||
          anchorState.top !== preReplayState.top,
        `Terminal position should change after anchoring; pre=(${preReplayState.left},${preReplayState.top}) post=(${anchorState.left},${anchorState.top})`,
      ).toBe(true);

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

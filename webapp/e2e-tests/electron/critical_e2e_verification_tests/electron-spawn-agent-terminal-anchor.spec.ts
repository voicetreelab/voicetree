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
} from "./electron-anchor-test-fixtures";
import {
  getBearerToken,
  getDaemonRpcUrl,
  rpcCallTool,
} from "./helpers/e2e-rpc-helpers";

type WireOption<T> =
  | { readonly _tag: "Some"; readonly value: T }
  | { readonly _tag: "None" };

type WireTerminalRecord = {
  readonly terminalId: string;
  readonly terminalData: {
    readonly anchoredToNodeId: WireOption<string>;
  };
};

async function fetchTerminalRecords(
  rpc: RpcAccess,
): Promise<readonly WireTerminalRecord[]> {
  const result = await rpcCallTool(
    rpc.rpcUrl,
    rpc.token,
    "getTerminalRecords",
    {},
  );
  // `getTerminalRecords` returns a JSON-stringified `TerminalRecord[]` —
  // normaliseRpcResult unwraps the MCP envelope and parses it as a single
  // object whose shape is `{ "0": rec0, "1": rec1, ... }` only when the
  // payload was an array (JSON.parse(JSON.stringify([...])) is still an
  // array — the wrapper preserves arrays).
  return result.parsed as unknown as readonly WireTerminalRecord[];
}

function findAnchoredRecord(
  records: readonly WireTerminalRecord[],
  terminalId: string,
): WireTerminalRecord | undefined {
  return records.find((record) => record.terminalId === terminalId);
}

test.describe("spawn_agent terminal anchoring", () => {
  test.describe.configure({ timeout: process.env.CI ? 120_000 : 90_000 });

  test("anchors the spawned interactive terminal to the new task node", async ({
    appWindow,
    fixtureProjectPath,
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

      // Bind the daemon to the fixture project. openProject throws on failure and
      // returns the resolved write folder path on success.
      const openResult = await appWindow.evaluate(async (projectRoot) => {
        const api = (window as ExtendedWindow).hostAPI;
        if (!api) throw new Error("hostAPI not available");
        const response = await api.main.openProject(projectRoot);
        return { writeFolderPath: response.writeFolderPath };
      }, fixtureProjectPath);
      expect(openResult.writeFolderPath, "openProject returned no writeFolderPath").toBeTruthy();

      await expect
        .poll(
          async () => {
            return await appWindow.evaluate(async () => {
              const api = (window as ExtendedWindow).hostAPI;
              if (!api) throw new Error("hostAPI not available");
              const graph = await api.main.getGraph();
              return Object.keys(graph.nodes).length;
            });
          },
          {
            message:
              "Waiting for graph state after openProject bound the daemon",
            timeout: 15_000,
            intervals: [250, 500, 1000],
          },
        )
        .toBeGreaterThan(0);

      const parentNodeId = await appWindow.evaluate(async () => {
        const api = (window as ExtendedWindow).hostAPI;
        if (!api) throw new Error("hostAPI not available");
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
          const api = (window as ExtendedWindow).hostAPI;
          if (!api) throw new Error("hostAPI not available");
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

      // `spawn_agent` resolves the caller via `listTerminalRecords()`, which
      // omits the `pending` state. We must wait until the caller graduates
      // from pending to a full registry record before invoking spawn_agent.
      await expect
        .poll(
          async () => {
            const records = await fetchTerminalRecords(rpc!);
            return records.some(
              (record) => record.terminalId === liveCallerTerminalId,
            );
          },
          {
            message:
              "Waiting for caller terminal record (non-pending) before /rpc spawn_agent",
            timeout: 30_000,
            intervals: [250, 500, 1000, 2000],
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

      // BF-376 phase 2: the daemon owns the terminal registry. The
      // public anchor surface is `TerminalRecord.terminalData.anchoredToNodeId`
      // (fp-ts Option, wire-encoded as `{ _tag: 'Some'|'None', value? }`).
      // Poll `getTerminalRecords` until the spawned terminal appears with
      // its anchor set to the freshly created task node — this is the
      // exact contract the renderer's anchor projection consumes.
      await expect
        .poll(
          async () => {
            const records = await fetchTerminalRecords(rpc!);
            const record = findAnchoredRecord(records, spawnPayload.terminalId);
            if (!record) return null;
            const anchor = record.terminalData.anchoredToNodeId;
            return anchor._tag === "Some" ? anchor.value : null;
          },
          {
            message:
              "Waiting for spawned terminal record with anchoredToNodeId == taskNodeId",
            timeout: 30_000,
            intervals: [250, 500, 1000, 2000],
          },
        )
        .toBe(spawnPayload.taskNodeId);

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

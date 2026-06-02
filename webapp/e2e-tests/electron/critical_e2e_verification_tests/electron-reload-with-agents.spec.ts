import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  type ExtendedWindow,
  expectNoCriticalElectronErrors,
  pollForCytoscape,
} from "./electron-smoke-helpers";
import { test } from "./electron-anchor-test-fixtures";

/**
 * Reloading the renderer while agents are running must reload the graph and
 * re-anchor every terminal with a clean console.
 *
 * Regression guard for the graph-view double-mount: onProjectReady flipped to
 * 'graph-view' before openProject's await set the sessionId, so the view
 * mounted with no session then tore down and remounted — churning cy
 * (destroyed-cy crashes), orphaning the loading overlay, and racing terminal
 * launches (duplicate shadow nodes / "Failed to create floating terminal").
 *
 * This drives the exact manual vt-debug loop deterministically: spawn fake
 * agents, reload, then assert on the post-reload __vtDebug__ buffer (the
 * renderer ring buffer lives in renderer memory, so reload() scopes it to the
 * reload's startup — no before/after diffing needed).
 */

const AGENT_COUNT = 2;

// Substrings that appeared in the buggy console. Asserted absent in addition to
// the blanket "no console.error" check, so a regression names itself in the
// failure message even if the blanket check were ever relaxed.
const REGRESSION_SIGNALS: readonly string[] = [
  "getCyInstance called before VoiceTreeGraphView render",
  "reading 'isHeadless'",
  "reading 'clear'",
  "synchronously unmount a root",
  "Failed to create floating terminal",
  "Can not create second element",
];

type ReloadConsoleReport = {
  readonly errors: string[];
  readonly exceptions: string[];
  readonly offenders: string[];
};

function countFloatingTerminals(page: Page): Promise<number> {
  return page.locator(".cy-floating-window-terminal").count();
}

async function loadingOverlayHidden(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const stuck = Array.from(document.querySelectorAll<HTMLElement>("*")).some(
      (el) =>
        el.textContent?.trim() === "Loading Voicetree..." &&
        el.offsetParent !== null,
    );
    return !stuck;
  });
}

/** Read the post-reload renderer debug buffer: console.errors, uncaught exceptions, named regressions. */
async function readReloadConsoleReport(
  page: Page,
  signals: readonly string[],
): Promise<ReloadConsoleReport> {
  return page.evaluate((regressionSignals) => {
    type ConsoleMsg = { level: string; args: unknown[]; atIso: string };
    type ExceptionMsg = { message: string };
    const debug = (
      window as unknown as {
        __vtDebug__?: {
          console: () => ConsoleMsg[];
          exceptions: () => ExceptionMsg[];
        };
      }
    ).__vtDebug__;
    if (!debug) {
      return {
        errors: ["__vtDebug__ not present — debug surface missing"],
        exceptions: [],
        offenders: [],
      };
    }
    const consoleMsgs = debug.console();
    const serialized = JSON.stringify(consoleMsgs);
    return {
      errors: consoleMsgs
        .filter((m) => m.level === "error")
        .map((m) => JSON.stringify(m.args).slice(0, 300)),
      exceptions: debug.exceptions().map((e) => e.message),
      offenders: regressionSignals.filter((s) => serialized.includes(s)),
    };
  }, signals);
}

test.describe("reload with active agents", () => {
  test.describe.configure({ timeout: process.env.CI ? 150_000 : 120_000 });

  test("reload re-anchors all terminals with zero renderer console errors", async ({
    appWindow,
    electronDiagnostics,
  }) => {
    // ── Arrange: spawn AGENT_COUNT fake-agent terminals on the root node ──
    const parentNodeId = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).hostAPI;
      if (!api) throw new Error("hostAPI not available");
      const graph = await api.main.getGraph();
      const nodeIds = Object.keys(graph.nodes);
      if (nodeIds.length === 0) throw new Error("No graph nodes loaded");
      return nodeIds[0];
    });

    for (let i = 0; i < AGENT_COUNT; i++) {
      const spawned = await appWindow.evaluate(
        async ({ taskNodeId, terminalCount }) => {
          const api = (window as ExtendedWindow).hostAPI;
          if (!api) throw new Error("hostAPI not available");
          return api.main.spawnTerminalWithContextNode({
            taskNodeId,
            terminalCount,
          });
        },
        { taskNodeId: parentNodeId, terminalCount: i },
      );
      expect(spawned.terminalId, "spawn returned no terminalId").toBeTruthy();
    }

    await expect
      .poll(() => countFloatingTerminals(appWindow), {
        message: `Waiting for ${AGENT_COUNT} floating terminals before reload`,
        timeout: 30_000,
        intervals: [250, 500, 1000, 2000],
      })
      .toBe(AGENT_COUNT);

    // ── Act: the operation that was broken ──
    await appWindow.reload();
    await appWindow.waitForLoadState("domcontentloaded");

    // ── Assert: graph + every terminal reload cleanly ──
    await pollForCytoscape(appWindow);
    await expect
      .poll(() => countFloatingTerminals(appWindow), {
        message: `Waiting for ${AGENT_COUNT} terminals to re-anchor after reload`,
        timeout: 45_000,
        intervals: [250, 500, 1000, 2000],
      })
      .toBe(AGENT_COUNT);
    await expect
      .poll(() => loadingOverlayHidden(appWindow), {
        message: "Loading overlay must clear after reload",
        timeout: 30_000,
        intervals: [250, 500, 1000, 2000],
      })
      .toBe(true);

    // ── Assert: no renderer errors in the reload's console ──
    const report = await readReloadConsoleReport(appWindow, REGRESSION_SIGNALS);
    expect(report.exceptions, "uncaught renderer exceptions after reload").toEqual([]);
    expect(report.offenders, "known regression signals after reload").toEqual([]);
    expect(report.errors, "renderer console.error entries after reload").toEqual([]);

    expectNoCriticalElectronErrors(electronDiagnostics);
  });
});

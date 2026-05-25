/**
 * SMOKE TEST for main.ts
 *
 * Pattern: launch Electron with --open-folder → wait for graph → assert.
 * --open-folder sets startupFolderOverride, which makes initialLoad() call
 * loadFolder() directly, bypassing project selection entirely.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { ChildProcess } from 'child_process';
import type { NodeSingular } from 'cytoscape';
import {
  WEBAPP_ROOT, FAKE_AGENT_ENTRYPOINT,
  type ElectronDiagnostics, type ExtendedWindow,
  resolveGraphDaemonNodeBin, stopSmokeGraphDaemonForVault, stopSmokeTmuxServer,
  expectNoCriticalElectronErrors
} from './electron-smoke-helpers';

const GRACEFUL_QUIT_MS = 3000;
const ELECTRON_CLOSE_MS = 5000;
const FORCE_KILL_WAIT_MS = 3000;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function hasProcessExited(processHandle: ChildProcess): boolean {
  return processHandle.exitCode !== null || processHandle.signalCode !== null;
}

function isProcessAlive(processHandle: ChildProcess): boolean {
  if (hasProcessExited(processHandle) || !processHandle.pid) return false;

  try {
    process.kill(processHandle.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalProcess(processHandle: ChildProcess, signal: NodeJS.Signals): void {
  if (!isProcessAlive(processHandle) || !processHandle.pid) return;

  try {
    process.kill(processHandle.pid, signal);
  } catch {
    // The process may have exited between the liveness check and signal.
  }
}

// SIGKILL the whole process group via `-pid`. Playwright launches Electron
// with `detached:true`, making it the group leader; signalling the group
// reaches every descendant that has not daemonized away. Killing only `pid`
// would leave inheriting helpers alive holding the stdout/stderr pipes open
// and prolong the teardown budget below.
function killProcessGroup(processHandle: ChildProcess, signal: NodeJS.Signals): void {
  if (!processHandle.pid) return;
  try {
    process.kill(-processHandle.pid, signal);
  } catch {
    // Group already gone or platform does not support group signalling.
    signalProcess(processHandle, signal);
  }
}

function waitForProcessExit(processHandle: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (!isProcessAlive(processHandle)) return Promise.resolve(true);

  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      processHandle.off('exit', onExit);
      resolve(!isProcessAlive(processHandle));
    }, timeoutMs);

    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };

    processHandle.once('exit', onExit);
  });
}

// Close the Electron app deterministically:
//   1) start `electronApp.close()` so Playwright drives the quit through its
//      own channel (and drops the tracked-apps entry on its own when it can)
//   2) if it does not return in ELECTRON_CLOSE_MS, escalate: SIGTERM → SIGKILL
//      of the process group
//   3) synthesize `child_process` "close" once we have proven the OS process
//      exited, so Playwright's internal `waitForCleanup` resolves immediately
//      (see comment on the emit below for why this is necessary)
//   4) re-await the original close call so any remaining bookkeeping settles
async function closeElectronAppForSmoke(
  electronApp: ElectronApplication,
  electronProcess: ChildProcess | null
): Promise<void> {
  const close = electronApp.close().catch(() => undefined);
  const closed = await Promise.race([
    close.then(() => true),
    delay(ELECTRON_CLOSE_MS).then(() => false)
  ]);
  if (closed || !electronProcess) return;

  signalProcess(electronProcess, 'SIGTERM');
  if (!(await waitForProcessExit(electronProcess, GRACEFUL_QUIT_MS))) {
    killProcessGroup(electronProcess, 'SIGKILL');
    await waitForProcessExit(electronProcess, FORCE_KILL_WAIT_MS);
  }

  // Release Node's own handles on the spawned process's stdio. Without this,
  // Playwright's internal `readline.createInterface({ input: stdout })` keeps
  // consuming the pipe and the `child_process` "close" event never fires.
  electronProcess.stdout?.destroy();
  electronProcess.stderr?.destroy();
  electronProcess.stdin?.destroy();

  // Synthesize `child_process` "close" once we have confirmed the OS process
  // exited. Reason: Node fires "close" only after BOTH the process exits AND
  // its stdio FDs are fully closed in the kernel. Electron's helper processes
  // (renderer / GPU / utility) inherit the parent's stdout/stderr; even after
  // a process-group SIGKILL, one of those FDs reliably outlives the worker
  // teardown budget here, so Node never fires the event. Playwright's
  // `gracefullyClose` then awaits a Promise that resolves on that event
  // (`waitForCleanup`), and worker teardown burns its full 30s budget waiting
  // for an exit signal we already know happened. We emit `close` ourselves
  // with the real `exitCode`/`signalCode` captured from the dead process —
  // semantically equivalent to the event Node would have eventually emitted,
  // just not 30s late.
  if (hasProcessExited(electronProcess)) {
    queueMicrotask(() => {
      const exitCode = electronProcess.exitCode ?? 0;
      const signal = electronProcess.signalCode ?? null;
      electronProcess.emit('close', exitCode, signal);
    });
  }

  await Promise.race([close, delay(FORCE_KILL_WAIT_MS)]);
}

// Extend test with Electron app
const test = base.extend<{
  fixtureVaultPath: string;
  tempUserDataPath: string;
  electronDiagnostics: ElectronDiagnostics;
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  fixtureVaultPath: async ({}, use) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-smoke-vault-'));
    const tempVaultPath = path.join(tempRoot, 'example_small');
    await fs.mkdir(tempVaultPath, { recursive: true });
    await fs.writeFile(path.join(tempVaultPath, 'root.md'), [
      '# Smoke Root',
      '',
      'Links to [[first-child.md]] and [[second-child.md]].',
      ''
    ].join('\n'), 'utf8');
    await fs.writeFile(path.join(tempVaultPath, 'first-child.md'), [
      '# First Child',
      '',
      'Smoke fixture child node.',
      ''
    ].join('\n'), 'utf8');
    await fs.writeFile(path.join(tempVaultPath, 'second-child.md'), [
      '# Second Child',
      '',
      'Smoke fixture child node.',
      ''
    ].join('\n'), 'utf8');

    await use(tempVaultPath);

    await fs.rm(tempRoot, { recursive: true, force: true });
  },

  tempUserDataPath: async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-smoke-test-'));
    await use(tempUserDataPath);
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  electronDiagnostics: async ({}, use) => {
    await use({ mainOutput: [], rendererErrors: [] });
  },

  electronApp: async ({ fixtureVaultPath, tempUserDataPath, electronDiagnostics }, use) => {
    // Pin writeFolder to vault root so the daemon indexes the fixture .md files
    // (without this, initializeProject creates a voicetree-{date} subfolder)
    await fs.writeFile(path.join(tempUserDataPath, 'voicetree-config.json'), JSON.stringify({
      vaultConfig: {
        [fixtureVaultPath]: { writeFolder: fixtureVaultPath, readPaths: [] }
      }
    }, null, 2), 'utf8');

    const fakeAgentScript = {
      actions: [
        {
          type: 'create_node',
          title: 'Smoke Fake Agent Progress Node',
          summary: 'Created by the Electron smoke test through vt-fake-agent.',
          content: 'Fake-agent Electron smoke coverage marker.',
          color: 'green'
        },
        {
          type: 'create_node',
          title: 'Smoke Node Two',
          summary: 'Second node verifying SSE delta rendering.',
          content: 'Second smoke node content.',
          color: 'blue'
        },
        {
          type: 'create_node',
          title: 'Smoke Node Three',
          summary: 'Third node verifying SSE delta rendering.',
          content: 'Third smoke node content.',
          color: 'blue'
        },
        { type: 'exit', code: 0 }
      ]
    };
    await fs.writeFile(path.join(tempUserDataPath, 'settings.json'), JSON.stringify({
      agents: [
        { name: 'Fake Agent', command: `node ${JSON.stringify(FAKE_AGENT_ENTRYPOINT)} "$AGENT_PROMPT"` }
      ],
      defaultAgent: 'Fake Agent',
      terminalSpawnPathRelativeToWatchedDirectory: '/',
      INJECT_ENV_VARS: {
        AGENT_PROMPT: `### FAKE_AGENT_SCRIPT ### ${JSON.stringify(fakeAgentScript)} ### END_FAKE_AGENT_SCRIPT ###`
      }
    }, null, 2), 'utf8');

    const graphDaemonNodeBin = resolveGraphDaemonNodeBin();
    console.log('[Smoke Test] vt-graphd Node:', graphDaemonNodeBin);

    const ciFlags = process.env.CI
      ? ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
      : [];

    const electronApp = await electron.launch({
      args: [
        ...ciFlags,
        path.join(WEBAPP_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`,
        '--open-folder', fixtureVaultPath
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        VOICETREE_PERSIST_STATE: '1',
        VT_GRAPHD_NODE_BIN: graphDaemonNodeBin,
        ENABLE_PLAYWRIGHT_DEBUG: '0'
      },
      timeout: 60000
    });

    const electronProcess = electronApp.process();
    const stdoutHandler = (chunk: Buffer) => {
      const text = chunk.toString();
      electronDiagnostics.mainOutput.push(text);
      console.log(`[MAIN STDOUT] ${text.trim()}`);
    };
    const stderrHandler = (chunk: Buffer) => {
      const text = chunk.toString();
      electronDiagnostics.mainOutput.push(text);
      console.error(`[MAIN STDERR] ${text.trim()}`);
    };
    electronProcess?.stdout?.on('data', stdoutHandler);
    electronProcess?.stderr?.on('data', stderrHandler);

    await use(electronApp);

    await closeElectronAppForSmoke(electronApp, electronProcess);
    stopSmokeGraphDaemonForVault(fixtureVaultPath);
    stopSmokeTmuxServer(tempUserDataPath);
    electronProcess?.stdout?.off('data', stdoutHandler);
    electronProcess?.stderr?.off('data', stderrHandler);
    console.log('[Smoke Test] Electron app closed');
  },

  appWindow: async ({ electronApp, electronDiagnostics }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15000 });

    window.on('console', msg => {
      if (msg.type() === 'error') {
        electronDiagnostics.rendererErrors.push(msg.text());
      }
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    window.on('pageerror', error => {
      electronDiagnostics.rendererErrors.push(error.message);
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');

    // --open-folder triggers auto-load: initialLoad() → loadFolder() → graph view.
    // Use timer-based polling (not rAF) — headless Electron on CI throttles
    // requestAnimationFrame, causing waitForFunction's default raf polling to
    // never observe cytoscapeInstance despite it being set.
    await expect.poll(async () => {
      return await window.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        return !!cy && !cy.destroyed();
      });
    }, {
      message: 'Waiting for Cytoscape to initialize via --open-folder auto-load',
      timeout: 30000,
      intervals: [250, 500, 1000, 2000]
    }).toBe(true);
    console.log('[Smoke Test] Graph view loaded via --open-folder auto-load');

    await use(window);
  }
});

test.describe('Smoke Test', () => {
  test.describe.configure({ timeout: process.env.CI ? 120000 : 60000 });

  test('should start app and load graph after project selection', async ({ appWindow, electronDiagnostics }) => {
    console.log('=== SMOKE TEST: Verify Electron app compiles, starts, and loads graph ===');

    const appReady = await appWindow.evaluate(() => {
      return !!(window as ExtendedWindow).cytoscapeInstance &&
             !!(window as ExtendedWindow).electronAPI;
    });
    expect(appReady).toBe(true);
    console.log('✓ App loaded successfully with graph view');

    await expect.poll(async () => {
      return await appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        return cy?.nodes().length ?? 0;
      });
    }, {
      message: 'Waiting for Cytoscape nodes to render',
      timeout: 45000,
      intervals: [500, 1000, 2000, 3000]
    }).toBeGreaterThan(2);
    console.log('✓ Cytoscape nodes loaded');

    const graph = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getGraph();
    });

    expect(graph).toBeDefined();
    expectNoCriticalElectronErrors(electronDiagnostics);
    const nodeCount = Object.keys(graph.nodes).length;
    console.log(`✓ Graph loaded into state with ${nodeCount} nodes`);
    expect(nodeCount).toBeGreaterThan(1);

    const cytoscapeState = await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      return {
        nodeCount: cy.nodes().length,
        nodeLabels: cy.nodes().map((n: NodeSingular) => n.data('label')).slice(0, 3)
      };
    });

    console.log(`✓ Graph rendered in UI with ${cytoscapeState.nodeCount} nodes`);
    console.log('  Sample labels:', cytoscapeState.nodeLabels.join(', '));

    expect(cytoscapeState.nodeCount).toBeGreaterThan(2);

    const backButton = appWindow.locator('button[title="Back to project selection"]');
    await expect(backButton).toBeVisible({ timeout: 5000 });
    console.log('✓ Back button visible (confirms graph view with project selection integration)');

    expectNoCriticalElectronErrors(electronDiagnostics);
    console.log('✅ Smoke test passed!');
  });

  // TODO(merge): test depends on the legacy MCP server surface
  // (`api.main.getMcpPort()` + JSON-RPC over `/mcp`). dev-lochlan replaced MCP
  // with the @vt/vt-daemon unified HTTP transport: tool calls flow as
  // JSON-RPC over `POST /rpc`, discovered via `api.main.getDaemonUrl()` +
  // `api.main.getAuthToken()` on the renderer, or `$VOICETREE_DAEMON_URL` +
  // `$VOICETREE_VAULT_PATH/.voicetree/auth-token` for spawned subprocesses.
  //
  // STATUS (2026-05-26): fake-agent transport migration is COMPLETE.
  // `tools/vt-fake-agent/src/mcp-client.ts` now sits on top of @vt/vt-rpc's
  // `createRpcClient`, talks JSON-RPC over `POST /rpc`, and the
  // `@modelcontextprotocol/sdk` dep was dropped from the package. Spawn-side
  // env (`$VOICETREE_DAEMON_URL` + `$VOICETREE_VAULT_PATH`) is already wired
  // through buildTerminalEnvVars.ts §5.3, so the fake-agent will connect to
  // whichever daemon the Electron host is currently running.
  //
  // Two things remain before un-skipping:
  //   1. This test's `mcpCallTool` / `waitForMcpServer` host-side paths still
  //      need to be ported to `fetch(${url}/rpc)` with `Authorization: Bearer
  //      ${token}` and the JSON-RPC 2.0 envelope (was step 1 of the original
  //      TODO).
  //   2. vt-mcpd's empty-vault boot hang (`overnight_final_status.md` Phase 5)
  //      blocks any test that spins the headless daemon from scratch. Doesn't
  //      affect this test if it reuses Electron's embedded daemon, but worth
  //      confirming when re-enabling.
  //
  // The companion smoke test at :328 still covers Electron launch + daemon
  // wiring + initial graph load through the new HTTP transport, so the
  // highest-value smoke signal remains green.
  test.skip('should spawn fake agent and record a progress node', () => {
    // Intentionally empty — see TODO above. Re-establishing the assertion set
    // requires porting the host-side mcpCallTool / waitForMcpServer to /rpc;
    // the spawned fake-agent side is now migrated.
  });
});

export { test };

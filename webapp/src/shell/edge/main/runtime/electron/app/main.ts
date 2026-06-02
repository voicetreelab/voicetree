/// <reference types="node" />
import {app, BrowserWindow, ipcMain, nativeImage} from 'electron';
import electronUpdater, {type UpdateCheckResult} from 'electron-updater';
import log from 'electron-log';
import {isAbsolute, join} from 'node:path';
import {setupApplicationMenu} from '@/shell/edge/main/runtime/electron/app/application-menu';
import {StubTextToTreeServerManager} from '@/shell/edge/main/runtime/electron/server/StubTextToTreeServerManager';
import {RealTextToTreeServerManager} from '@/shell/edge/main/runtime/electron/server/RealTextToTreeServerManager';
import {getVoicetreeHomePath} from '@/shell/edge/main/runtime/state/app-electron-state';
import {existsSync} from 'node:fs';
import {getAuthToken, getDaemonUrl, unbindVtDaemon} from '@/shell/edge/main/runtime/electron/daemon/daemon-url-binding';
import {installVtDaemonEventsBridge} from '@/shell/edge/main/runtime/electron/daemon/events/vtDaemonEventsBridge';
import {installVtTerminalAttachBridge, type VtTerminalAttachBridgeHandle} from '@/shell/edge/main/runtime/electron/daemon/terminals/vtTerminalAttachBridge';
import {rehydrateTerminalPanels} from '@/shell/edge/main/agent/terminals/rehydrateTerminalPanels';
import {getMainWindow} from '@/shell/edge/main/runtime/state/app-electron-state';
import type {TerminalRecord} from '@vt/vt-daemon-client';
import {getBuildConfig} from '@/shell/edge/main/runtime/electron/app/build-config';
import path from 'path';
import {setupOnboardingDirectory} from '@/shell/edge/main/runtime/electron/startup/onboarding-setup';
import {runUserDataMigrationAtStartup} from '@/shell/edge/main/runtime/electron/startup/user-data-migration';
import {prewarmGraphdRuntimeCommand} from '@/shell/edge/main/runtime/electron/startup/prewarm-graphd-runtime';
import {startNotificationScheduler, stopNotificationScheduler} from '@/shell/edge/main/runtime/electron/startup/notification-scheduler';
import {createAgentCompletionNotifier} from '@/shell/edge/main/runtime/electron/daemon/lifecycle/agent-completion-notifier';
import {migrateLayoutConfigIfNeeded, migrateStarredFoldersIfNeeded, migrateStarredFoldersBrainRename} from '@/shell/edge/main/settings/settings_IO';
import {setBackendPort} from '@/shell/edge/main/runtime/state/app-electron-state';
import {
    refreshUnclaimedTmuxSessions,
    startUnclaimedTmuxSessionPolling,
    stopUnclaimedTmuxSessionPolling,
} from '@/shell/edge/main/agent/terminals/unclaimed-tmux-session-sync';
import {
    refreshRecoverySessions,
    startRecoverySessionPolling,
    stopRecoverySessionPolling,
} from '@/shell/edge/main/agent/terminals/recovery-session-sync';
import {uiAPI} from '@/shell/edge/main/runtime/ui-api-proxy';
import {setupRPCHandlers} from '@/shell/edge/main/runtime/edge-auto-rpc/rpc-handler';
import {registerGraphIpcHandlers} from '@/shell/edge/main/runtime/electron/daemon/ipc/graph-ipc-handlers';
import {cleanupOrphanedContextNodes} from '@/shell/edge/main/workspace/saveNodePositions';
import {validateStartupCwd} from '@/shell/edge/main/runtime/electron/startup/startup-diagnostics';
import {subscribeToTerminalRegistryCache} from '@/shell/edge/main/agent/terminals/terminal-registry-bridge';
import {configureEnvironment} from './environment-config';
import {setupAutoUpdater} from './auto-updater-setup';
import {appResource, createWindow, stopTrackpadMonitoring} from './create-window';
import {initializeGraphModel} from '@/shell/edge/main/runtime/electron/daemon/lifecycle/graph-model-init';
import {registerInstance, unregisterInstance} from './instance-discovery';
import {killOrphanVtGraphdDaemons, subscribeOwnerDiagnostics} from '@vt/graph-db-client';
import {tracing, observabilityMetrics} from '@vt/observability';
import {perfProbeFromEnv} from '@vt/perf-analysis/perf-probe';
import {startAppMetricsSampler, type AppMetricsSampler} from '@/shell/edge/main/observability/appMetricsSampler';
import {shutdownActiveDaemonConnection} from '@/shell/edge/main/runtime/electron/daemon/lifecycle/graph-daemon';
import {stopDaemonGraphSync} from '@/shell/edge/main/runtime/electron/daemon/sync/daemon-watch-sync';
import {unsubscribeFromDaemonSSE} from '@/shell/edge/main/runtime/electron/daemon/sync/daemon-sse-subscription';
import {unsubscribeFromTerminalRegistrySse} from '@/shell/edge/main/runtime/electron/daemon/sync/terminal-registry-sse-subscription';
import {installQuitLifecycleHandlers} from './quit-lifecycle';

// Swallow EPIPE on stdout/stderr so writes after the parent terminal closes
// don't become uncaughtException dialogs (which loop because SSE-driven
// graph syncs keep writing load-timing lines after the dialog is dismissed).
for (const stream of [process.stdout, process.stderr] as const) {
    stream.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code !== 'EPIPE') throw err;
    });
}

// Redirect all console.* to electron-log in production (handles EPIPE errors on Linux AppImage)
// Writes asynchronously to ~/Library/Logs/Voicetree/ (macOS) or ~/.config/Voicetree/logs/ (Linux)
if (app.isPackaged) {
    Object.assign(console, log.functions);
}

// ============================================================================
// Startup
// ============================================================================

// Initialize @vt/graph-model DI before any graph-model functions are called
initializeGraphModel();

// Note: vt-daemon's tool server runs out-of-process inside the per-project VTD
// child. The in-process `configureMcpServer` call that used to live here
// wired in-process bridges (`getMcpGraph`, `getLiveStateBridge`, …) against
// vt-daemon's module-level state. After BF-375/BF-376 those bridges are
// consumed only by the vtd binary's own `configureHeadlessMcpBridges` —
// webapp's in-process copy was a no-op.

const {autoUpdater} = electronUpdater;

function pinProcessVoicetreeHomePath(): void {
    // Normalize the global VoiceTree home once so Electron, daemon, CLI
    // helpers, and spawned agents inherit the same settings/config root.
    if (process.env.VOICETREE_HOME_PATH) return;
    process.env.VOICETREE_HOME_PATH = getVoicetreeHomePath();
}

/**
 * Verifies the build-config-supplied `voicetree-cli` package directory
 * ships a `bin/vt` script; returns the absolute `bin/` directory or null
 * when missing. The packaged Electron build can omit the CLI — null is
 * the no-op signal (PATH is left untouched).
 */
function resolveLocalVtBinDir(): string | null {
    const cliPkg: string | null = getBuildConfig().voicetreeCliPackageDir;
    if (cliPkg === null || cliPkg.length === 0 || !isAbsolute(cliPkg)) return null;
    const binDir: string = join(cliPkg, 'bin');
    return existsSync(join(binDir, 'vt')) ? binDir : null;
}

// Surface the resolved bin dir on the environment so daemon-spawned shells can
// inherit it through their child env (the daemon also resolves its own, but
// Electron's PATH still wants the CLI on it for menu actions like "open
// terminal here").
const electronVtBinDir: string | null = resolveLocalVtBinDir();
if (electronVtBinDir !== null) {
    process.env.PATH = `${electronVtBinDir}${path.delimiter}${process.env.PATH ?? ''}`;
}

// Point the daemon runtime resolver at the bundled standalone Node ≥22 in
// packaged builds. vtd and vt-graphd need node:sqlite and must not run on
// Electron's node (architecture.md); the packaged app ships its own node under
// Resources/node/. Set on Electron-main, this propagates to every resolver: the
// graphd resolver reads it directly, and it is inherited by the spawned vtd
// (which uses the same resolver for its own host and for the graphd it spawns).
// build-config returns null in dev/unpackaged, where the resolver falls back to
// a `node` on PATH. An explicit override (launcher/test) wins — we only fill the gap.
const graphdNodeBinaryPath: string | null = getBuildConfig().graphdNodeBinaryPath;
if (graphdNodeBinaryPath !== null && process.env.VT_GRAPHD_NODE_BIN === undefined) {
    process.env.VT_GRAPHD_NODE_BIN = graphdNodeBinaryPath;
}

configureEnvironment();
// Pin the VoiceTree home before tracing so it (and the daemon/CLI it spawns)
// share one settings root. The OTLP gRPC exporter only attaches when
// VOICETREE_OTLP_ENDPOINT is present — set by the ensure-perf-stack preflight
// that wraps `npm run electron(:prod)`; absent it, only the NDJSON exporter
// runs. tracing.init reads this once at startup, so the env must already be set
// by the launching process (it is: the preflight exports it before spawn).
pinProcessVoicetreeHomePath();
tracing.init('vt-electron-main', {
    otlpEndpoint: process.env.VOICETREE_OTLP_ENDPOINT,
    instanceId: process.env.VOICETREE_RUN_INSTANCE_ID,
});
// Metrics share the same resource (service.instance.id = run id) as tracing so
// renderer-probe MELTs forwarded via recordRendererTelemetry and the GPU-process
// sampler below export through ONE provider. No-op when VOICETREE_OTLP_ENDPOINT
// is absent (returns inert meters), so the normal app pays nothing.
observabilityMetrics.init('vt-electron-main', {
    otlpEndpoint: process.env.VOICETREE_OTLP_ENDPOINT,
    instanceId: process.env.VOICETREE_RUN_INSTANCE_ID,
});
tracing.bridgeOwnerDiagnostics(subscribeOwnerDiagnostics, 'vt-electron-daemon');

// Start the perf probe at the tier the launcher selected (ensure-perf-stack sets
// VOICETREE_PERF_TIER=lite for interactive runs; storm runs set deep; PERF_STACK=0
// leaves it unset → no-op). Lite emits wall/CPU profiles + runtime metrics — the
// metrics are what populate the VT Runs dashboard. Electron keeps the event loop
// alive so the probe's beforeExit self-stop never fires; we stop it explicitly on
// will-quit so Pyroscope flushes and the durable log closes.
let stopPerfProbe: (() => Promise<void>) | undefined;
perfProbeFromEnv('vt-electron-main').then(
    (stop) => { stopPerfProbe = stop; },
    // Profiling is best-effort: a probe failure (e.g. Pyroscope unreachable)
    // must never take down app startup — log and continue uninstrumented.
    (err: unknown) => { log.warn(`[perf-probe] failed to start: ${err instanceof Error ? err.message : String(err)}`); },
);
validateStartupCwd();
setupAutoUpdater(autoUpdater, () => isQuitting, (v: boolean) => { isQuitting = v; });

// Global manager instances
// TextToTreeServer: Converts text input (voice/typed) to markdown tree structure
// Select implementation based on environment (no fallbacks)
// USE_REAL_SERVER=1 forces real Python server even in test mode (for SSE E2E tests)
const useRealServer: boolean = process.env.USE_REAL_SERVER === '1';
const textToTreeServerManager: StubTextToTreeServerManager | RealTextToTreeServerManager =
    ((process.env.NODE_ENV === 'test' || process.env.HEADLESS_TEST === '1') && !useRealServer)
        ? new StubTextToTreeServerManager()
        : new RealTextToTreeServerManager();

// Store the TextToTreeServer port (set during app startup)
let textToTreeServerPort: number | null = null;

// Main-owned IPC bridges for the VTD /events stream (BF-367) and
// /terminals/:id/attach PTY relay (BF-368). The bearer token never enters
// the renderer process for either path — Main holds the WebSockets, the
// renderer drives them by opaque IPC handles. Bridges install ipcMain
// handlers eagerly; they tolerate the daemon being unbound at install time
// (the events client reschedules and the terminal-attach bridge only opens
// upstream WS on demand). Post-Phase-2 (BF-375): the bridges resolve the
// daemon URL + auth token via daemon-url-binding, which re-ensures the
// per-project VTD on every access.
const teardownVtDaemonEventsBridge: () => void = installVtDaemonEventsBridge({
    getMainWindow,
    getDaemonUrl,
    getAuthToken,
});
const vtTerminalAttachBridge: VtTerminalAttachBridgeHandle = installVtTerminalAttachBridge({
    getMainWindow,
    getDaemonUrl,
    getAuthToken,
});

// Rehydrate the floating terminal panels on demand. The renderer invokes this
// once its cytoscape view is mounted (every fresh load, including a Cmd+R
// reload) and again on every `project:ready`. Panels are derived from the
// durable terminal registry rather than the transient spawn-time
// `terminal-ui-launch` events, so reloading the UI no longer loses the panels
// for still-running agents. Idempotent (see rehydrateTerminalPanels).
ipcMain.handle('terminal:rehydrate', (): void => {
    rehydrateTerminalPanels();
});

// Bridge terminal-registry cache mutations (driven by SSE deltas + the
// project-open cold-start prime) to the renderer / completion notifier /
// recovery pollers. The local cache mirror is the canonical change
// source — agent-runtime is daemon-side post-BF-376.
const notifyOnCompletion: (records: readonly TerminalRecord[]) => void = createAgentCompletionNotifier();
subscribeToTerminalRegistryCache((records: readonly TerminalRecord[]): void => {
    uiAPI.syncTerminals(records);
    notifyOnCompletion(records);
    void refreshUnclaimedTmuxSessions().catch(() => undefined);
    void refreshRecoverySessions().catch(() => undefined);
});

// App event handlers
void app.whenReady().then(async () => {
    console.time('[Startup] Total time to window');

    // Migrate a returning 2.9.x user's durable config (settings.json, projects.json,
    // voicetree-config.json) from the old Electron userData dir to ~/.voicetree. This
    // MUST be the first awaited step: it has to win the race against the first
    // loadSettings(), which writes DEFAULT_SETTINGS at the new path on ENOENT and would
    // otherwise defeat the absent-at-new guard. Non-blocking and never throws.
    await runUserDataMigrationAtStartup();

    setupRPCHandlers();
    registerGraphIpcHandlers();
    setupApplicationMenu();

    // GPU/compositor CPU sampler — perf-probe runs only. app.getAppMetrics()
    // is the only in-process view of the GPU process's cost; the renderer
    // profile and a headless run cannot see it. Gated to VOICETREE_PERF_PROBE
    // with an OTLP endpoint so the normal app and non-perf tests never sample.
    if (process.env.VOICETREE_PERF_PROBE === '1' && (process.env.VOICETREE_OTLP_ENDPOINT ?? '').length > 0) {
        appMetricsSampler = startAppMetricsSampler({ getAppMetrics: () => app.getAppMetrics() });
        log.info('[Startup] started GPU/app-metrics sampler (perf-probe run)');
    }

    // The per-project VTD child is spawned (or adopted) on-demand by
    // openProject → bindVtDaemonForProject; tmux preflight / server ensure /
    // headless reconciliation all run inside the daemon at boot. The
    // lifecycle JSONL telemetry sink is installed by `vtd.ts:333` — Main
    // is a client and observes the events via the `terminal-registry`
    // SSE topic.

    // Register this instance for vt-debug discovery
    await registerInstance();

    // Reap leftover vt-graphd daemons whose project paths no longer exist (crashed
    // app, aborted test run). Skipping this lets stale daemons hold ports and
    // contend with the daemon a project-load is about to spawn.
    const orphanCleanup: ReturnType<typeof killOrphanVtGraphdDaemons> = killOrphanVtGraphdDaemons();
    if (orphanCleanup.killed.length > 0) {
        log.info('[Startup] Reaped orphan vt-graphd daemons', orphanCleanup.killed);
    }

    // Warm graphd's runtime-command cache off the first-spawn path: resolving the
    // Node runtime probes node:sqlite via spawnSync; doing it now (deferred, never
    // blocking) means the first project ensure / agent spawn hits a warm cache.
    prewarmGraphdRuntimeCommand();

    // Set dock icon for macOS (BrowserWindow icon property doesn't work on macOS)
    if (process.platform === 'darwin' && app.dock) {
        const dockIconPath: string = appResource('build', 'icon.png');
        const dockIcon: Electron.NativeImage = nativeImage.createFromPath(dockIconPath);
        app.dock.setIcon(dockIcon);
    }

    // Hide dock icon on macOS when running e2e-tests to prevent focus stealing
    if (process.env.MINIMIZE_TEST === '1' && process.platform === 'darwin' && app.dock) {
        app.dock.hide();
    }

    // Set up onboarding directory on first launch (skipped in test mode)
    console.time('[Startup] setupOnboardingDirectory');
    await setupOnboardingDirectory();
    console.timeEnd('[Startup] setupOnboardingDirectory');

    // Start the server and store the port it's using
    // Factory automatically chooses StubServer (test) or RealServer (production)
    console.time('[Startup] textToTreeServer.start');
    textToTreeServerPort = await textToTreeServerManager.start();
    console.timeEnd('[Startup] textToTreeServer.start');

    // Inject backend port into mainAPI
    setBackendPort(textToTreeServerPort);

    console.time('[Startup] createWindow');
    createWindow({isQuitting: () => isQuitting});

    // On a renderer reload (Cmd+R), the old page is torn down without running
    // its `terminal:detach` cleanup, orphaning the main-side attach clients and
    // leaving the tmux sessions falsely "claimed". Dispose them as the new
    // document begins loading; the fresh renderer then re-attaches via
    // `terminal:rehydrate`. The first load disposes an empty set (no-op).
    getMainWindow()?.webContents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame): void => {
        if (isMainFrame) vtTerminalAttachBridge.disposeAllClients();
    });

    startUnclaimedTmuxSessionPolling();
    startRecoverySessionPolling();
    console.timeEnd('[Startup] createWindow');
    console.timeEnd('[Startup] Total time to window');

    // Silently migrate layoutConfig nodeSpacing from old default (70) to new default (120)
    await migrateLayoutConfigIfNeeded();

    // Silently migrate starredFolders from empty array to include ~/brain/workflows
    await migrateStarredFoldersIfNeeded();
    // Silently migrate starredFolders entries from ~/voicetree/workflows to ~/brain/workflows
    await migrateStarredFoldersBrainRename();

    // Start re-engagement notification scheduler
    startNotificationScheduler();

    //console.log(`[AutoUpdate] CL Check`);
    log.info(`[AutoUpdate] Check)`);
    // Check for updates
    autoUpdater.checkForUpdatesAndNotify()
        .then((result: UpdateCheckResult | null) => {
            if (result) {
                log.info(`[AutoUpdate] Check result: ${result.updateInfo.version} (current: ${app.getVersion()})`);
            } else {
                log.info('[AutoUpdate] Check returned null (likely dev mode or no-op)');
            }
        })
        .catch((err: Error) => {
            log.error(`[AutoUpdate] Check failed: ${err.message}`);
        });
});

// Track if app is truly quitting (vs window close on macOS)
let isQuitting: boolean = false;
let appMetricsSampler: AppMetricsSampler | null = null;

// Handle hot reload and app quit scenarios
// IMPORTANT: before-quit fires on hot reload, window-all-closed does not
installQuitLifecycleHandlers({
    cleanupOrphanedContextNodes,
    setIsQuitting: (value: boolean): void => { isQuitting = value; },
    stopNotificationScheduler,
    stopRecoverySessionPolling,
    stopTextToTreeServer: (): void => { textToTreeServerManager.stop(); },
    stopTrackpadMonitoring,
    stopUnclaimedTmuxSessionPolling,
    unregisterInstance,
});

app.on('will-quit', () => {
    appMetricsSampler?.stop();
    // Stop daemon clients after windows have closed so position persistence can
    // finish while the daemon is still available.
    unsubscribeFromDaemonSSE();
    unsubscribeFromTerminalRegistrySse();
    void stopDaemonGraphSync();
    void shutdownActiveDaemonConnection();
    teardownVtDaemonEventsBridge();
    vtTerminalAttachBridge.teardown();
    void unbindVtDaemon();
    void stopPerfProbe?.();
});

app.on('activate', () => {
    void (async () => {
        const windows: BrowserWindow[] = BrowserWindow.getAllWindows();
        if (windows.length === 0) {
            // Restart server if it's not running (macOS dock click after window close)
            if (!textToTreeServerManager.isRunning()) {
                textToTreeServerPort = await textToTreeServerManager.start();
                // Inject backend port into mainAPI
                setBackendPort(textToTreeServerPort);
            }
            createWindow({isQuitting: () => isQuitting});
            startUnclaimedTmuxSessionPolling();
            startRecoverySessionPolling();
        } else {
            // Show the hidden window (macOS hide-on-close behavior)
            windows[0].show();
        }
    })();
});

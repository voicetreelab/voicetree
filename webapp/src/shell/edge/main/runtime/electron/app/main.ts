/// <reference types="node" />
import {app, BrowserWindow, dialog, nativeImage} from 'electron';
import * as O from 'fp-ts/lib/Option.js';
import electronUpdater, {type UpdateCheckResult} from 'electron-updater';
import log from 'electron-log';
import {setupApplicationMenu} from '@/shell/edge/main/runtime/electron/app/application-menu';
import {StubTextToTreeServerManager} from '@/shell/edge/main/runtime/electron/server/StubTextToTreeServerManager';
import {RealTextToTreeServerManager} from '@/shell/edge/main/runtime/electron/server/RealTextToTreeServerManager';
import {trace} from '@/shell/edge/main/observability/tracing/trace';
import {getOTLPReceiverPort as getOTLPReceiverPortForRuntime} from '@/shell/edge/main/observability/metrics/otlp-receiver';
import {getAppSupportPath} from '@/shell/edge/main/runtime/state/app-electron-state';
import {
    configureMcpServer,
    disableMcpJsonIntegration,
    getMcpPort,
    type McpServerHandle,
    registerChildIfMonitored,
    startMcpServer,
} from '@vt/voicetree-mcp';
import {
    terminalRuntimeSurface,
    type TerminalRecord,
} from '@/shell/edge/main/agent/terminals/terminalRuntimeSurface';
import {setupToolsDirectory, getToolsDirectory} from '@/shell/edge/main/runtime/electron/startup/tools-setup';
import {setupOnboardingDirectory} from '@/shell/edge/main/runtime/electron/startup/onboarding-setup';
import {startNotificationScheduler, stopNotificationScheduler} from '@/shell/edge/main/runtime/electron/startup/notification-scheduler';
import {createAgentCompletionNotifier} from '@/shell/edge/main/runtime/electron/daemon/lifecycle/agent-completion-notifier';
import {migrateAgentPromptCoreOnAppUpdateIfNeeded, migrateLayoutConfigIfNeeded, migrateStarredFoldersIfNeeded, migrateStarredFoldersBrainRename} from '@/shell/edge/main/settings/settings_IO';
import {setBackendPort} from '@/shell/edge/main/runtime/state/app-electron-state';
import {startOTLPReceiver, stopOTLPReceiver} from '@/shell/edge/main/observability/metrics/otlp-receiver';
import {registerTerminalIpcHandlers} from '@/shell/edge/main/agent/terminals/ipc-terminal-handlers';
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
import {applyLiveCommand} from '@/shell/edge/main/runtime/state/live-state-store';
import {
    getGraphFromDaemon,
    getLiveStateSnapshotFromDaemon,
    postDeltaThroughDaemonWithEditors,
} from '@/shell/edge/main/runtime/electron/daemon/ipc/daemon-ipc-proxy';
import {registerGraphIpcHandlers} from '@/shell/edge/main/runtime/electron/daemon/ipc/graph-ipc-handlers';
import {
    getWatchStatus,
    getVaultPaths,
    getWriteFolder,
} from '@/shell/edge/main/graph/watch_folder/watchFolder';
import {askQuery} from '@/shell/edge/main/runtime/backend-api';
import {cleanupOrphanedContextNodes} from '@/shell/edge/main/workspace/saveNodePositions';
import {validateStartupCwd} from '@/shell/edge/main/runtime/electron/startup/startup-diagnostics';
import {configureEnvironment} from './environment-config';
import {setupAutoUpdater} from './auto-updater-setup';
import {appResource, createWindow, stopTrackpadMonitoring} from './create-window';
import {initializeGraphModel} from '@/shell/edge/main/runtime/electron/daemon/lifecycle/graph-model-init';
import {registerInstance, unregisterInstance} from './instance-discovery';
import {killOrphanVtGraphdDaemons, subscribeOwnerDiagnostics} from '@vt/graph-db-client';
import {tracing} from '@vt/observability';
import {
    getDaemonClient,
    shutdownActiveDaemonConnection,
} from '@/shell/edge/main/runtime/electron/daemon/lifecycle/graph-daemon';
import {stopDaemonGraphSync} from '@/shell/edge/main/runtime/electron/daemon/sync/daemon-watch-sync';
import {unsubscribeFromDaemonSSE} from '@/shell/edge/main/runtime/electron/daemon/sync/daemon-sse-subscription';
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
tracing.init('vt-electron-main');
tracing.bridgeOwnerDiagnostics(subscribeOwnerDiagnostics, 'vt-electron-daemon');
validateStartupCwd();

// Initialize @vt/graph-model DI before any graph-model functions are called
initializeGraphModel();

// Wire @vt/voicetree-mcp late-bound bridges. Headless vt-mcpd will provide
// its own implementations (or omit, for tools that don't apply headlessly).
configureMcpServer({
    graph: {
        getGraph: async () => getGraphFromDaemon(),
        getVaultPaths,
        getWriteFolder: async () => {
            const writeFolder: O.Option<string> = await getWriteFolder();
            return O.isSome(writeFolder) ? writeFolder.value : null;
        },
        applyGraphDelta: (delta, recordForUndo) =>
            postDeltaThroughDaemonWithEditors(delta, recordForUndo),
        getProjectRoot,
        getUnseenNodesAroundContextNode: async (contextNodeId, searchFromNode) => {
            return await getActiveGraphDbClient().getUnseenNodesAroundContextNode(
                contextNodeId,
                searchFromNode,
            );
        },
    },
    liveState: {
        applyLiveCommand,
        getLiveStateSnapshot: getLiveStateSnapshotFromDaemon,
    },
    search: {
        askQuery,
    },
});

// Wire @vt/agent-runtime late-bound deps. Headless vt-mcpd will register its own.
terminalRuntimeSurface.configureAgentRuntime({
    env: {
        getAppSupportPath,
        getMcpPort,
        getOTLPReceiverPort: getOTLPReceiverPortForRuntime,
        getProjectRoot,
        getVaultPaths,
        getWriteFolder: async () => {
            const writeFolder: O.Option<string> = await getWriteFolder();
            return O.isSome(writeFolder) ? writeFolder.value : null;
        },
    },
    graph: {
        getGraph: async () => getGraphFromDaemon(),
        getVaultPaths: () => getVaultPaths(),
        getWriteFolder: () => getWriteFolder(),
        getProjectRoot,
        getWatchStatus,
        applyGraphDelta: (delta, recordForUndo) =>
            postDeltaThroughDaemonWithEditors(delta, recordForUndo),
        createContextNode: async (parentNodeId, semanticNodeIds) => {
            const result = await getActiveGraphDbClient().createContextNode(
                parentNodeId,
                [...(semanticNodeIds ?? [])],
            );
            return result.nodeId;
        },
        createContextNodeFromSelectedNodes: async (taskNodeId, selectedNodeIds) => {
            const result = await getActiveGraphDbClient().createContextNodeFromSelectedNodes(
                taskNodeId,
                selectedNodeIds,
            );
            return result.nodeId;
        },
        getUnseenNodesAroundContextNode: async (contextNodeId, searchFromNode) => {
            return await getActiveGraphDbClient().getUnseenNodesAroundContextNode(
                contextNodeId,
                searchFromNode,
            );
        },
        updateContextNodeContainedIds: async (contextNodeId, newNodeIds) => {
            await getActiveGraphDbClient().updateContextNodeContainedIds(contextNodeId, newNodeIds);
        },
    },
    trace,
    ui: {
        launchTerminalOntoUI: (nodeId, terminalData, skipFitAnimation) => {
            void uiAPI.launchTerminalOntoUI(nodeId, terminalData, skipFitAnimation);
        },
        closeTerminalById: (terminalId) => {
            uiAPI.closeTerminalById(terminalId);
        },
        logHookResult: (message: string) => {
            uiAPI.logHookResult(message);
        },
        registerChildIfMonitored,
    },
});

const {autoUpdater} = electronUpdater;

function getActiveGraphDbClient(): ReturnType<typeof getDaemonClient> {
    return getDaemonClient();
}

function pinProcessAppSupportPath(): void {
    process.env.VOICETREE_APP_SUPPORT = getAppSupportPath();
}

async function getProjectRoot(): Promise<string | null> {
    const status: {readonly isWatching: boolean; readonly directory: string | undefined} =
        await getWatchStatus();
    return status.directory ?? null;
}

configureEnvironment();
pinProcessAppSupportPath();
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
const terminalManager: ReturnType<typeof terminalRuntimeSurface.getTerminalManager> = terminalRuntimeSurface.getTerminalManager();

// Store the TextToTreeServer port (set during app startup)
let textToTreeServerPort: number | null = null;

// MCP server handle, captured so before-quit can close the HTTP listener.
// Without this, the open port keeps Node's event loop alive and the
// Electron process never exits after Cmd+Q.
let mcpHandle: McpServerHandle | null = null;

// Inject dependencies into mainAPI (must be done before IPC handler registration)
registerTerminalIpcHandlers(
    terminalManager,
    getToolsDirectory
);

// Bridge registry mutations to the renderer. Headless contexts skip this wiring.
const notifyOnCompletion: (records: readonly TerminalRecord[]) => void = createAgentCompletionNotifier();
terminalRuntimeSurface.subscribeToRegistry((records: TerminalRecord[]) => {
    uiAPI.syncTerminals(records);
    notifyOnCompletion(records);
    void refreshUnclaimedTmuxSessions().catch(() => undefined);
    void refreshRecoverySessions().catch(() => undefined);
});

// App event handlers
void app.whenReady().then(async () => {
    console.time('[Startup] Total time to window');

    setupRPCHandlers();
    registerGraphIpcHandlers();
    setupApplicationMenu();

    // Start MCP server in-process (shares graph state with Electron)
    try {
        await terminalRuntimeSurface.ensureTmuxAvailable();
        await terminalRuntimeSurface.ensureTmuxServer();
    } catch (error: unknown) {
        const message: string = error instanceof Error ? error.message : String(error);
        dialog.showErrorBox('Voicetree cannot start', message);
        app.exit(1);
        return;
    }
    mcpHandle = await startMcpServer();

    // Reconciliation runs on every vault open via `onVaultOpened` in
    // graph-model-init. Eagerly reconciling here from
    // `process.env.VOICETREE_VAULT_PATH` was redundant and used the wrong
    // signal (the env var historically pointed at `writeFolder`, not
    // `projectRoot`, which is precisely the divergence the recovery path-bug
    // fix removes).

    // Register this instance for vt-debug discovery
    await registerInstance();

    // Reap leftover vt-graphd daemons whose vault paths no longer exist (crashed
    // app, aborted test run). Skipping this lets stale daemons hold ports and
    // contend with the daemon a project-load is about to spawn.
    const orphanCleanup: ReturnType<typeof killOrphanVtGraphdDaemons> = killOrphanVtGraphdDaemons();
    if (orphanCleanup.killed.length > 0) {
        log.info('[Startup] Reaped orphan vt-graphd daemons', orphanCleanup.killed);
    }

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

    // Set up agent tools directory on first launch (skipped in test mode)
    console.time('[Startup] setupToolsDirectory');
    await setupToolsDirectory();
    console.timeEnd('[Startup] setupToolsDirectory');

    // Set up onboarding directory on first launch (skipped in test mode)
    console.time('[Startup] setupOnboardingDirectory');
    await setupOnboardingDirectory();
    console.timeEnd('[Startup] setupOnboardingDirectory');

    // Refresh the shipped AGENT_PROMPT_CORE once per app version, while preserving same-version edits.
    await migrateAgentPromptCoreOnAppUpdateIfNeeded(app.getVersion());

    // Start the server and store the port it's using
    // Factory automatically chooses StubServer (test) or RealServer (production)
    console.time('[Startup] textToTreeServer.start');
    textToTreeServerPort = await textToTreeServerManager.start();
    console.timeEnd('[Startup] textToTreeServer.start');

    // Inject backend port into mainAPI
    setBackendPort(textToTreeServerPort);

    console.time('[Startup] createWindow');
    createWindow({terminalManager, isQuitting: () => isQuitting});
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

    // Start OTLP receiver for Claude Code metrics (port 4318)
    await startOTLPReceiver();

    // Start re-engagement notification scheduler
    startNotificationScheduler();

    //console.log(`[AutoUpdate] CL Check`);
    log.info(`[AutoUpdate] Check)`);
    // Check for updates
    autoUpdater.checkForUpdatesAndNotify()
        .then((result: UpdateCheckResult | null) => {
            if (result) {
                //console.log(`[AutoUpdate] CL Check result: ${result.updateInfo.version} (current: ${app.getVersion()})`);
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

// Handle hot reload and app quit scenarios
// IMPORTANT: before-quit fires on hot reload, window-all-closed does not
installQuitLifecycleHandlers({
    cleanupOrphanedContextNodes,
    clearMcpHandle: (): void => { mcpHandle = null; },
    disableMcpJsonIntegration,
    getMcpHandle: (): McpServerHandle | null => mcpHandle,
    getTerminalRecords: terminalRuntimeSurface.getTerminalRecords,
    setIsQuitting: (value: boolean): void => { isQuitting = value; },
    stopNotificationScheduler,
    stopOTLPReceiver,
    stopRecoverySessionPolling,
    stopTextToTreeServer: (): void => { textToTreeServerManager.stop(); },
    stopTrackpadMonitoring,
    stopUnclaimedTmuxSessionPolling,
    terminalManager,
    unregisterInstance,
});

app.on('will-quit', () => {
    // Stop daemon clients after windows have closed so position persistence can
    // finish while the daemon is still available.
    unsubscribeFromDaemonSSE();
    void stopDaemonGraphSync();
    void shutdownActiveDaemonConnection();
});

app.on('activate', () => {
    void (async () => {
        const windows: BrowserWindow[] = BrowserWindow.getAllWindows();
        if (windows.length === 0) {
            // Restart server if it's not running (macOS dock click after window close)
            if (!textToTreeServerManager.isRunning()) {
                //console.log('[App] Reactivating - restarting server...');
                textToTreeServerPort = await textToTreeServerManager.start();
                //console.log(`[App] Server restarted on port ${textToTreeServerPort}`);
                // Inject backend port into mainAPI
                setBackendPort(textToTreeServerPort);
            }
            createWindow({terminalManager, isQuitting: () => isQuitting});
            startUnclaimedTmuxSessionPolling();
    startRecoverySessionPolling();
        } else {
            // Show the hidden window (macOS hide-on-close behavior)
            windows[0].show();
        }
    })();
});

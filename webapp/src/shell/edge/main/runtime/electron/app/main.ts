/// <reference types="node" />
import {app, BrowserWindow, nativeImage} from 'electron';
import path from 'path';
import * as O from 'fp-ts/lib/Option.js';
import electronUpdater, {type UpdateCheckResult} from 'electron-updater';
import log from 'electron-log';
import {setupApplicationMenu} from '@/shell/edge/main/runtime/electron/app/application-menu';
import {StubTextToTreeServerManager} from '@/shell/edge/main/runtime/electron/server/StubTextToTreeServerManager';
import {RealTextToTreeServerManager} from '@/shell/edge/main/runtime/electron/server/RealTextToTreeServerManager';
import {agentRuntime} from '@vt/agent-runtime';
import {trace} from '@/shell/edge/main/observability/tracing/trace';
import {getOTLPReceiverPort as getOTLPReceiverPortForRuntime} from '@/shell/edge/main/observability/metrics/otlp-receiver';
import {getAppSupportPath} from '@/shell/edge/main/runtime/state/app-electron-state';
import {
    configureMcpServer,
    disableMcpJsonIntegration,
    getMcpPort,
    registerChildIfMonitored,
    startMcpServer,
} from '@vt/voicetree-mcp';
import {setupToolsDirectory, getToolsDirectory} from '@/shell/edge/main/runtime/electron/startup/tools-setup';
import {setupOnboardingDirectory} from '@/shell/edge/main/runtime/electron/startup/onboarding-setup';
import {startNotificationScheduler, stopNotificationScheduler} from '@/shell/edge/main/runtime/electron/startup/notification-scheduler';
import {migrateAgentPromptCoreOnAppUpdateIfNeeded, migrateLayoutConfigIfNeeded, migrateStarredFoldersIfNeeded, migrateStarredFoldersBrainRename} from '@/shell/edge/main/settings/settings_IO';
import {setBackendPort} from '@/shell/edge/main/runtime/state/app-electron-state';
import {startOTLPReceiver, stopOTLPReceiver} from '@/shell/edge/main/observability/metrics/otlp-receiver';
import {registerTerminalIpcHandlers} from '@/shell/edge/main/agent/terminals/ipc-terminal-handlers';
import {type TerminalRecord} from '@vt/agent-runtime';
import {uiAPI} from '@/shell/edge/main/runtime/ui-api-proxy';
import {setupRPCHandlers} from '@/shell/edge/main/runtime/edge-auto-rpc/rpc-handler';
import {applyLiveCommand} from '@/shell/edge/main/runtime/state/live-state-store';
import {
    getGraphFromDaemon,
    getLiveStateSnapshotFromDaemon,
    postDeltaThroughDaemonWithEditors,
} from '@/shell/edge/main/runtime/electron/daemon/daemon-ipc-proxy';
import {
    getVaultPaths,
    getWritePath,
    setOnFolderSwitchCleanup,
} from '@/shell/edge/main/graph/watch_folder/watchFolder';
import {askQuery} from '@/shell/edge/main/runtime/backend-api';
import {cleanupOrphanedContextNodes} from '@/shell/edge/main/workspace/saveNodePositions';
import {validateStartupCwd} from '@/shell/edge/main/runtime/electron/startup/startup-diagnostics';
import {configureEnvironment} from './environment-config';
import {setupAutoUpdater} from './auto-updater-setup';
import {createWindow, stopTrackpadMonitoring} from './create-window';
import {initializeGraphModel} from '@/shell/edge/main/runtime/electron/daemon/graph-model-init';
import {registerInstance, unregisterInstance} from './instance-discovery';
import {killOrphanVtGraphdDaemons} from '@vt/graph-db-client';
import {
    getActiveDaemonConnection,
    shutdownActiveDaemonConnection,
} from '@/shell/edge/main/runtime/electron/daemon/graph-daemon';

// Redirect all console.* to electron-log in production (handles EPIPE errors on Linux AppImage)
// Writes asynchronously to ~/Library/Logs/Voicetree/ (macOS) or ~/.config/Voicetree/logs/ (Linux)
if (app.isPackaged) {
    Object.assign(console, log.functions);
}

// ============================================================================
// Startup
// ============================================================================
validateStartupCwd();

// Initialize @vt/graph-model DI before any graph-model functions are called
initializeGraphModel();

// Wire @vt/voicetree-mcp late-bound bridges. Headless vt-mcpd will provide
// its own implementations (or omit, for tools that don't apply headlessly).
configureMcpServer({
    graph: {
        getGraph: async () => getGraphFromDaemon(),
        getVaultPaths,
        getWritePath: async () => {
            const writePath: O.Option<string> = await getWritePath();
            return O.isSome(writePath) ? writePath.value : null;
        },
        applyGraphDelta: (delta, recordForUndo) =>
            postDeltaThroughDaemonWithEditors(delta, recordForUndo),
        getProjectRootWatchedDirectory: () => getActiveDaemonConnection()?.vault ?? null,
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
agentRuntime.configureAgentRuntime({
    env: {
        getAppSupportPath,
        getMcpPort,
        getOTLPReceiverPort: getOTLPReceiverPortForRuntime,
        getProjectRootWatchedDirectory: () => getActiveDaemonConnection()?.vault ?? null,
        getVaultPaths,
        getWritePath: async () => {
            const writePath: O.Option<string> = await getWritePath();
            return O.isSome(writePath) ? writePath.value : null;
        },
    },
    graph: {
        getGraph: async () => getGraphFromDaemon(),
        getVaultPaths: () => getVaultPaths(),
        getWritePath: () => getWritePath(),
        getProjectRootWatchedDirectory: () => getActiveDaemonConnection()?.vault ?? null,
        getWatchStatus: () => ({
            isWatching: (getActiveDaemonConnection()?.vault ?? null) !== null,
            directory: getActiveDaemonConnection()?.vault ?? undefined,
        }),
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

function getActiveGraphDbClient(): NonNullable<ReturnType<typeof getActiveDaemonConnection>>['client'] {
    const activeConnection = getActiveDaemonConnection();
    if (!activeConnection) {
        throw new Error('Graph daemon client is not active. Open a vault before using graph operations.');
    }
    return activeConnection.client;
}

configureEnvironment();
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
const terminalManager: ReturnType<typeof agentRuntime.getTerminalManager> = agentRuntime.getTerminalManager();

// Store the TextToTreeServer port (set during app startup)
let textToTreeServerPort: number | null = null;

// Inject dependencies into mainAPI (must be done before IPC handler registration)
registerTerminalIpcHandlers(
    terminalManager,
    getToolsDirectory
);

// Bridge registry mutations to the renderer. Headless contexts skip this wiring.
agentRuntime.subscribeToRegistry((records: TerminalRecord[]) => {
    uiAPI.syncTerminals(records);
});

// Register terminal cleanup for when folders are switched
setOnFolderSwitchCleanup(() => {
    //console.log('[main] Cleaning up terminals on folder switch');
    terminalManager.cleanup();
});

// App event handlers
void app.whenReady().then(async () => {
    console.time('[Startup] Total time to window');

    setupRPCHandlers();
    setupApplicationMenu();

    // Start MCP server in-process (shares graph state with Electron)
    await startMcpServer();

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
        const dockIconPath: string = path.join(__dirname, '../../build/icon.png');
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
app.on('before-quit', () => {
    isQuitting = true;
    //console.log('[App] before-quit event - cleaning up resources...');
    // Remove instance file so vt-debug stops discovering this pid
    unregisterInstance();

    // Clean up server process
    textToTreeServerManager.stop();

    // Clean up graph daemon process
    void shutdownActiveDaemonConnection();

    // Clean up all terminals
    terminalManager.cleanup();

    // Clean up orphaned context nodes (fire-and-forget, best effort on quit)
    void cleanupOrphanedContextNodes();

    // Remove stale .mcp.json so external agents don't connect to a dead port
    void disableMcpJsonIntegration();

    // Stop OTLP receiver
    void stopOTLPReceiver();

    // Stop notification scheduler
    stopNotificationScheduler();

    // Stop trackpad monitoring
    stopTrackpadMonitoring();
});

app.on('window-all-closed', () => {
    // Server cleanup moved to before-quit only to allow macOS to keep server running when window closes
    // This prevents the "worst of both worlds" where app stays in dock but server is dead

    // TODO: terminalManager.cleanup() should maybe also be moved to before-quit only,
    // but it's complicated because the graph renderer (which hosts terminal UI-edge) is destroyed
    // when the window closes, so terminals lose their renderer connection anyway
    terminalManager.cleanup();

    if (process.platform !== 'darwin') {
        app.quit();
    }
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
        } else {
            // Show the hidden window (macOS hide-on-close behavior)
            windows[0].show();
        }
    })();
});

/// <reference types="node" />
import {BrowserWindow, screen} from 'electron';
import path from 'path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {agentRuntime, type getTerminalManager} from '@vt/agent-runtime';
import {cleanupTerminalsForWindow} from '@/shell/edge/main/agent/terminals/terminal-window-tracker';
import {setMainWindow} from '@/shell/edge/main/runtime/state/app-electron-state';
import {uiAPI} from '@/shell/edge/main/runtime/ui-api-proxy';
import {recordAppUsage} from '@/shell/edge/main/runtime/electron/startup/notification-scheduler';
import {registerDebugAutoSetup} from '@/shell/edge/main/runtime/electron/startup/debug-auto-setup';
import {writeCurrentPositionsThroughDaemon} from '@/shell/edge/main/runtime/electron/daemon/daemon-graph-queries';
import {setDaemonGraphSyncTier, type AppActivityTier} from '@/shell/edge/main/runtime/electron/daemon/daemon-watch-sync';

const DEBUG_AUTO_SETUP_SHOW_TIMEOUT_MS: number = 15000;
const appRuntimeDir: string = path.dirname(fileURLToPath(import.meta.url));

/** Resolve a path relative to the webapp package root in both dev and packaged builds. */
export function appResource(...segments: string[]): string {
    // Compiled main bundle lives at <webapp-root>/dist-electron/main/index.js, so
    // appRuntimeDir is two levels below webapp-root in every launch mode (electron-vite
    // dev, e2e smoke via dist-electron, packaged asar). app.getAppPath() is not
    // reliable here — per build-config.ts:89-91 it returns dist-electron/main when
    // running the built version, which breaks loadFile/icon resolution.
    // Use appRuntimeDir (from import.meta.url) — __dirname is undefined in ESM bundle.
    return path.join(appRuntimeDir, '..', '..', ...segments);
}

async function waitForDebugAutoSetup(autoSetupComplete: Promise<void> | null): Promise<void> {
    if (!autoSetupComplete) {
        return;
    }

    await Promise.race([
        autoSetupComplete,
        new Promise<void>((resolve) => {
            setTimeout(resolve, DEBUG_AUTO_SETUP_SHOW_TIMEOUT_MS);
        })
    ]);
}

// Conditionally load trackpad detection (macOS only, optional dependency).
// The main bundle is ESM (webapp package "type": "module"), so the bare
// `require()` left in by rollup for externalized modules throws
// ReferenceError at runtime. Use createRequire to get a real CJS require.
const nativeRequire = createRequire(import.meta.url);
let trackpadDetect: { startMonitoring: () => boolean; stopMonitoring: () => void; isTrackpadScroll: () => boolean } | null = null;
if (process.platform === 'darwin') {
    try {
        trackpadDetect = nativeRequire('electron-trackpad-detect');
    } catch {
        console.warn('[Main] electron-trackpad-detect not available');
    }
}

/** Stop trackpad monitoring (called on app quit). */
export function stopTrackpadMonitoring(): void {
    if (trackpadDetect) {
        trackpadDetect.stopMonitoring();
    }
}

/**
 * Create the main BrowserWindow, load the appropriate content (dev server
 * or production dist), wire up macOS hide-on-close, terminal cleanup,
 * trackpad detection, and focus tracking.
 */
export function createWindow(deps: {
    terminalManager: ReturnType<typeof getTerminalManager>;
    isQuitting: () => boolean;
}): void {
    // Note: BrowserWindow icon property only works on Windows/Linux
    // macOS uses app.dock.setIcon() instead
    const iconPath: string = process.platform === 'darwin'
        ? appResource('build', 'icon.png')
        : appResource('build', 'icon.png');

    // Get full screen dimensions (work area excludes dock/taskbar)
    const primaryDisplay: Electron.Display = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    const mainWindow: BrowserWindow = new BrowserWindow({
        width: screenWidth,
        height: screenHeight,
        show: false,
        ...(process.platform !== 'darwin' && {icon: iconPath}),
        // macOS: extend web content into title bar (traffic lights remain visible)
        // Requires -webkit-app-region: drag in CSS for draggable areas
        ...(process.platform === 'darwin' && {titleBarStyle: 'hiddenInset'}),
        ...(process.env.MINIMIZE_TEST === '1' && {
            focusable: false,
            skipTaskbar: true
        }),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(appRuntimeDir, '../preload/index.js')
        }
    });

    // Capture window ID before it gets destroyed
    const windowId: number = mainWindow.webContents.id;

    // Set global main window reference (used by handlers)
    setMainWindow(mainWindow);

    const debugAutoSetupComplete: Promise<void> | null = registerDebugAutoSetup(mainWindow);

    // Pipe renderer console logs to electron terminal
    mainWindow.webContents.on('console-message', (_event, _level, message, _line, _sourceId) => {
        // Filter out Electron security warnings in dev mode
        if (message.includes('Electron Security Warning')) return;

        // const levels: string[] = ['LOG', 'WARNING', 'ERROR'];
        // const levelName: string = levels[level] || 'LOG';

        try {
            //console.log(`[Renderer ${levelName}] ${message} (${sourceId}:${line})`);
        } catch (error) {
            // Silently ignore EPIPE errors when stdout/stderr is closed
            // This can happen when the terminal that launched Electron is closed
            if ((error as NodeJS.ErrnoException).code !== 'EPIPE') {
                // Re-throw non-EPIPE errors
                throw error;
            }
        }
    });

    // Load the app
    const skipDevTools: boolean = process.env.ENABLE_PLAYWRIGHT_DEBUG === '1';
    if (process.env.MINIMIZE_TEST === '1') {
        void mainWindow.loadFile(appResource('dist', 'index.html'));
    } else if (process.env.ELECTRON_RENDERER_URL) {
        // electron-vite dev mode — ELECTRON_RENDERER_URL is set by electron-vite with the actual port
        console.log('[Main] Renderer URL:', process.env.ELECTRON_RENDERER_URL);
        void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
        if (!skipDevTools) mainWindow.webContents.openDevTools();
    } else {
        // Production or test mode
        void mainWindow.loadFile(appResource('dist', 'index.html'));
    }

    // Control window visibility after content is ready
    mainWindow.once('ready-to-show', () => {
        void (async () => {
            await waitForDebugAutoSetup(debugAutoSetupComplete);

            if (process.env.MINIMIZE_TEST === '1') {
                // For e2e-tests: show window without stealing focus, then minimize
                mainWindow.showInactive();
                mainWindow.hide() // THIS IS THE FINAL THING THAT ACTUALLY WORKED?????????
                // mainWindow.minimize(); // THIS IS ANNOYING IT CAUSES VISUAL ANMIATION
            } else {
                mainWindow.show();
            }
        })();
    });

    let windowFocused = true;

    function recomputeAndApplyTier(): void {
        const tier: AppActivityTier = windowFocused
            ? 'active'
            : agentRuntime.getTerminalRecords().some(r => r.status === 'running') ? 'background' : 'idle';
        setDaemonGraphSyncTier(tier);
    }

    mainWindow.on('focus', () => {
        windowFocused = true;
        void recordAppUsage();
        recomputeAndApplyTier();
    });

    mainWindow.on('blur', () => {
        windowFocused = false;
        recomputeAndApplyTier();
    });

    agentRuntime.subscribeToRegistry(() => {
        if (!windowFocused) recomputeAndApplyTier();
    });

    let persistedPositionsBeforeClose: boolean = false;

    // macOS: Hide window instead of destroying on close (red X button)
    // This preserves state (terminals, editors, graph) for quick reopen from dock
    // Cmd+Q or menu Quit will still fully quit the app via before-quit event
    mainWindow.on('close', (event) => {
        if (process.platform === 'darwin' && !deps.isQuitting()) {
            event.preventDefault();
            mainWindow.hide();
            return;
        }

        if (deps.isQuitting() && !persistedPositionsBeforeClose) {
            event.preventDefault();
            persistedPositionsBeforeClose = true;
            void writeCurrentPositionsThroughDaemon()
                .catch((error: unknown) => {
                    console.warn('[Main] Failed to persist node positions before quit:', error);
                })
                .finally(() => {
                    mainWindow.destroy();
                });
        }
    });

    // Clean up terminals when window closes
    mainWindow.on('closed', () => {
        cleanupTerminalsForWindow(deps.terminalManager, windowId);
        // Persist node positions to .voicetree/positions.json before exit
        if (!persistedPositionsBeforeClose) {
            void writeCurrentPositionsThroughDaemon().catch((error: unknown) => {
                console.warn('[Main] Failed to persist node positions on window close:', error);
            });
        }
    });

    // Trackpad detection using native addon (macOS only)
    // Uses NSEvent.hasPreciseScrollingDeltas - the authoritative signal for trackpad vs mouse
    if (trackpadDetect) {
        // Start monitoring scroll events for trackpad detection
        const monitoringStarted: boolean = trackpadDetect.startMonitoring();
        if (monitoringStarted) {
            console.log('[Main] Trackpad scroll detection enabled');
        }

        // Listen for scroll wheel events and update trackpad state
        mainWindow.webContents.on('input-event', (_, input) => {
            if (input.type === 'mouseWheel') {
                // Query the native addon for whether this was a trackpad scroll
                // The addon monitors NSEvent and stores the hasPreciseScrollingDeltas value
                const isTrackpad: boolean = trackpadDetect!.isTrackpadScroll();
                uiAPI.setIsTrackpadScrolling(isTrackpad);
            }
        });
    }
}

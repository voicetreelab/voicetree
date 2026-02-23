/// <reference types="node" />
import {BrowserWindow, screen} from 'electron';
import path from 'path';
import type {getTerminalManager} from '@/shell/edge/main/terminals/terminal-manager-instance';
import {setMainWindow} from '@/shell/edge/main/state/app-electron-state';
import {uiAPI} from '@/shell/edge/main/ui-api-proxy';
import {writeAllPositionsSync} from '@/shell/edge/main/graph/writeAllPositionsOnExit';
import {getGraph} from '@/shell/edge/main/state/graph-store';
import {getProjectRootWatchedDirectory} from '@/shell/edge/main/state/watch-folder-store';
import {recordAppUsage} from './notification-scheduler';

// Conditionally load trackpad detection (macOS only, optional dependency)
let trackpadDetect: { startMonitoring: () => boolean; stopMonitoring: () => void; isTrackpadScroll: () => boolean } | null = null;
if (process.platform === 'darwin') {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        trackpadDetect = require('electron-trackpad-detect');
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
        ? path.join(__dirname, '../../build/icon.png')
        : path.join(__dirname, '../../build/icon.png');

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
            preload: path.join(__dirname, '../preload/index.js')
        }
    });

    // Capture window ID before it gets destroyed
    const windowId: number = mainWindow.webContents.id;

    // Set global main window reference (used by handlers)
    setMainWindow(mainWindow);

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
        void mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
    } else if (process.env.ELECTRON_RENDERER_URL) {
        // electron-vite dev mode — ELECTRON_RENDERER_URL is set by electron-vite with the actual port
        console.log('[Main] Renderer URL:', process.env.ELECTRON_RENDERER_URL);
        void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
        if (!skipDevTools) mainWindow.webContents.openDevTools();
    } else {
        // Production or test mode
        void mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
    }

    // Control window visibility after content is ready
    mainWindow.once('ready-to-show', () => {
        if (process.env.MINIMIZE_TEST === '1') {
            // For e2e-tests: show window without stealing focus, then minimize
            mainWindow.showInactive();
            mainWindow.hide() // THIS IS THE FINAL THING THAT ACTUALLY WORKED?????????
            // mainWindow.minimize(); // THIS IS ANNOYING IT CAUSES VISUAL ANMIATION
        } else {
            mainWindow.show();
        }
    });

    // Track user activity for re-engagement notifications
    mainWindow.on('focus', () => {
        void recordAppUsage();
    });

    // macOS: Hide window instead of destroying on close (red X button)
    // This preserves state (terminals, editors, graph) for quick reopen from dock
    // Cmd+Q or menu Quit will still fully quit the app via before-quit event
    mainWindow.on('close', (event) => {
        if (process.platform === 'darwin' && !deps.isQuitting()) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    // Clean up terminals when window closes
    mainWindow.on('closed', () => {
        deps.terminalManager.cleanupForWindow(windowId);
        // Persist node positions to .voicetree/positions.json before exit
        const projectRoot: string | null = getProjectRootWatchedDirectory();
        if (projectRoot) {
            writeAllPositionsSync(getGraph(), projectRoot);
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

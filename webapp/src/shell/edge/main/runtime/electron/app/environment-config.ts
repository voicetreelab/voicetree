/// <reference types="node" />
import path from 'path';
import os from 'os';
import fs from 'fs';
import {app} from 'electron';
import fixPath from 'fix-path';
import { setStartupFolderOverride } from '@/shell/edge/main/runtime/electron/startup/startup-folder-override';

// Port string passed to --remote-debugging-port, null if CDP not enabled.
// '0' means ephemeral — resolve the actual port later via DevToolsActivePort.
let _configuredCdpPort: string | null = null;

export function getConfiguredCdpPort(): string | null {
    return _configuredCdpPort;
}

export function parseRemoteDebuggingPortArg(argv: readonly string[]): string | null {
    for (let index: number = 0; index < argv.length; index++) {
        const arg: string = argv[index];
        if (arg.startsWith('--remote-debugging-port=')) {
            const port: string = arg.slice('--remote-debugging-port='.length);
            return /^\d+$/.test(port) ? port : null;
        }
        if (arg === '--remote-debugging-port') {
            const port: string | undefined = argv[index + 1];
            return port && /^\d+$/.test(port) ? port : null;
        }
    }
    return null;
}

function validPortOrNull(port: string | undefined): string | null {
    return port && /^\d+$/.test(port) ? port : null;
}

function getExistingRemoteDebuggingPort(): string | null {
    const argvPort: string | null = parseRemoteDebuggingPortArg(process.argv);
    if (argvPort !== null) return argvPort;
    if (!app.commandLine.hasSwitch('remote-debugging-port')) return null;
    return validPortOrNull(app.commandLine.getSwitchValue('remote-debugging-port'));
}

export function chooseCdpPort(
    argvPort: string | null,
    endpoint: string | undefined,
    filePort: string | null,
): string {
    if (argvPort !== null) return argvPort;
    if (endpoint) {
        try {
            const port: string = new URL(endpoint).port;
            if (/^\d+$/.test(port)) return port;
        } catch {
            // Invalid endpoint: fall through to the next source.
        }
    }
    return filePort && /^\d+$/.test(filePort) ? filePort : '0';
}

export function shouldAutoEnablePlaywrightDebug(env: NodeJS.ProcessEnv, appIsPackaged: boolean): boolean {
    return !appIsPackaged
        && env.NODE_ENV !== 'test'
        && env.HEADLESS_TEST !== '1'
        && env.ENABLE_PLAYWRIGHT_DEBUG === undefined;
}

function readCdpPortFile(cwd: string): string | null {
    try {
        return fs.readFileSync(path.join(cwd, '.cdp-port'), 'utf-8').trim();
    } catch {
        return null;
    }
}

function ensureUserDataDirectory(): void {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
}

/**
 * Configure the Electron process environment: fix PATH, set app name,
 * handle fresh-start mode in dev, parse CLI args, suppress security
 * warnings, configure test mode, and set up Playwright debugging.
 */
export function configureEnvironment(): void {
    // Fix PATH for macOS/Linux GUI apps
    // This ensures the Electron process and all child processes have access to
    // binaries installed via Homebrew, npm, etc. that are in the user's shell PATH
    fixPath();

    // Set app name (shows in macOS menu bar, taskbar, etc.)
    app.setName('Voicetree');

    // Fresh start mode: use temporary userData to mimic first-time user experience
    // Only in development/test mode, opt-out with VOICETREE_PERSIST_STATE=1
    // Production builds persist settings to real userData
    const isDev: boolean = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
    if (process.env.VOICETREE_PERSIST_STATE !== '1' && isDev) {
        const tempDir: string = path.join(os.tmpdir(), `voicetree-fresh-${Date.now()}`);
        app.setPath('userData', tempDir);
    }

    // Chromium writes DevToolsActivePort inside userData when CDP starts. Ensure
    // the active directory exists before enabling remote debugging.
    ensureUserDataDirectory();

    // Parse CLI arguments for --open-folder (used by "Open Folder in New Instance"),
    // with $VOICETREE_STARTUP_FOLDER as a fallback. The env var path is the more
    // reliable channel for programmatic launchers (e.g. the bootcamp harness)
    // because process wrappers like `electron-vite dev` do not consistently
    // forward unknown argv to the Electron main process, while env vars
    // propagate through every layer.
    const openFolderIndex: number = process.argv.indexOf('--open-folder');
    if (openFolderIndex !== -1 && process.argv[openFolderIndex + 1]) {
        setStartupFolderOverride(process.argv[openFolderIndex + 1]);
    } else if (
        typeof process.env.VOICETREE_STARTUP_FOLDER === 'string'
        && process.env.VOICETREE_STARTUP_FOLDER.length > 0
    ) {
        setStartupFolderOverride(process.env.VOICETREE_STARTUP_FOLDER);
    }

    // Suppress Electron security warnings in development and test environments
    // These warnings are only shown in dev mode and don't appear in production
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
        process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
    }

    // Default to minimized/headless mode in test environment (can override with MINIMIZE_TEST=0)
    if (process.env.NODE_ENV === 'test' && process.env.MINIMIZE_TEST === undefined) {
        process.env.MINIMIZE_TEST = '1';
    }

    // Prevent focus stealing in test mode
    if (process.env.MINIMIZE_TEST === '1') {
        // Add command line switches to run in background mode
        app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
        app.commandLine.appendSwitch('disable-renderer-backgrounding');
    }

    // Opt-in heap-snapshot capture for diagnosing renderer OOMs.
    // VOICETREE_HEAP_TRACE=1 → V8 writes up to 3 .heapsnapshot files into the
    // renderer's cwd as the heap approaches the limit. Fires while V8 still
    // has headroom, so the file actually gets written (the alternative
    // --heap-snapshot-on-oom can't be paired here: Electron splits a
    // space-separated js-flags value into separate argv entries, dropping
    // the second flag). Drop the resulting .heapsnapshot files into Chrome
    // DevTools' Memory tab → "Load profile" to inspect retainers.
    if (process.env.VOICETREE_HEAP_TRACE === '1') {
        app.commandLine.appendSwitch('js-flags', '--heapsnapshot-near-heap-limit=3');
    }

    // Auto-enable CDP for all unpackaged builds so vt-debug can attach without manual setup.
    // Uses app.isPackaged instead of NODE_ENV because electron:prod (electron-vite build && electron .)
    // runs unpackaged but with NODE_ENV !== 'development', leaving CDP disabled and cdpPort=0.
    if (shouldAutoEnablePlaywrightDebug(process.env, app.isPackaged)) {
        process.env.ENABLE_PLAYWRIGHT_DEBUG = '1';
    }

    // Enable remote debugging for Playwright MCP connections
    // This allows external Playwright instances to connect via CDP (Chrome DevTools Protocol)
    // Port configurable via PLAYWRIGHT_MCP_CDP_ENDPOINT (e.g. http://localhost:9223) to avoid collisions between worktrees
    if (process.env.ENABLE_PLAYWRIGHT_DEBUG === '1') {
        // Default '0' = ephemeral; OS picks a port and writes it to DevToolsActivePort post-launch.
        // Playwright owns its launch args, so an existing --remote-debugging-port must take precedence
        // over the local .cdp-port helper used by vt-debug.
        const existingCdpPort: string | null = getExistingRemoteDebuggingPort();
        const cdpPort: string = chooseCdpPort(
            existingCdpPort,
            process.env.PLAYWRIGHT_MCP_CDP_ENDPOINT,
            readCdpPortFile(process.cwd()),
        );
        _configuredCdpPort = cdpPort;
        if (existingCdpPort === null) {
            app.commandLine.appendSwitch('remote-debugging-port', cdpPort);
        }
    }
}

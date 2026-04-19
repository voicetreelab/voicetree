/// <reference types="node" />
import path from 'path';
import os from 'os';
import fs from 'fs';
import {app} from 'electron';
import fixPath from 'fix-path';
import {setStartupFolderOverride} from "@/shell/edge/main/state/watch-folder-store";

// Port string passed to --remote-debugging-port, null if CDP not enabled.
// '0' means ephemeral — resolve the actual port later via DevToolsActivePort.
let _configuredCdpPort: string | null = null;

export function getConfiguredCdpPort(): string | null {
    return _configuredCdpPort;
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

    // Parse CLI arguments for --open-folder (used by "Open Folder in New Instance")
    const openFolderIndex: number = process.argv.indexOf('--open-folder');
    if (openFolderIndex !== -1 && process.argv[openFolderIndex + 1]) {
        setStartupFolderOverride(process.argv[openFolderIndex + 1]);
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

    // Auto-enable CDP in development so vt-debug can attach without manual setup
    if (process.env.NODE_ENV === 'development' && process.env.ENABLE_PLAYWRIGHT_DEBUG === undefined) {
        process.env.ENABLE_PLAYWRIGHT_DEBUG = '1';
    }

    // Enable remote debugging for Playwright MCP connections
    // This allows external Playwright instances to connect via CDP (Chrome DevTools Protocol)
    // Port configurable via PLAYWRIGHT_MCP_CDP_ENDPOINT (e.g. http://localhost:9223) to avoid collisions between worktrees
    if (process.env.ENABLE_PLAYWRIGHT_DEBUG === '1') {
        // Default '0' = ephemeral; OS picks a port and writes it to DevToolsActivePort post-launch.
        // Explicit overrides (PLAYWRIGHT_MCP_CDP_ENDPOINT or .cdp-port file) take precedence.
        let cdpPort: string = '0';
        const cdpEndpoint: string | undefined = process.env.PLAYWRIGHT_MCP_CDP_ENDPOINT;
        if (cdpEndpoint) {
            try { cdpPort = new URL(cdpEndpoint).port || '0'; } catch { /* keep ephemeral */ }
        } else {
            // Fallback: read .cdp-port file written by on-worktree-created.sh hook
            try {
                const filePort: string = fs.readFileSync(path.join(process.cwd(), '.cdp-port'), 'utf-8').trim();
                if (/^\d+$/.test(filePort)) {
                    cdpPort = filePort;
                }
            } catch { /* file doesn't exist, use ephemeral */ }
        }
        _configuredCdpPort = cdpPort;
        app.commandLine.appendSwitch('remote-debugging-port', cdpPort);
    }
}

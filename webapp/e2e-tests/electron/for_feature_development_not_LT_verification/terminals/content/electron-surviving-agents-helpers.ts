/**
 * Shared helpers and fixtures for the Surviving Agents Sidebar e2e specs.
 *
 * Extracted to keep the spec file under the 500-line repo limit while leaving
 * the test definitions themselves co-located with their describe blocks.
 *
 * All helpers are pure or push their I/O to clearly named edge functions
 * (tmux spawn/kill, fs mkdir/write, electron launch). No OOP.
 */

import {test as base, _electron as electron} from '@playwright/test';
import type {ElectronApplication, Page} from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import {createHash} from 'crypto';
import {spawnSync} from 'child_process';
import type {Core as CytoscapeCore} from 'cytoscape';
import {
    createFolderTestVault,
    waitForGraphLoaded,
} from '@e2e/electron/for_feature_development_not_LT_verification/graph/folder/folder-test-helpers';

export const PROJECT_ROOT: string = path.resolve(process.cwd());
export const SCREENSHOT_DIR: string = path.join(PROJECT_ROOT, 'e2e-tests', 'test-results', 'surviving-agents');

export const TMUX_BIN: string = '/opt/homebrew/bin/tmux';
export const SEEDED_TERMINAL_ID: string = 'Survivor';
export const PROJECT_ID: string = 'surviving-agents-e2e';

export type UnclaimedTmuxSessionShape = {
    readonly sessionName: string;
    readonly terminalId: string;
    readonly classification: 'this-vault' | 'foreign-vault';
    readonly attachable: boolean;
};

export type RecoverableAgentSessionShape =
    | {
        readonly kind: 'attachable-tmux';
        readonly session: UnclaimedTmuxSessionShape;
    }
    | {
        readonly kind: 'resumable-cli';
        readonly terminalId: string;
        readonly agentName: string;
        readonly cliType: 'claude' | 'codex';
        readonly metadataPath: string;
        readonly nativeSessionId: string;
        readonly reason: 'missing-tmux-session';
    };

export interface ExtendedWindow {
    cytoscapeInstance?: CytoscapeCore;
    electronAPI?: {
        main: {
            startFileWatching: (dir: string) => Promise<{success: boolean; directory?: string; error?: string}>;
            stopFileWatching: () => Promise<{success: boolean; error?: string}>;
            saveSettings: (settings: Record<string, unknown>) => Promise<void>;
            saveProject: (project: {
                readonly id: string;
                readonly path: string;
                readonly name: string;
                readonly type: 'folder';
                readonly lastOpened: number;
                readonly voicetreeInitialized: boolean;
            }) => Promise<void>;
            listUnclaimedTmuxSessions: () => Promise<readonly UnclaimedTmuxSessionShape[]>;
            refreshUnclaimedTmuxSessions: () => Promise<readonly UnclaimedTmuxSessionShape[]>;
            attachUnclaimedTmuxSession: (sessionName: string) => Promise<{success: boolean; terminalId?: string; error?: string}>;
            killUnclaimedTmuxSession: (sessionName: string) => Promise<{success: boolean; error?: string}>;
            refreshRecoverySessions: () => Promise<readonly RecoverableAgentSessionShape[]>;
        };
    };
}

export interface SurvivingAgentsVault {
    readonly tempRoot: string;
    readonly vaultPath: string;
    readonly contextNodePath: string;
}

export function tmuxSocketPath(): string {
    // Must match the LaunchAgent-managed socket used by agent-runtime's tmux-session-manager.
    const appSupportFromEnv: string | undefined = process.env.VOICETREE_APP_SUPPORT;
    const appSupport: string = appSupportFromEnv && appSupportFromEnv.trim().length > 0
        ? appSupportFromEnv
        : path.join(os.homedir(), 'Library', 'Application Support', 'Voicetree');
    return path.join(appSupport, 'tmux.sock');
}

export async function createSurvivingAgentsVault(): Promise<SurvivingAgentsVault> {
    const tempRoot: string = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-surviving-agents-vault-'));
    const vaultPath: string = await createFolderTestVault(tempRoot);
    const contextNodePath: string = path.join(vaultPath, 'readme.md');
    return {tempRoot, vaultPath, contextNodePath};
}

export function buildNamespaceHash(vaultPath: string): string {
    const namespace: string = path.join(vaultPath, '.voicetree');
    return createHash('sha1').update(namespace).digest('hex').slice(0, 10);
}

export function buildSessionName(vaultPath: string, terminalId: string): string {
    return `vt-${buildNamespaceHash(vaultPath)}-${terminalId}`;
}

export function spawnSeededTmuxSession(sessionName: string, env: Record<string, string>): void {
    const envArgs: string[] = Object.entries(env).flatMap(([k, v]): string[] => ['-e', `${k}=${v}`]);
    const result = spawnSync(
        TMUX_BIN,
        ['-S', tmuxSocketPath(), 'new-session', '-d', '-s', sessionName, ...envArgs, 'sleep 600'],
        {encoding: 'utf8'},
    );
    if (result.status !== 0) {
        throw new Error(`tmux new-session failed: ${result.stderr ?? result.stdout}`);
    }
}

export function killSeededTmuxSession(sessionName: string): void {
    spawnSync(TMUX_BIN, ['-S', tmuxSocketPath(), 'kill-session', '-t', sessionName], {encoding: 'utf8'});
}

export async function ensureScreenshotDir(): Promise<void> {
    await fs.mkdir(SCREENSHOT_DIR, {recursive: true});
}

export async function ensureVaultLoadedIntoGraph(appWindow: Page): Promise<void> {
    await waitForGraphLoaded(appWindow, 1);
}

/**
 * Fixture a `.voicetree/terminals/<id>.json` metadata file that the recovery
 * discovery flow will classify as `resumable-missing-tmux` (when no live tmux
 * session exists for the resolved session name).
 *
 * Returns the absolute metadata path so the caller can clean it up.
 */
export async function fixtureRecoveryMetadata(opts: {
    readonly vaultPath: string;
    readonly terminalId: string;
    readonly agentName: string;
    readonly cliBinary: 'claude' | 'codex';
    readonly nativeSessionId: string;
    readonly sessionNameOverride?: string;
}): Promise<string> {
    const metadataDir: string = path.join(opts.vaultPath, '.voicetree', 'terminals');
    await fs.mkdir(metadataDir, {recursive: true});
    const metadataPath: string = path.join(metadataDir, `${opts.terminalId}.json`);
    const projectDir: string = path.join(opts.vaultPath, '.voicetree');
    const sessionName: string = opts.sessionNameOverride
        ?? buildSessionName(opts.vaultPath, opts.terminalId);
    const metadata = {
        name: opts.terminalId,
        status: 'running' as const,
        session: sessionName,
        startedAt: new Date().toISOString(),
        terminalData: {
            type: 'Terminal',
            terminalId: opts.terminalId,
            agentName: opts.agentName,
            attachedToContextNodeId: path.join(opts.vaultPath, 'readme.md'),
            initialCommand: opts.cliBinary,
            initialEnvVars: {
                VOICETREE_TERMINAL_ID: opts.terminalId,
                AGENT_NAME: opts.agentName,
                VOICETREE_VAULT_PATH: opts.vaultPath,
                VOICETREE_PROJECT_DIR: projectDir,
            },
            isHeadless: false,
        },
        recovery: {
            native: {
                cli: opts.cliBinary,
                mode: 'interactive' as const,
                sessionId: opts.nativeSessionId,
                capturedAt: new Date().toISOString(),
                source: opts.cliBinary === 'claude'
                    ? ('claude-project-transcript' as const)
                    : ('codex-state-index' as const),
            },
        },
    };
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    return metadataPath;
}

/**
 * Playwright test fixture extension shared by all Surviving-Agents specs.
 *
 * - `vault`: fresh temp vault with `.md` files registered by the graph daemon
 * - `electronApp`: launches dist-electron with that vault preloaded; cleans up
 * - `appWindow`: first window, project loaded, cytoscape ready
 * - `seededSessionName`: pre-allocated tmux session name (test seeds it on
 *    demand; teardown always kills, even if test failed mid-setup)
 */
export const test = base.extend<{
    vault: SurvivingAgentsVault;
    electronApp: ElectronApplication;
    appWindow: Page;
    seededSessionName: string;
}>({
    vault: [async ({}, use) => {
        const vault: SurvivingAgentsVault = await createSurvivingAgentsVault();
        try {
            await use(vault);
        } finally {
            await fs.rm(vault.tempRoot, {recursive: true, force: true});
        }
    }, {timeout: 10000}],

    electronApp: [async ({vault}, use) => {
        const tempUserDataPath: string = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-surviving-agents-test-'));

        await fs.writeFile(path.join(tempUserDataPath, 'voicetree-config.json'), JSON.stringify({
            lastDirectory: vault.vaultPath,
            vaultConfig: {
                [vault.vaultPath]: {
                    writePath: vault.vaultPath,
                    readPaths: [],
                },
            },
        }, null, 2), 'utf8');

        await fs.writeFile(path.join(tempUserDataPath, 'projects.json'), JSON.stringify([{
            id: PROJECT_ID,
            path: vault.vaultPath,
            name: PROJECT_ID,
            type: 'folder',
            lastOpened: Date.now(),
            voicetreeInitialized: true,
        }], null, 2), 'utf8');

        const electronApp = await electron.launch({
            args: [
                path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                `--user-data-dir=${tempUserDataPath}`,
            ],
            env: {
                ...process.env,
                NODE_ENV: 'test',
                HEADLESS_TEST: '1',
                MINIMIZE_TEST: '1',
                VOICETREE_PERSIST_STATE: '1',
            },
            timeout: 15000,
        });

        const electronProcess = electronApp.process();
        electronProcess?.stdout?.on('data', (chunk: Buffer) => {
            console.log(`[MAIN STDOUT] ${chunk.toString().trim()}`);
        });
        electronProcess?.stderr?.on('data', (chunk: Buffer) => {
            console.error(`[MAIN STDERR] ${chunk.toString().trim()}`);
        });

        await use(electronApp);

        // Attached headless tmux runtimes hold references inside main that can
        // stall electronApp.close(); race a SIGKILL after a short grace period.
        const closeTask: Promise<void> = (async (): Promise<void> => {
            try {
                const window = await electronApp.firstWindow();
                await window.evaluate(async () => {
                    const api = (window as unknown as ExtendedWindow).electronAPI;
                    if (api) await api.main.stopFileWatching();
                });
                await window.waitForTimeout(200);
            } catch { /* best-effort cleanup */ }
            try { await electronApp.close(); } catch { /* ignore */ }
        })();
        const closed: boolean = await Promise.race([
            closeTask.then(() => true).catch(() => true),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8000)),
        ]);
        if (!closed) {
            electronApp.process()?.kill('SIGKILL');
            await Promise.race([
                closeTask.catch(() => undefined),
                new Promise<void>((resolve) => setTimeout(resolve, 2000)),
            ]);
        }
        await fs.rm(tempUserDataPath, {recursive: true, force: true});
    }, {timeout: 30000}],

    appWindow: [async ({electronApp}, use) => {
        const window = await electronApp.firstWindow({timeout: 60000});
        window.on('console', msg => {
            if (!msg.text().includes('Electron Security Warning')) {
                console.log(`BROWSER [${msg.type()}]:`, msg.text());
            }
        });
        window.on('pageerror', error => console.error('PAGE ERROR:', error.message));

        await window.waitForLoadState('domcontentloaded');
        await window.waitForSelector('text=Recent Projects', {timeout: 15000});
        await window.locator(`button:has-text("${PROJECT_ID}")`).first().click();

        await window.waitForFunction(
            () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
            {timeout: 30000},
        );
        await window.waitForTimeout(500);

        await use(window);
    }, {timeout: 60000}],

    seededSessionName: [async ({vault}, use) => {
        const name: string = buildSessionName(vault.vaultPath, SEEDED_TERMINAL_ID);
        try {
            await use(name);
        } finally {
            killSeededTmuxSession(name);
        }
    }, {timeout: 10000}],
});

/**
 * BEHAVIORAL SPEC:
 * E2E test for the Surviving agents sidebar section.
 *
 * Phases (each ends with a screenshot):
 *   Phase 1: baseline — app launched, no surviving tmux sessions
 *   Phase 2: surviving session detected — a real same-vault vt-* tmux session
 *            is seeded externally and shows up in the Surviving agents row
 *   Phase 3: post-attach — clicking Attach claims the session, the row is
 *            removed from Surviving agents and the terminal appears in the
 *            main tree
 *
 * IMPORTANT: This test creates a real tmux session via `tmux new-session`.
 * Teardown unconditionally kills the seeded session.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import type { Core as CytoscapeCore } from 'cytoscape';
import {
    createFolderTestVault,
    waitForGraphLoaded,
} from '@e2e/electron/for_feature_development_not_LT_verification/graph/folder-test-helpers';

const PROJECT_ROOT = path.resolve(process.cwd());
const SCREENSHOT_DIR = path.join(PROJECT_ROOT, 'e2e-tests', 'test-results', 'surviving-agents');

const TMUX_BIN = '/opt/homebrew/bin/tmux';
const SEEDED_TERMINAL_ID = 'Survivor';

function tmuxSocketPath(): string {
    // Must match the LaunchAgent-managed socket used by agent-runtime's tmux-session-manager.
    // The runtime reads VOICETREE_APP_SUPPORT (or the Electron app support dir) and appends 'tmux.sock'.
    const appSupportFromEnv: string | undefined = process.env.VOICETREE_APP_SUPPORT;
    const appSupport: string = appSupportFromEnv && appSupportFromEnv.trim().length > 0
        ? appSupportFromEnv
        : path.join(os.homedir(), 'Library', 'Application Support', 'Voicetree');
    return path.join(appSupport, 'tmux.sock');
}

type UnclaimedTmuxSessionShape = {
    readonly sessionName: string;
    readonly terminalId: string;
    readonly classification: 'this-vault' | 'foreign-vault';
    readonly attachable: boolean;
};

interface ExtendedWindow {
    cytoscapeInstance?: CytoscapeCore;
    electronAPI?: {
        main: {
            startFileWatching: (dir: string) => Promise<{ success: boolean; directory?: string; error?: string }>;
            stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
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
            attachUnclaimedTmuxSession: (sessionName: string) => Promise<{ success: boolean; terminalId?: string; error?: string }>;
            killUnclaimedTmuxSession: (sessionName: string) => Promise<{ success: boolean; error?: string }>;
        };
    };
}

interface SurvivingAgentsVault {
    readonly tempRoot: string;
    readonly vaultPath: string;
    readonly contextNodePath: string;
}

async function createSurvivingAgentsVault(): Promise<SurvivingAgentsVault> {
    const tempRoot: string = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-surviving-agents-vault-'));
    // createFolderTestVault produces the same shape (.md files + wikilinks) that the
    // graph daemon recognizes — covering the loading→ready transition we depend on.
    const vaultPath: string = await createFolderTestVault(tempRoot);
    const contextNodePath: string = path.join(vaultPath, 'readme.md');
    return { tempRoot, vaultPath, contextNodePath };
}

function buildNamespaceHash(vaultPath: string): string {
    const namespace: string = path.join(vaultPath, '.voicetree');
    return createHash('sha1').update(namespace).digest('hex').slice(0, 10);
}

function buildSessionName(vaultPath: string, terminalId: string): string {
    return `vt-${buildNamespaceHash(vaultPath)}-${terminalId}`;
}

function spawnSeededTmuxSession(sessionName: string, env: Record<string, string>): void {
    const envArgs: string[] = Object.entries(env).flatMap(([k, v]): string[] => ['-e', `${k}=${v}`]);
    const result = spawnSync(
        TMUX_BIN,
        ['-S', tmuxSocketPath(), 'new-session', '-d', '-s', sessionName, ...envArgs, 'sleep 600'],
        { encoding: 'utf8' },
    );
    if (result.status !== 0) {
        throw new Error(`tmux new-session failed: ${result.stderr ?? result.stdout}`);
    }
}

function killSeededTmuxSession(sessionName: string): void {
    spawnSync(TMUX_BIN, ['-S', tmuxSocketPath(), 'kill-session', '-t', sessionName], { encoding: 'utf8' });
}

async function ensureScreenshotDir(): Promise<void> {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
}

const PROJECT_ID = 'surviving-agents-e2e';

const test = base.extend<{
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
            await fs.rm(vault.tempRoot, { recursive: true, force: true });
        }
    }, { timeout: 10000 }],

    electronApp: [async ({ vault }, use) => {
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
        await fs.rm(tempUserDataPath, { recursive: true, force: true });
    }, { timeout: 30000 }],

    appWindow: [async ({ electronApp }, use) => {
        const window = await electronApp.firstWindow({ timeout: 60000 });
        window.on('console', msg => {
            if (!msg.text().includes('Electron Security Warning')) {
                console.log(`BROWSER [${msg.type()}]:`, msg.text());
            }
        });
        window.on('pageerror', error => console.error('PAGE ERROR:', error.message));

        await window.waitForLoadState('domcontentloaded');
        await window.waitForSelector('text=Recent Projects', { timeout: 15000 });
        await window.locator(`button:has-text("${PROJECT_ID}")`).first().click();

        await window.waitForFunction(
            () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
            { timeout: 30000 },
        );
        await window.waitForTimeout(500);

        await use(window);
    }, { timeout: 60000 }],

    seededSessionName: [async ({ vault }, use) => {
        // Pre-allocate the name so teardown can kill even if the test failed mid-setup
        const name: string = buildSessionName(vault.vaultPath, SEEDED_TERMINAL_ID);
        try {
            await use(name);
        } finally {
            killSeededTmuxSession(name);
        }
    }, { timeout: 10000 }],
});

async function ensureVaultLoadedIntoGraph(appWindow: Page): Promise<void> {
    await waitForGraphLoaded(appWindow, 1);
}

test.describe('Surviving Agents Sidebar', () => {
    test.describe.configure({ mode: 'serial', timeout: 180000 });

    test('shows surviving session, attaches it, and removes the row', async ({ appWindow, vault, seededSessionName }) => {
        await ensureScreenshotDir();

        console.log('=== PHASE 1: baseline — no surviving sessions ===');
        await ensureVaultLoadedIntoGraph(appWindow);
        await appWindow.waitForTimeout(500);

        const phase1Path: string = path.join(SCREENSHOT_DIR, '1-baseline-no-surviving-agents.png');
        await appWindow.screenshot({ path: phase1Path, fullPage: false });
        console.log(`Phase 1 screenshot: ${phase1Path}`);

        console.log('=== PHASE 2: seed a same-vault tmux session ===');
        spawnSeededTmuxSession(seededSessionName, {
            VOICETREE_TERMINAL_ID: SEEDED_TERMINAL_ID,
            AGENT_NAME: SEEDED_TERMINAL_ID,
            VOICETREE_VAULT_PATH: vault.vaultPath,
            VOICETREE_PROJECT_DIR: path.join(vault.vaultPath, '.voicetree'),
            CONTEXT_NODE_PATH: vault.contextNodePath,
        });

        // Trigger immediate main-side refresh; renderer store updates via uiAPI push
        const refreshed = await appWindow.evaluate(async () => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.refreshUnclaimedTmuxSessions();
        });

        const seededRow = refreshed.find((s: UnclaimedTmuxSessionShape) => s.sessionName === seededSessionName);
        expect(seededRow, `seeded session ${seededSessionName} should be detected`).toBeDefined();
        expect(seededRow!.classification).toBe('this-vault');
        expect(seededRow!.attachable).toBe(true);

        const section = appWindow.locator('[data-testid="surviving-agents-section"]');
        await expect(section).toBeVisible({ timeout: 10000 });

        const seededRowEl = appWindow.locator(`[data-session-name="${seededSessionName}"]`);
        await expect(seededRowEl).toBeVisible({ timeout: 10000 });

        const phase2Path: string = path.join(SCREENSHOT_DIR, '2-surviving-session-detected.png');
        await appWindow.screenshot({ path: phase2Path, fullPage: false });
        console.log(`Phase 2 screenshot: ${phase2Path}`);

        console.log('=== PHASE 3: attach via the API ===');
        const attachResult = await appWindow.evaluate(async (sessionName: string) => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.attachUnclaimedTmuxSession(sessionName);
        }, seededSessionName);

        expect(attachResult.success, `attach error: ${attachResult.error ?? '(none)'}`).toBe(true);

        // Row should be removed; terminal should appear in main tree
        await expect.poll(async () => {
            return await appWindow.locator(`[data-session-name="${seededSessionName}"]`).count();
        }, {
            message: 'Surviving agent row removed after attach',
            timeout: 10000,
            intervals: [500, 1000],
        }).toBe(0);

        const attachedNode = appWindow.locator(`.terminal-tree-node[data-terminal-id="${SEEDED_TERMINAL_ID}"]`);
        await expect(attachedNode).toBeVisible({ timeout: 10000 });

        await appWindow.waitForTimeout(500);
        const phase3Path: string = path.join(SCREENSHOT_DIR, '3-after-attach.png');
        await appWindow.screenshot({ path: phase3Path, fullPage: false });
        console.log(`Phase 3 screenshot: ${phase3Path}`);

        console.log('=== ALL PHASES COMPLETE ===');
        console.log(`Screenshots:\n  ${phase1Path}\n  ${phase2Path}\n  ${phase3Path}`);
    });
});

export { test };

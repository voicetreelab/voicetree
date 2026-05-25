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

export type RecoverableAgentSessionShape = {
    readonly terminalId: string;
    readonly agentName: string;
    readonly metadataPath: string;
    readonly isClaimed: boolean;
    readonly attach?: {
        readonly session: UnclaimedTmuxSessionShape;
    };
    readonly resume?: {
        readonly cliType: 'claude' | 'codex';
        readonly nativeSessionId: string;
    };
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
    readonly projectRoot: string;
    readonly contextNodePath: string;
    readonly claudeProjectsRoot: string;
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
    const projectRoot: string = await createFolderTestVault(tempRoot);
    const contextNodePath: string = path.join(projectRoot, 'readme.md');
    const claudeProjectsRoot: string = path.join(tempRoot, 'claude-projects');
    await fs.mkdir(claudeProjectsRoot, {recursive: true});
    return {tempRoot, projectRoot, contextNodePath, claudeProjectsRoot};
}

export function buildNamespaceHash(projectRoot: string): string {
    const namespace: string = path.join(projectRoot, '.voicetree');
    return createHash('sha1').update(namespace).digest('hex').slice(0, 10);
}

export function buildSessionName(projectRoot: string, terminalId: string): string {
    return `vt-${buildNamespaceHash(projectRoot)}-${terminalId}`;
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

export type FakeClaudeInstall = {
    readonly binDir: string;
    readonly invocationLogPath: string;
};

/**
 * Materialize a fake `claude` binary that records its argv to a log file
 * and then sleeps, so spawning `claude --resume <id>` in tests works without
 * depending on the real Claude CLI being installed.
 *
 * The argv-log lets the e2e assert on the EXACT command the runtime spawned
 * (e.g. that resume produced `--resume <expected-session-id>`, not `--continue`
 * or some other variant). Each invocation appends a JSON line:
 *   {"argv":["--resume","sess-..."],"pid":12345,"env_terminalId":"Mira"}
 *
 * Returns the bin dir to prepend to PATH and the absolute path of the
 * invocation log.
 */
export async function installFakeClaudeOnPath(tempRoot: string): Promise<FakeClaudeInstall> {
    const binDir: string = path.join(tempRoot, 'bin');
    await fs.mkdir(binDir, {recursive: true});
    const fakeClaudePath: string = path.join(binDir, 'claude');
    const invocationLogPath: string = path.join(tempRoot, 'fake-claude-invocations.log');
    // Use Node (not sh) for the fake binary: JSON-serialising argv from a
    // shell script means double-escaping backslashes and quotes through three
    // layers (JS template → shell script literal → sed pattern), which is
    // fragile and was producing argv:["",""] in the first attempt. Node's
    // process.argv + JSON.stringify is unambiguous.
    const script: string = [
        '#!/usr/bin/env node',
        '// fake-claude for e2e — records argv to a log and sleeps so the tmux pane stays alive.',
        "const fs = require('fs');",
        `const LOG = ${JSON.stringify(invocationLogPath)};`,
        'const argv = process.argv.slice(2);',
        'const entry = {',
        '    argv,',
        '    pid: process.pid,',
        "    env_terminalId: process.env.VOICETREE_TERMINAL_ID ?? '',",
        "    env_agent: process.env.AGENT_NAME ?? '',",
        '};',
        "fs.appendFileSync(LOG, JSON.stringify(entry) + '\\n');",
        "console.log('[fake-claude] argv:', argv.join(' '));",
        '// Keep the pane alive so the runtime sees a live tmux session after spawn.',
        '// Polling sleep instead of setTimeout(..., 600_000) so SIGTERM is responsive.',
        'setInterval(() => {}, 1000);',
        '',
    ].join('\n');
    await fs.writeFile(fakeClaudePath, script, {mode: 0o755});
    return {binDir, invocationLogPath};
}

export type FakeClaudeInvocation = {
    readonly argv: readonly string[];
    readonly pid: number;
    readonly env_terminalId: string;
    readonly env_agent: string;
};

/**
 * Read back every invocation of the fake `claude` binary recorded by
 * installFakeClaudeOnPath. Returns [] if the log doesn't exist yet.
 */
export async function readFakeClaudeInvocations(invocationLogPath: string): Promise<readonly FakeClaudeInvocation[]> {
    let raw: string;
    try {
        raw = await fs.readFile(invocationLogPath, 'utf8');
    } catch {
        return [];
    }
    const out: FakeClaudeInvocation[] = [];
    for (const line of raw.split('\n')) {
        const trimmed: string = line.trim();
        if (!trimmed) continue;
        try {
            out.push(JSON.parse(trimmed) as FakeClaudeInvocation);
        } catch { /* skip malformed */ }
    }
    return out;
}

export async function ensureVaultLoadedIntoGraph(appWindow: Page): Promise<void> {
    await waitForGraphLoaded(appWindow, 1);
}

/**
 * Fixture a stub Claude transcript JSONL file in a custom projects root.
 *
 * Discovery's Claude resolver scans `*.jsonl` under
 * `VOICETREE_CLAUDE_PROJECTS_DIR` (or `~/.claude/projects` by default) and
 * matches records whose `message.content` contains the three VoiceTree
 * markers: VOICETREE_TERMINAL_ID, VOICETREE_VAULT_PATH, TASK_NODE_PATH.
 *
 * The e2e tests set VOICETREE_CLAUDE_PROJECTS_DIR to a temp dir and call this
 * helper to seed the matching transcript, so the resolver can find the
 * native session id at discovery time without touching the real user's
 * Claude home dir.
 */
export async function fixtureClaudeTranscript(opts: {
    readonly claudeProjectsRoot: string;
    readonly terminalId: string;
    readonly projectRoot: string;
    readonly taskNodePath: string;
    readonly sessionId: string;
}): Promise<string> {
    const subdir: string = path.join(opts.claudeProjectsRoot, `vt-e2e-${opts.terminalId}`);
    await fs.mkdir(subdir, {recursive: true});
    const transcriptPath: string = path.join(subdir, `${opts.sessionId}.jsonl`);
    const markerText: string = [
        `VOICETREE_TERMINAL_ID = ${opts.terminalId}`,
        `VOICETREE_VAULT_PATH = ${opts.projectRoot}`,
        `TASK_NODE_PATH = ${opts.taskNodePath}`,
    ].join('\n');
    const record = {
        sessionId: opts.sessionId,
        type: 'user',
        message: {role: 'user', content: markerText},
    };
    await fs.writeFile(transcriptPath, `${JSON.stringify(record)}\n`, 'utf8');
    return transcriptPath;
}

/**
 * Fixture a `.voicetree/terminals/<id>.json` metadata file that the recovery
 * discovery flow will surface as a recoverable row. To actually expose a
 * `resume` capability the caller must ALSO seed a Claude transcript (see
 * `fixtureClaudeTranscript`) — the resolver runs at discovery time.
 *
 * Returns the absolute metadata path so the caller can clean it up.
 */
export async function fixtureRecoveryMetadata(opts: {
    readonly projectRoot: string;
    readonly terminalId: string;
    readonly agentName: string;
    readonly cliBinary: 'claude' | 'codex';
    readonly sessionNameOverride?: string;
    readonly taskNodePath?: string;
}): Promise<string> {
    const metadataDir: string = path.join(opts.projectRoot, '.voicetree', 'terminals');
    await fs.mkdir(metadataDir, {recursive: true});
    const metadataPath: string = path.join(metadataDir, `${opts.terminalId}.json`);
    const projectDir: string = path.join(opts.projectRoot, '.voicetree');
    const sessionName: string = opts.sessionNameOverride
        ?? buildSessionName(opts.projectRoot, opts.terminalId);
    const metadata = {
        name: opts.terminalId,
        status: 'running' as const,
        session: sessionName,
        startedAt: new Date().toISOString(),
        terminalData: {
            type: 'Terminal',
            terminalId: opts.terminalId,
            agentName: opts.agentName,
            attachedToContextNodeId: path.join(opts.projectRoot, 'readme.md'),
            initialCommand: opts.cliBinary,
            initialEnvVars: {
                VOICETREE_TERMINAL_ID: opts.terminalId,
                AGENT_NAME: opts.agentName,
                VOICETREE_VAULT_PATH: opts.projectRoot,
                VOICETREE_PROJECT_DIR: projectDir,
                ...(opts.taskNodePath ? {TASK_NODE_PATH: opts.taskNodePath} : {}),
            },
            isHeadless: false,
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
            lastDirectory: vault.projectRoot,
            vaultConfig: {
                [vault.projectRoot]: {
                    writeFolder: vault.projectRoot,
                    readPaths: [],
                },
            },
        }, null, 2), 'utf8');

        await fs.writeFile(path.join(tempUserDataPath, 'projects.json'), JSON.stringify([{
            id: PROJECT_ID,
            path: vault.projectRoot,
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
                VOICETREE_CLAUDE_PROJECTS_DIR: vault.claudeProjectsRoot,
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
        const name: string = buildSessionName(vault.projectRoot, SEEDED_TERMINAL_ID);
        try {
            await use(name);
        } finally {
            killSeededTmuxSession(name);
        }
    }, {timeout: 10000}],
});

/**
 * E2E: BF-332 — load-bearing persisted-resume gate.
 *
 * Seeds a `.voicetree/terminals/<id>.json` metadata fixture plus a matching
 * Claude transcript JSONL, launches the Electron app with NO live tmux session
 * for that terminalId, clicks the Resume button surfaced by the Surviving
 * Agents sidebar, and asserts the recovery flow actually:
 *   (a) creates a new tmux session under the canonical session name, and
 *   (b) materialises a live terminal-tree-node + floating window for the
 *       resumed terminalId.
 *
 * SCOPE — T9 (this file):
 *   The Resume-click → new tmux pane → live tab assertions. The byte
 *   round-trip (keystrokes through xterm → tmux pane; tmux output → xterm
 *   DOM) and the negative scenario (metadata lacks a native session id) are
 *   landed by Lane C T10 by extending this spec.
 *
 * NO MOCKS:
 *   tmux, the recovery discovery flow, the Claude native-session resolver,
 *   the `buildResumeCommand` builder, and `spawnTmuxBackedTerminal` all run
 *   real. The only headless-CI accommodation is a stub `claude` binary placed
 *   at the front of PATH so the spawned `claude --resume <native_session_id>`
 *   pane has something to exec without requiring the real Claude CLI in CI.
 *   The stub keeps the pane alive (exec bash) so T10 can drive byte traffic
 *   through it.
 *
 *   `run-resume-proof.mjs` is the devbox-only screenshot proof that uses the
 *   REAL Claude binary. This spec is the gated companion that runs in CI
 *   without depending on Claude being installed.
 */

import {expect, _electron as electron} from '@playwright/test';
import type {ElectronApplication, Page} from '@playwright/test';
import {spawnSync} from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
    PROJECT_ID,
    PROJECT_ROOT,
    SCREENSHOT_DIR,
    TMUX_BIN,
    buildElectronTestPath,
    buildSessionName,
    createSurvivingAgentsVault,
    electronLinuxLaunchFlags,
    ensureScreenshotDir,
    ensureVaultLoadedIntoGraph,
    fixtureClaudeTranscript,
    fixtureRecoveryMetadata,
    test as baseTest,
    tmuxSocketPath,
    type ExtendedWindow,
    type SurvivingAgentsVault,
} from '../content/electron-surviving-agents-helpers';

const RESUME_TERMINAL_ID: string = 'PersistedResumeT9';
const RESUME_NATIVE_SESSION_ID: string = '0f4e2c3a-7b1d-4d9e-9a2f-8c7b6e5d4321';
const STUB_CLAUDE_BODY: string = [
    '#!/usr/bin/env bash',
    '# E2E stub for the `claude` CLI used during the persisted-resume gate.',
    '#',
    '# - Stays alive so the spawned tmux pane and terminal-tree-node remain',
    '#   present long enough for the assertions to fire (and T10 to drive',
    '#   byte traffic).',
    '# - Deliberately does NOT `exec`, so `ps -o args=` on the pane pid keeps',
    '#   showing the original `claude --resume <native_session_id>` argv —',
    '#   the load-bearing proof that the recovery flow ran the resume command',
    '#   the BF-329 lazy native-session resolver produced.',
    '# - Spawns an interactive child bash for byte round-trip (T10).',
    'bash --noprofile --norc -i',
    '',
].join('\n');

/**
 * Resume-spec fixture extension:
 *   - `vault`            — fresh temp project dir (same shape as the shared helper).
 *   - `stubClaudeBinDir` — a temp dir containing a `claude` shim that the test
 *                          puts at the front of PATH for the Electron launch.
 *   - `electronApp`/`appWindow` — Electron launched with that PATH override.
 *
 * The shared helper's `electronApp` does not accept a PATH override, so this
 * file re-declares those fixtures rather than mutating the shared helper
 * (which would force every other surviving-agents spec to rebuild).
 */
const test = baseTest.extend<{
    stubClaudeBinDir: string;
}>({
    vault: [async ({}, use) => {
        const v: SurvivingAgentsVault = await createSurvivingAgentsVault();
        try {
            await use(v);
        } finally {
            await fs.rm(v.tempRoot, {recursive: true, force: true});
        }
    }, {timeout: 10_000}],

    stubClaudeBinDir: [async ({vault}, use) => {
        const dir: string = path.join(vault.tempRoot, 'stub-bin');
        await fs.mkdir(dir, {recursive: true});
        const stubPath: string = path.join(dir, 'claude');
        await fs.writeFile(stubPath, STUB_CLAUDE_BODY, 'utf8');
        await fs.chmod(stubPath, 0o755);
        await use(dir);
    }, {timeout: 10_000}],

    electronApp: [async ({vault, stubClaudeBinDir}, use) => {
        const tempUserDataPath: string = vault.appSupportPath;
        await fs.mkdir(tempUserDataPath, {recursive: true});

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

        const electronApp: ElectronApplication = await electron.launch({
            args: [
                ...electronLinuxLaunchFlags(),
                path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                `--user-data-dir=${tempUserDataPath}`,
            ],
            env: {
                ...process.env,
                PATH: buildElectronTestPath([stubClaudeBinDir]),
                NODE_ENV: 'test',
                HEADLESS_TEST: '1',
                MINIMIZE_TEST: '1',
                VOICETREE_PERSIST_STATE: '1',
                VOICETREE_APP_SUPPORT: tempUserDataPath,
                VOICETREE_CLAUDE_PROJECTS_DIR: vault.claudeProjectsRoot,
            },
            timeout: 15_000,
        });

        const electronProcess = electronApp.process();
        electronProcess?.stdout?.on('data', (chunk: Buffer) => {
            console.log(`[MAIN STDOUT] ${chunk.toString().trim()}`);
        });
        electronProcess?.stderr?.on('data', (chunk: Buffer) => {
            console.error(`[MAIN STDERR] ${chunk.toString().trim()}`);
        });

        await use(electronApp);

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
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8_000)),
        ]);
        if (!closed) {
            electronApp.process()?.kill('SIGKILL');
            await Promise.race([
                closeTask.catch(() => undefined),
                new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
            ]);
        }
    }, {timeout: 30_000}],

    appWindow: [async ({electronApp}, use) => {
        const window: Page = await electronApp.firstWindow({timeout: 60_000});
        window.on('console', (msg) => {
            if (!msg.text().includes('Electron Security Warning')) {
                console.log(`BROWSER [${msg.type()}]:`, msg.text());
            }
        });
        window.on('pageerror', (error) => console.error('PAGE ERROR:', error.message));

        await window.waitForLoadState('domcontentloaded');
        await window.waitForSelector('text=Recent Projects', {timeout: 15_000});
        await window.locator(`button:has-text("${PROJECT_ID}")`).first().click();

        await window.waitForFunction(
            () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
            {timeout: 30_000},
        );

        await use(window);
    }, {timeout: 60_000}],
});

function tmuxHasSession(sessionName: string, socketPath: string): boolean {
    const r = spawnSync(TMUX_BIN, ['-S', socketPath, 'has-session', '-t', sessionName], {encoding: 'utf8'});
    return r.status === 0;
}

function killTmuxSessionIfPresent(sessionName: string, socketPath: string): void {
    spawnSync(TMUX_BIN, ['-S', socketPath, 'kill-session', '-t', sessionName], {encoding: 'utf8'});
}

function tmuxPanePid(sessionName: string, socketPath: string): number | null {
    const r = spawnSync(
        TMUX_BIN,
        ['-S', socketPath, 'display-message', '-t', sessionName, '-p', '#{pane_pid}'],
        {encoding: 'utf8'},
    );
    if (r.status !== 0) return null;
    const pid: number = Number(r.stdout.trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function collectProcessTreeArgv(rootPid: number): readonly string[] {
    const script: string = [
        'set -euo pipefail',
        'root="$1"',
        'emit_tree() {',
        '  local pid="$1"',
        '  ps -p "$pid" -o pid=,ppid=,args= 2>/dev/null || true',
        '  (pgrep -P "$pid" 2>/dev/null || true) | while read -r child; do',
        '    emit_tree "$child"',
        '  done',
        '}',
        'emit_tree "$root"',
    ].join('\n');
    const r = spawnSync('bash', ['-lc', script, 'process-tree', String(rootPid)], {encoding: 'utf8'});
    if (r.status !== 0) return [];
    return r.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

test.describe('BF-332 — persisted Resume click promotes the row into a live tmux-backed terminal', () => {
    test.describe.configure({mode: 'serial', timeout: 180_000});

    test('Resume row → click → new tmux pane appears AND a live terminal-tree-node materialises for the terminalId', async ({appWindow, vault, stubClaudeBinDir}) => {
        void stubClaudeBinDir; // referenced via the electronApp fixture's PATH

        await ensureScreenshotDir();
        await ensureVaultLoadedIntoGraph(appWindow);

        const taskNodePath: string = path.join(vault.projectRoot, 'readme.md');
        const sessionName: string = buildSessionName(vault.projectRoot, RESUME_TERMINAL_ID);
        const socketPath: string = tmuxSocketPath(vault.appSupportPath);

        // Pre-condition: no live tmux session for this terminalId. The whole
        // point of "persisted resume" is that the runtime died.
        expect(tmuxHasSession(sessionName, socketPath), `tmux session ${sessionName} must NOT exist before the test starts`).toBe(false);

        let metadataPath: string | null = null;
        let transcriptPath: string | null = null;
        try {
            metadataPath = await fixtureRecoveryMetadata({
                projectRoot: vault.projectRoot,
                terminalId: RESUME_TERMINAL_ID,
                agentName: RESUME_TERMINAL_ID,
                cliBinary: 'claude',
                taskNodePath,
            });
            transcriptPath = await fixtureClaudeTranscript({
                claudeProjectsRoot: vault.claudeProjectsRoot,
                terminalId: RESUME_TERMINAL_ID,
                projectRoot: vault.projectRoot,
                taskNodePath,
                sessionId: RESUME_NATIVE_SESSION_ID,
            });

            // Drive recovery discovery so the sidebar surfaces the seeded row.
            const refreshed = await appWindow.evaluate(async () => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                if (!api) throw new Error('electronAPI not available');
                return await api.main.refreshRecoverySessions();
            });
            const seededRow = refreshed.find((s) => s.terminalId === RESUME_TERMINAL_ID);
            expect(seededRow, `discovery should produce a row for ${RESUME_TERMINAL_ID}`).toBeDefined();
            // Discovery surfaces only the resume CLI type — the native session id is
            // resolved LAZILY at click time (BF-329 design: avoid scanning
            // ~/.claude/projects on every 10s poll). The post-click process-tree
            // check below proves the lazy resolver actually found the transcript.
            expect(seededRow?.resume?.cliType).toBe('claude');
            expect(seededRow?.attach).toBeUndefined();
            expect(seededRow?.isClaimed).toBe(false);

            const resumeRow = appWindow.locator(
                `[data-has-resume="true"][data-terminal-id="${RESUME_TERMINAL_ID}"]`,
            );
            await expect(resumeRow).toBeVisible({timeout: 10_000});

            const beforeClickShot: string = path.join(SCREENSHOT_DIR, 'bf332-before-resume-click.png');
            await appWindow.screenshot({path: beforeClickShot, fullPage: false});
            console.log(`Before-click screenshot: ${beforeClickShot}`);

            // ── The load-bearing action: click Resume ──
            const resumeButton = resumeRow.getByRole('button', {name: /resume claude session/i});
            await expect(resumeButton).toBeVisible({timeout: 5_000});
            await resumeButton.click();

            // (a) A new tmux session under the canonical name appears.
            await expect.poll(
                () => tmuxHasSession(sessionName, socketPath),
                {
                    message: `Resume click must spawn tmux session "${sessionName}"`,
                    timeout: 15_000,
                    intervals: [250, 500, 1_000],
                },
            ).toBe(true);

            // (b) The persisted Resume row is replaced by a live terminal-tree-node
            //     for the same terminalId — i.e. the row was actually promoted.
            await expect.poll(
                async () => await appWindow.locator(
                    `[data-has-resume="true"][data-terminal-id="${RESUME_TERMINAL_ID}"]`,
                ).count(),
                {
                    message: 'Resume row should disappear after the recovery flow promotes the terminalId',
                    timeout: 15_000,
                    intervals: [500, 1_000],
                },
            ).toBe(0);

            const liveTerminalNode = appWindow.locator(
                `.terminal-tree-node[data-terminal-id="${RESUME_TERMINAL_ID}"]`,
            );
            await expect(liveTerminalNode, 'a live terminal-tree-node should appear for the resumed terminalId').toBeVisible({timeout: 15_000});

            // Load-bearing per BF-332: prove the lazy resolver actually found the
            // seeded Claude transcript AND the resume command (`claude --resume
            // <native_session_id>`) is the argv running inside the pane. If the
            // resolver had returned not-found, the spawn would never have happened
            // and the row would have produced a diagnostic instead.
            await expect.poll(
                () => {
                    const pid: number | null = tmuxPanePid(sessionName, socketPath);
                    if (pid === null) return '';
                    return collectProcessTreeArgv(pid).join('\n');
                },
                {
                    message: `Resumed tmux pane must run "claude --resume ${RESUME_NATIVE_SESSION_ID}" (proves the lazy native-session resolver found the seeded transcript)`,
                    timeout: 15_000,
                    intervals: [250, 500, 1_000],
                },
            ).toContain(`claude --resume ${RESUME_NATIVE_SESSION_ID}`);

            // The floating window mount (xterm host) is the surface T10 will
            // drive keystrokes through; assert it exists so the byte-round-trip
            // extension has a stable target.
            const floatingWindow = appWindow.locator(
                `[data-floating-window-id="${RESUME_TERMINAL_ID}"]`,
            );
            await expect(floatingWindow, 'a floating terminal window should appear for the resumed terminalId').toBeVisible({timeout: 15_000});

            const afterClickShot: string = path.join(SCREENSHOT_DIR, 'bf332-after-resume-click.png');
            await appWindow.screenshot({path: afterClickShot, fullPage: false});
            console.log(`After-click screenshot: ${afterClickShot}`);
        } finally {
            if (metadataPath) await fs.rm(metadataPath, {force: true});
            if (transcriptPath) await fs.rm(transcriptPath, {force: true});
            killTmuxSessionIfPresent(sessionName, socketPath);
        }
    });
});

export {test};

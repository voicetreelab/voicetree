/**
 * E2E: BF-332 — load-bearing persisted-resume gate.
 *
 * Seeds a `.voicetree/terminals/<id>.json` metadata fixture plus (optionally)
 * a matching Claude transcript JSONL, launches the Electron app with NO live
 * tmux session for that terminalId, clicks the Resume button surfaced by the
 * Surviving Agents sidebar, and asserts the recovery flow:
 *   (a) creates a new tmux session under the canonical session name,
 *   (b) materialises a live terminal-tree-node + floating window,
 *   (c) round-trips bytes — xterm DOM keystrokes reach the tmux pane AND tmux
 *       pane output renders into the xterm buffer, and
 *   (d) when the metadata has no matching native session, surfaces a
 *       structured diagnostic in the sidebar without spawning anything.
 *
 * Tests:
 *   1. T9   — Resume click → new tmux pane + live tab + correct argv.
 *   2. T10a — Byte round trip through the rendered xterm.
 *   3. T10b — Negative scenario: metadata-only row, resolver miss → diagnostic.
 *
 * NO MOCKS:
 *   tmux, the recovery discovery flow, the Claude native-session resolver,
 *   the `buildResumeCommand` builder, and `spawnTmuxBackedTerminal` all run
 *   real. The only headless-CI accommodation is a stub `claude` binary placed
 *   at the front of PATH so the spawned `claude --resume <native_session_id>`
 *   pane has something to exec without requiring the real Claude CLI in CI.
 *   The stub keeps the pane alive (`bash --noprofile --norc -i`) so the
 *   byte round trip can drive real keystrokes through xterm → tmux → xterm.
 *
 *   `run-resume-proof.mjs` is the devbox-only screenshot proof that uses the
 *   REAL Claude binary. This spec is the gated companion that runs in CI
 *   without depending on Claude being installed.
 *
 * The Playwright fixture extension (`test`) lives in
 * `electron-resume-persisted-helpers.ts` because it would otherwise push this
 * file over the 500-line per-file ceiling. tmux / process / xterm read helpers
 * stay inline to keep webapp/shell's boundary-width budget tight.
 */

import {expect, type Page} from '@playwright/test';
import {spawnSync} from 'child_process';
import {randomBytes} from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
    SCREENSHOT_DIR,
    TMUX_BIN,
    buildSessionName,
    ensureScreenshotDir,
    ensureProjectLoadedIntoGraph,
    fixtureClaudeTranscript,
    fixtureRecoveryMetadata,
    tmuxSocketPath,
    type ExtendedWindow,
} from '../content/electron-surviving-agents-helpers';
import {test} from './electron-resume-persisted-helpers';

const RESUME_TERMINAL_ID: string = 'PersistedResumeT9';
const RESUME_NATIVE_SESSION_ID: string = '0f4e2c3a-7b1d-4d9e-9a2f-8c7b6e5d4321';

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

function tmuxCapturePane(sessionName: string, socketPath: string): string {
    const r = spawnSync(
        TMUX_BIN,
        ['-S', socketPath, 'capture-pane', '-p', '-J', '-S', '-200', '-t', sessionName],
        {encoding: 'utf8'},
    );
    return r.status === 0 ? r.stdout : '';
}

async function readXtermBufferText(appWindow: Page, terminalId: string): Promise<string> {
    return await appWindow.evaluate((id) => {
        const debug = (window as unknown as {
            __vtDebug__?: {readTerminalBuffer?: (id: string) => string | null};
        }).__vtDebug__;
        return debug?.readTerminalBuffer?.(id) ?? '';
    }, terminalId);
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

    test('Resume row → click → new tmux pane appears AND a live terminal-tree-node materialises for the terminalId', async ({appWindow, project, stubClaudeBinDir}) => {
        void stubClaudeBinDir; // referenced via the electronApp fixture's PATH

        await ensureScreenshotDir();
        await ensureProjectLoadedIntoGraph(appWindow);

        const taskNodePath: string = path.join(project.projectRoot, 'readme.md');
        const sessionName: string = buildSessionName(project.projectRoot, RESUME_TERMINAL_ID);
        const socketPath: string = tmuxSocketPath(project.voicetreeHomePath);

        // Pre-condition: no live tmux session for this terminalId.
        expect(tmuxHasSession(sessionName, socketPath), `tmux session ${sessionName} must NOT exist before the test starts`).toBe(false);

        let metadataPath: string | null = null;
        let transcriptPath: string | null = null;
        try {
            metadataPath = await fixtureRecoveryMetadata({
                projectRoot: project.projectRoot,
                terminalId: RESUME_TERMINAL_ID,
                agentName: RESUME_TERMINAL_ID,
                cliBinary: 'claude',
                taskNodePath,
            });
            transcriptPath = await fixtureClaudeTranscript({
                claudeProjectsRoot: project.claudeProjectsRoot,
                terminalId: RESUME_TERMINAL_ID,
                projectRoot: project.projectRoot,
                taskNodePath,
                sessionId: RESUME_NATIVE_SESSION_ID,
            });

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

            await expect.poll(
                () => tmuxHasSession(sessionName, socketPath),
                {
                    message: `Resume click must spawn tmux session "${sessionName}"`,
                    timeout: 15_000,
                    intervals: [250, 500, 1_000],
                },
            ).toBe(true);

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
            // <native_session_id>`) is the argv running inside the pane.
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

            // Surface T10's byte round trip will drive keystrokes through.
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

    test('Resume → byte round trip: xterm DOM keystrokes reach tmux pane AND pane output renders into the xterm buffer', async ({appWindow, project, stubClaudeBinDir}) => {
        void stubClaudeBinDir;

        const TERMINAL_ID: string = 'PersistedResumeT10Round';
        const NATIVE_SESSION_ID: string = '7a3b4d5e-1f2c-4e9d-8b7a-3c2d1e0f9a8b';

        await ensureScreenshotDir();
        await ensureProjectLoadedIntoGraph(appWindow);

        const taskNodePath: string = path.join(project.projectRoot, 'readme.md');
        const sessionName: string = buildSessionName(project.projectRoot, TERMINAL_ID);
        const socketPath: string = tmuxSocketPath(project.voicetreeHomePath);

        expect(tmuxHasSession(sessionName, socketPath), `tmux session ${sessionName} must NOT exist before the test starts`).toBe(false);

        let metadataPath: string | null = null;
        let transcriptPath: string | null = null;
        try {
            metadataPath = await fixtureRecoveryMetadata({
                projectRoot: project.projectRoot,
                terminalId: TERMINAL_ID,
                agentName: TERMINAL_ID,
                cliBinary: 'claude',
                taskNodePath,
            });
            transcriptPath = await fixtureClaudeTranscript({
                claudeProjectsRoot: project.claudeProjectsRoot,
                terminalId: TERMINAL_ID,
                projectRoot: project.projectRoot,
                taskNodePath,
                sessionId: NATIVE_SESSION_ID,
            });

            await appWindow.evaluate(async () => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                if (!api) throw new Error('electronAPI not available');
                await api.main.refreshRecoverySessions();
            });

            const resumeRow = appWindow.locator(
                `[data-has-resume="true"][data-terminal-id="${TERMINAL_ID}"]`,
            );
            await expect(resumeRow).toBeVisible({timeout: 10_000});
            await resumeRow.getByRole('button', {name: /resume claude session/i}).click();

            await expect.poll(() => tmuxHasSession(sessionName, socketPath), {
                message: `Resume click must spawn tmux session "${sessionName}"`,
                timeout: 15_000,
                intervals: [250, 500, 1_000],
            }).toBe(true);
            const floatingWindow = appWindow.locator(`[data-floating-window-id="${TERMINAL_ID}"]`);
            await expect(floatingWindow).toBeVisible({timeout: 15_000});

            // Settle <2s: the stub-claude's `bash --noprofile --norc -i` child
            // needs a beat to repaint its prompt before keystrokes can race the
            // shell. Matches the 1500ms settle in electron-tmux-keystroke-relay.
            await appWindow.waitForTimeout(1_500);

            const helperTextarea = floatingWindow.locator('.xterm-helper-textarea').first();
            await helperTextarea.focus();

            const sentinel: string = `BF332_ROUNDTRIP_${randomBytes(3).toString('hex').toUpperCase()}`;
            const line: string = `echo ${sentinel}`;
            // Keystroke-by-keystroke pacing — single-character frames are what
            // reproduce bufferutil unmask regressions (per electron-tmux-keystroke-relay).
            for (const ch of line) {
                await appWindow.keyboard.press(ch);
            }
            await appWindow.keyboard.press('Enter');

            // (a) Direction xterm DOM keystrokes → tmux pane.
            await expect.poll(() => tmuxCapturePane(sessionName, socketPath), {
                message: `xterm keystrokes must reach tmux pane (sentinel ${sentinel})`,
                timeout: 15_000,
                intervals: [250, 500, 1_000],
            }).toContain(sentinel);

            // (b) Direction tmux pane output → xterm rendered buffer.
            // xterm uses a WebGL renderer (TerminalVanilla.attachWebGL) so the
            // .xterm-screen/.xterm-rows DOM has no scrapable textContent; the
            // rendered buffer is the source of truth and is read via the
            // existing window.__vtDebug__ introspection surface.
            await expect.poll(() => readXtermBufferText(appWindow, TERMINAL_ID), {
                message: `tmux pane output must render into the xterm buffer (sentinel ${sentinel})`,
                timeout: 15_000,
                intervals: [250, 500, 1_000],
            }).toContain(sentinel);
        } finally {
            if (metadataPath) await fs.rm(metadataPath, {force: true});
            if (transcriptPath) await fs.rm(transcriptPath, {force: true});
            killTmuxSessionIfPresent(sessionName, socketPath);
        }
    });

    test('Resume metadata WITHOUT a Claude transcript → click surfaces no-jsonl-matches diagnostic AND no tmux pane spawns', async ({appWindow, project, stubClaudeBinDir}) => {
        void stubClaudeBinDir;

        const TERMINAL_ID: string = 'PersistedResumeT10NoSession';

        await ensureScreenshotDir();
        await ensureProjectLoadedIntoGraph(appWindow);

        const taskNodePath: string = path.join(project.projectRoot, 'readme.md');
        const sessionName: string = buildSessionName(project.projectRoot, TERMINAL_ID);
        const socketPath: string = tmuxSocketPath(project.voicetreeHomePath);

        expect(tmuxHasSession(sessionName, socketPath)).toBe(false);

        let metadataPath: string | null = null;
        try {
            // Seed metadata but DELIBERATELY no transcript — the whole point of
            // the negative scenario is that claudeProjectsRoot has no .jsonl
            // matching this terminalId. Per BF-329 lazy-resolver design the row
            // STILL surfaces (resume capability is a metadata-only signal); the
            // resolver only runs at click time and returns not-found.
            metadataPath = await fixtureRecoveryMetadata({
                projectRoot: project.projectRoot,
                terminalId: TERMINAL_ID,
                agentName: TERMINAL_ID,
                cliBinary: 'claude',
                taskNodePath,
            });

            const refreshed = await appWindow.evaluate(async () => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                if (!api) throw new Error('electronAPI not available');
                return await api.main.refreshRecoverySessions();
            });
            const seededRow = refreshed.find((s) => s.terminalId === TERMINAL_ID);
            expect(seededRow, 'discovery should surface the metadata-only row even without a transcript').toBeDefined();
            expect(seededRow?.resume?.cliType).toBe('claude');

            const resumeRow = appWindow.locator(
                `[data-has-resume="true"][data-terminal-id="${TERMINAL_ID}"]`,
            );
            await expect(resumeRow).toBeVisible({timeout: 10_000});
            await resumeRow.getByRole('button', {name: /resume claude session/i}).click();

            // The renderer surfaces the structured failure as a
            // [data-testid="surviving-agents-resume-failure"] block. For a claude
            // metadata row with an EMPTY claudeProjectsRoot the resolver chain
            // collapses to {kind: 'not-found', reason: 'no-jsonl-matches'} which
            // resumePersistedAgentSession maps to {kind: 'no-native-session', ...}.
            const failureBlock = appWindow.locator('[data-testid="surviving-agents-resume-failure"]');
            await expect(failureBlock, 'a structured resolver-miss diagnostic must surface').toBeVisible({timeout: 10_000});
            await expect(failureBlock).toHaveAttribute('data-cli-type', 'claude');
            await expect(failureBlock).toHaveAttribute('data-reason', 'no-jsonl-matches');

            // No tmux session spawned — the resolver short-circuited before spawn.
            expect(tmuxHasSession(sessionName, socketPath),
                `No tmux session "${sessionName}" must come up when the resolver returns not-found`,
            ).toBe(false);

            // No live terminal tab was created either.
            await expect(
                appWindow.locator(`.terminal-tree-node[data-terminal-id="${TERMINAL_ID}"]`),
                'no live terminal tab should be created on resolver miss',
            ).toHaveCount(0);
        } finally {
            if (metadataPath) await fs.rm(metadataPath, {force: true});
            // No tmux session to kill — the resolver short-circuited.
        }
    });
});

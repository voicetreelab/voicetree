// E2E tests for the Surviving Agents sidebar section.
// Block 1: live tmux → Attach. Block 2: dead-pane metadata + resolvable
// Claude transcript → Resume. Block 3: same terminalId live AND resolvable
// → single row with BOTH Attach and Resume (fork-while-running). The
// "actually click Resume" path lives in
// electron-surviving-agents-resume-click.spec.ts; this file asserts button
// presence only so we don't spawn a real claude --resume.

import {_electron as electron, expect} from '@playwright/test';
import {spawnSync} from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
    PROJECT_ID,
    PROJECT_ROOT,
    SCREENSHOT_DIR,
    SEEDED_TERMINAL_ID,
    buildSessionName,
    createSurvivingAgentsVault,
    ensureScreenshotDir,
    ensureVaultLoadedIntoGraph,
    fixtureClaudeTranscript,
    fixtureRecoveryMetadata,
    installFakeClaudeOnPath,
    killSeededTmuxSession,
    readFakeClaudeInvocations,
    spawnSeededTmuxSession,
    test,
    tmuxSocketPath,
    type ExtendedWindow,
    type RecoverableAgentSessionShape,
} from './electron-surviving-agents-helpers';

test.describe('Surviving Agents Sidebar', () => {
    test.describe.configure({mode: 'serial', timeout: 180000});

    test('shows surviving session, attaches it, and removes the row', async ({appWindow, vault, seededSessionName}) => {
        await ensureScreenshotDir();

        console.log('=== PHASE 1: baseline — no surviving sessions ===');
        await ensureVaultLoadedIntoGraph(appWindow);
        await appWindow.waitForTimeout(500);

        const phase1Path: string = path.join(SCREENSHOT_DIR, '1-baseline-no-surviving-agents.png');
        await appWindow.screenshot({path: phase1Path, fullPage: false});
        console.log(`Phase 1 screenshot: ${phase1Path}`);

        console.log('=== PHASE 2: seed a same-vault tmux session ===');
        spawnSeededTmuxSession(seededSessionName, {
            VOICETREE_TERMINAL_ID: SEEDED_TERMINAL_ID,
            AGENT_NAME: SEEDED_TERMINAL_ID,
            VOICETREE_VAULT_PATH: vault.projectRoot,
            VOICETREE_PROJECT_DIR: path.join(vault.projectRoot, '.voicetree'),
            CONTEXT_NODE_PATH: vault.contextNodePath,
        });

        // Use the unified recovery IPC: it feeds the RecoverySessionsStore that
        // the sidebar now reads from. The legacy refreshUnclaimedTmuxSessions
        // IPC only pushes to UnclaimedTmuxStore which the sidebar stopped
        // consuming in the resume-surviving-agent-sessions OpenSpec.
        const refreshed = await appWindow.evaluate(async () => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.refreshRecoverySessions();
        });

        const seededRow: RecoverableAgentSessionShape | undefined = refreshed.find(
            (s: RecoverableAgentSessionShape) => s.attach?.session.sessionName === seededSessionName,
        );
        expect(seededRow, `seeded session ${seededSessionName} should be detected`).toBeDefined();
        if (!seededRow?.attach) {
            throw new Error('expected attach capability after defined check');
        }
        expect(seededRow.attach.session.classification).toBe('this-vault');
        expect(seededRow.attach.session.attachable).toBe(true);

        const section = appWindow.locator('[data-testid="surviving-agents-section"]');
        await expect(section).toBeVisible({timeout: 10000});

        const seededRowEl = appWindow.locator(`[data-session-name="${seededSessionName}"]`);
        await expect(seededRowEl).toBeVisible({timeout: 10000});

        const phase2Path: string = path.join(SCREENSHOT_DIR, '2-surviving-session-detected.png');
        await appWindow.screenshot({path: phase2Path, fullPage: false});
        console.log(`Phase 2 screenshot: ${phase2Path}`);

        console.log('=== PHASE 3: attach via the API ===');
        const attachResult = await appWindow.evaluate(async (sessionName: string) => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.attachUnclaimedTmuxSession(sessionName);
        }, seededSessionName);

        expect(attachResult.success, `attach error: ${attachResult.error ?? '(none)'}`).toBe(true);

        await expect.poll(async () => {
            return await appWindow.locator(`[data-session-name="${seededSessionName}"]`).count();
        }, {
            message: 'Surviving agent row removed after attach',
            timeout: 10000,
            intervals: [500, 1000],
        }).toBe(0);

        const attachedNode = appWindow.locator(`.terminal-tree-node[data-terminal-id="${SEEDED_TERMINAL_ID}"]`);
        await expect(attachedNode).toBeVisible({timeout: 10000});

        await appWindow.waitForTimeout(500);
        const phase3Path: string = path.join(SCREENSHOT_DIR, '3-after-attach.png');
        await appWindow.screenshot({path: phase3Path, fullPage: false});
        console.log(`Phase 3 screenshot: ${phase3Path}`);

        console.log('=== ALL PHASES COMPLETE ===');
        console.log(`Screenshots:\n  ${phase1Path}\n  ${phase2Path}\n  ${phase3Path}`);
    });
});

test.describe('Surviving Agents Sidebar — Resumable CLI rows', () => {
    test.describe.configure({mode: 'serial', timeout: 180000});

    test('renders a Resume-capable row when discovery resolves the Claude transcript for dead-pane metadata', async ({appWindow, vault}) => {
        await ensureScreenshotDir();
        await ensureVaultLoadedIntoGraph(appWindow);

        const fixturedTerminalId = 'ResumerAlpha';
        const fixturedNativeSessionId = 'sess-e2e-alpha-1234';
        const taskNodePath: string = path.join(vault.projectRoot, 'task.md');
        const metadataPath: string = await fixtureRecoveryMetadata({
            projectRoot: vault.projectRoot,
            terminalId: fixturedTerminalId,
            agentName: fixturedTerminalId,
            cliBinary: 'claude',
            taskNodePath,
        });
        const transcriptPath: string = await fixtureClaudeTranscript({
            claudeProjectsRoot: vault.claudeProjectsRoot,
            terminalId: fixturedTerminalId,
            projectRoot: vault.projectRoot,
            taskNodePath,
            sessionId: fixturedNativeSessionId,
        });
        console.log(`Fixtured recovery metadata at: ${metadataPath}`);
        console.log(`Fixtured Claude transcript at: ${transcriptPath}`);

        const refreshed = await appWindow.evaluate(async () => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.refreshRecoverySessions();
        });

        const resumableRow: RecoverableAgentSessionShape | undefined = refreshed.find(
            (s) => s.terminalId === fixturedTerminalId,
        );
        expect(resumableRow, `discovery should return a row for ${fixturedTerminalId}`).toBeDefined();
        if (!resumableRow?.resume) {
            throw new Error('expected resume capability after defined check');
        }
        expect(resumableRow.resume.cliType).toBe('claude');
        expect(resumableRow.resume.nativeSessionId).toBe(fixturedNativeSessionId);
        expect(resumableRow.attach).toBeUndefined();
        expect(resumableRow.isClaimed).toBe(false);

        const rowEl = appWindow.locator(
            `[data-has-resume="true"][data-terminal-id="${fixturedTerminalId}"]`,
        );
        await expect(rowEl).toBeVisible({timeout: 10000});
        await expect(rowEl).toContainText(/Resumable \(claude\)/);
        await expect(rowEl).toContainText(fixturedNativeSessionId);
        await expect(rowEl.getByRole('button', {name: /resume claude session/i})).toBeVisible();
        await expect(rowEl.getByRole('button', {name: /^attach/i})).toHaveCount(0);

        const screenshotPath: string = path.join(SCREENSHOT_DIR, '4-resumable-cli-row.png');
        await appWindow.screenshot({path: screenshotPath, fullPage: false});
        console.log(`Resumable-cli screenshot: ${screenshotPath}`);

        await fs.rm(metadataPath, {force: true});
        await fs.rm(transcriptPath, {force: true});
    });

    test('single row exposes BOTH Attach AND Resume when the same terminalId is live in tmux AND has a resolvable transcript (fork-while-running)', async ({appWindow, vault}) => {
        await ensureVaultLoadedIntoGraph(appWindow);

        const twinTerminalId = 'TwinAgent';
        const twinSessionName: string = buildSessionName(vault.projectRoot, twinTerminalId);
        const twinNativeSessionId = 'sess-e2e-twin-9999';
        const taskNodePath: string = path.join(vault.projectRoot, 'task.md');
        let createdSession = false;
        let metadataPath: string | null = null;
        let transcriptPath: string | null = null;
        try {
            spawnSeededTmuxSession(twinSessionName, {
                VOICETREE_TERMINAL_ID: twinTerminalId,
                AGENT_NAME: twinTerminalId,
                VOICETREE_VAULT_PATH: vault.projectRoot,
                VOICETREE_PROJECT_DIR: path.join(vault.projectRoot, '.voicetree'),
                CONTEXT_NODE_PATH: vault.contextNodePath,
            });
            createdSession = true;

            metadataPath = await fixtureRecoveryMetadata({
                projectRoot: vault.projectRoot,
                terminalId: twinTerminalId,
                agentName: twinTerminalId,
                cliBinary: 'claude',
                sessionNameOverride: twinSessionName,
                taskNodePath,
            });
            transcriptPath = await fixtureClaudeTranscript({
                claudeProjectsRoot: vault.claudeProjectsRoot,
                terminalId: twinTerminalId,
                projectRoot: vault.projectRoot,
                taskNodePath,
                sessionId: twinNativeSessionId,
            });

            const refreshed = await appWindow.evaluate(async () => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                if (!api) throw new Error('electronAPI not available');
                return await api.main.refreshRecoverySessions();
            });

            const matching: readonly RecoverableAgentSessionShape[] = refreshed.filter(
                (s) => s.terminalId === twinTerminalId,
            );
            expect(matching.length, 'should produce exactly one row for the terminalId').toBe(1);
            const row: RecoverableAgentSessionShape = matching[0]!;
            expect(row.attach?.session.sessionName).toBe(twinSessionName);
            expect(row.resume?.cliType).toBe('claude');
            expect(row.resume?.nativeSessionId).toBe(twinNativeSessionId);

            const rowEl = appWindow.locator(
                `[data-has-attach="true"][data-has-resume="true"][data-terminal-id="${twinTerminalId}"]`,
            );
            await expect(rowEl).toBeVisible({timeout: 10000});
            await expect(rowEl.getByRole('button', {name: /attach/i})).toBeVisible();
            await expect(rowEl.getByRole('button', {name: /resume claude session/i})).toBeVisible();
        } finally {
            if (metadataPath) await fs.rm(metadataPath, {force: true});
            if (transcriptPath) await fs.rm(transcriptPath, {force: true});
            if (createdSession) killSeededTmuxSession(twinSessionName);
        }
    });
});

/**
 * BEHAVIORAL SPEC — actually clicking Resume and verifying a resumed terminal
 * appears in the tree.
 *
 * The previous resumable-cli tests verified the row + Resume button render
 * correctly but stopped short of clicking, because clicking would spawn a
 * real `claude --resume <id>` process and depend on Claude being installed.
 *
 * This test installs a tiny fake `claude` shim on PATH (echoes argv, then
 * `exec sleep 600` to keep the pane alive) and runs Electron with that PATH
 * prepended. Clicking Resume now spawns the fake, and the runtime
 * registers the resumed terminal exactly as it would for the real one.
 *
 * Asserts the post-click state:
 *   - resumable-cli row is gone from the sidebar
 *   - the resumed terminal node appears in the main terminal tree
 *   - the tmux pane the runtime created actually exists (server-side)
 *
 * Takes a before-click and after-click screenshot.
 *
 * NOTE: this test uses its own Electron launch (not the shared fixture)
 * because PATH must be injected into the launch env before init.
 */
test.describe('Surviving Agents Sidebar — Resume actually resumes (with fake claude on PATH)', () => {
    test.describe.configure({mode: 'serial', timeout: 180000});

    test('clicking Resume spawns the resumed pane and the terminal appears in the tree', async () => {
        await ensureScreenshotDir();

        const vault = await createSurvivingAgentsVault();
        const tempUserDataPath: string = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-surviving-agents-resume-click-'));
        const fakeClaude = await installFakeClaudeOnPath(tempUserDataPath);

        // Realistic fixture: agent name like a real spawned agent would have;
        // session id is a UUID matching the shape Claude actually emits in
        // ~/.claude/projects/**/*.jsonl. Black-box readers should see "Mira"
        // and a UUID, not "ResumerClickable" + "sess-e2e-clickable-1234".
        const resumeTerminalId = 'Mira';
        const resumeNativeSessionId = '0f4e2c3a-7b1d-4d9e-9a2f-8c7b6e5d4321';
        const resumeSessionName: string = buildSessionName(vault.projectRoot, resumeTerminalId);

        // Preload vault config + project so the app autoloads our vault.
        await fs.writeFile(path.join(tempUserDataPath, 'voicetree-config.json'), JSON.stringify({
            lastDirectory: vault.projectRoot,
            vaultConfig: {[vault.projectRoot]: {writeFolder: vault.projectRoot, readPaths: []}},
        }, null, 2), 'utf8');
        await fs.writeFile(path.join(tempUserDataPath, 'projects.json'), JSON.stringify([{
            id: PROJECT_ID, path: vault.projectRoot, name: PROJECT_ID, type: 'folder',
            lastOpened: Date.now(), voicetreeInitialized: true,
        }], null, 2), 'utf8');

        const electronApp = await electron.launch({
            args: [
                path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                `--user-data-dir=${tempUserDataPath}`,
            ],
            env: {
                ...process.env,
                // Prepend fake-claude bin dir so the runtime's `claude --resume <id>`
                // spawn resolves to our shim instead of the real CLI.
                PATH: `${fakeClaude.binDir}:${process.env.PATH ?? ''}`,
                NODE_ENV: 'test',
                HEADLESS_TEST: '1',
                MINIMIZE_TEST: '1',
                VOICETREE_PERSIST_STATE: '1',
                // Point the Claude resolver at our temp transcript dir so the
                // resume capability resolves without touching ~/.claude/projects.
                VOICETREE_CLAUDE_PROJECTS_DIR: vault.claudeProjectsRoot,
            },
            timeout: 15000,
        });

        try {
            const appWindow = await electronApp.firstWindow({timeout: 60000});
            appWindow.on('console', msg => {
                if (!msg.text().includes('Electron Security Warning')) {
                    console.log(`BROWSER [${msg.type()}]:`, msg.text());
                }
            });
            await appWindow.waitForLoadState('domcontentloaded');
            await appWindow.waitForSelector('text=Recent Projects', {timeout: 15000});
            await appWindow.locator(`button:has-text("${PROJECT_ID}")`).first().click();
            await appWindow.waitForFunction(
                () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
                {timeout: 30000},
            );
            await ensureVaultLoadedIntoGraph(appWindow);
            await appWindow.waitForTimeout(500);

            // Fixture the metadata + a stub Claude transcript the resolver can match.
            const taskNodePath: string = path.join(vault.projectRoot, 'task.md');
            const metadataPath: string = await fixtureRecoveryMetadata({
                projectRoot: vault.projectRoot,
                terminalId: resumeTerminalId,
                agentName: resumeTerminalId,
                cliBinary: 'claude',
                taskNodePath,
            });
            const transcriptPath: string = await fixtureClaudeTranscript({
                claudeProjectsRoot: vault.claudeProjectsRoot,
                terminalId: resumeTerminalId,
                projectRoot: vault.projectRoot,
                taskNodePath,
                sessionId: resumeNativeSessionId,
            });
            console.log(`Fixtured resumable metadata at: ${metadataPath}`);
            console.log(`Fixtured Claude transcript at: ${transcriptPath}`);

            // Force a refresh so the sidebar row appears immediately.
            await appWindow.evaluate(async () => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                if (!api) throw new Error('electronAPI not available');
                await api.main.refreshRecoverySessions();
            });

            const rowEl = appWindow.locator(
                `[data-has-resume="true"][data-terminal-id="${resumeTerminalId}"]`,
            );
            await expect(rowEl).toBeVisible({timeout: 10000});

            const beforeClickPath: string = path.join(SCREENSHOT_DIR, '5-before-resume-click.png');
            await appWindow.screenshot({path: beforeClickPath, fullPage: false});
            console.log(`Before-click screenshot: ${beforeClickPath}`);

            // Click Resume.
            await rowEl.getByRole('button', {name: /resume claude session/i}).click();

            // Post-click expectations:
            //   - The resumable row disappears (terminal is now claimed in registry).
            //   - The resumed terminal appears as a normal tree node.
            //   - The tmux pane the runtime created actually exists server-side.
            await expect.poll(async () => {
                return await appWindow.locator(
                    `[data-has-resume="true"][data-terminal-id="${resumeTerminalId}"]`,
                ).count();
            }, {
                message: 'Resumable row should be removed after successful resume',
                timeout: 15000,
                intervals: [500, 1000],
            }).toBe(0);

            const resumedNode = appWindow.locator(
                `.terminal-tree-node[data-terminal-id="${resumeTerminalId}"]`,
            );
            await expect(resumedNode).toBeVisible({timeout: 15000});

            const resumedFloatingWindow = appWindow.locator(
                `[data-floating-window-id="${resumeTerminalId}"]`,
            );
            await expect(resumedFloatingWindow).toBeVisible({timeout: 15000});

            // Confirm server-side: tmux session for this terminalId exists.
            await expect.poll(() => {
                const result = spawnSync(
                    '/opt/homebrew/bin/tmux',
                    ['-S', tmuxSocketPath(), 'has-session', '-t', resumeSessionName],
                    {encoding: 'utf8'},
                );
                return result.status;
            }, {
                message: `tmux session ${resumeSessionName} should exist after resume`,
                timeout: 10000,
                intervals: [500, 1000],
            }).toBe(0);

            // The actual e2e contract: the fake `claude` binary must have been
            // invoked with exactly `claude --resume <expected-session-id>`. This
            // is what makes it a real e2e (vs "something happened") — it proves
            // the renderer click → main IPC → discovery → resume-command builder
            // → tmux spawn pipeline produced the right CLI invocation.
            await expect.poll(async () => {
                const invocations = await readFakeClaudeInvocations(fakeClaude.invocationLogPath);
                return invocations.length;
            }, {
                message: 'fake-claude should have been invoked at least once after Resume click',
                timeout: 15000,
                intervals: [500, 1000],
            }).toBeGreaterThanOrEqual(1);

            const invocations = await readFakeClaudeInvocations(fakeClaude.invocationLogPath);
            const matching = invocations.find(
                (inv) => inv.env_terminalId === resumeTerminalId
                    && inv.argv[0] === '--resume'
                    && inv.argv[1] === resumeNativeSessionId,
            );
            expect(
                matching,
                `expected an invocation of fake-claude with argv=["--resume","${resumeNativeSessionId}"] and VOICETREE_TERMINAL_ID="${resumeTerminalId}". Got: ${JSON.stringify(invocations)}`,
            ).toBeDefined();
            expect(matching!.env_agent).toBe(resumeTerminalId);

            // Graph-attachment contract: the resumed terminal must be wired back
            // into the graph via its original context node. The floating-window
            // assertion above proves the renderer graph UI was launched; the
            // persisted metadata below proves the recovered terminal kept its
            // original context-node attachment.
            const persistedMetadataRaw: string = await fs.readFile(metadataPath, 'utf8');
            const persistedMetadata = JSON.parse(persistedMetadataRaw) as {
                readonly name: string;
                readonly status: 'running' | 'exited';
                readonly session?: string;
                readonly terminalData?: {
                    readonly terminalId: string;
                    readonly attachedToContextNodeId?: string;
                    readonly initialCommand?: string;
                };
            };
            expect(persistedMetadata.name, 'metadata.name should match terminal id').toBe(resumeTerminalId);
            expect(persistedMetadata.status, 'metadata.status should be running after resume').toBe('running');
            expect(persistedMetadata.session, 'metadata.session should be the resumed tmux session').toBe(resumeSessionName);
            expect(persistedMetadata.terminalData?.terminalId).toBe(resumeTerminalId);
            expect(
                persistedMetadata.terminalData?.attachedToContextNodeId,
                'attachedToContextNodeId must be preserved — this is what wires the terminal back to its graph node',
            ).toBe(path.join(vault.projectRoot, 'readme.md'));
            expect(persistedMetadata.terminalData?.initialCommand).toBe('claude');

            await appWindow.waitForTimeout(500);
            const afterClickPath: string = path.join(SCREENSHOT_DIR, '6-after-resume-click.png');
            await appWindow.screenshot({path: afterClickPath, fullPage: false});
            console.log(`After-click screenshot: ${afterClickPath}`);

            // Cleanup the metadata + transcript + the resumed tmux session.
            // The test owns the session id, so kill is safe and bounded.
            await fs.rm(metadataPath, {force: true});
            await fs.rm(transcriptPath, {force: true});
            killSeededTmuxSession(resumeSessionName);
        } finally {
            // Attached tmux runtimes hold references in main that can stall
            // electronApp.close(); race a SIGKILL after a short grace period
            // (same pattern as the shared electronApp fixture in helpers).
            const closeTask: Promise<void> = (async (): Promise<void> => {
                try { await electronApp.close(); } catch { /* ignore */ }
            })();
            const closed: boolean = await Promise.race([
                closeTask.then(() => true).catch(() => true),
                new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
            ]);
            if (!closed) {
                electronApp.process()?.kill('SIGKILL');
                await Promise.race([
                    closeTask.catch(() => undefined),
                    new Promise<void>((resolve) => setTimeout(resolve, 2000)),
                ]);
            }
            await fs.rm(tempUserDataPath, {recursive: true, force: true});
            await fs.rm(vault.tempRoot, {recursive: true, force: true});
        }
    });
});

export {test};

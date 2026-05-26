// E2E tests for the Surviving Agents sidebar section.
// Block 1: live tmux → Attach. Block 2: dead-pane metadata + resolvable
// Claude transcript → Resume. Block 3: same terminalId live AND resolvable
// → single row with BOTH Attach and Resume (fork-while-running). The
// no-mock screenshot proof for actually clicking Resume lives in
// run-resume-proof.mjs and is run on devbox where the real Claude CLI exists.

import {expect} from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
    PROJECT_ID,
    SCREENSHOT_DIR,
    SEEDED_TERMINAL_ID,
    buildSessionName,
    ensureScreenshotDir,
    ensureVaultLoadedIntoGraph,
    fixtureClaudeTranscript,
    fixtureRecoveryMetadata,
    killSeededTmuxSession,
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
        }, tmuxSocketPath(vault.appSupportPath));

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
            }, tmuxSocketPath(vault.appSupportPath));
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
            if (createdSession) killSeededTmuxSession(twinSessionName, tmuxSocketPath(vault.appSupportPath));
        }
    });
});

export {test};

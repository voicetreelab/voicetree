/**
 * BEHAVIORAL SPEC:
 * E2E tests for the Surviving agents sidebar section.
 *
 * Block 1 — Attachable (live tmux) rows
 *   Phase 1: baseline — app launched, no surviving tmux sessions
 *   Phase 2: surviving session detected — a real same-vault vt-* tmux session
 *            is seeded externally and shows up in the Surviving agents row
 *   Phase 3: post-attach — clicking Attach claims the session, the row is
 *            removed from Surviving agents and the terminal appears in the
 *            main tree
 *
 * Block 2 — Resumable (dead-pane CLI) rows (OpenSpec resume-surviving-agent-sessions)
 *   - Fixturing `.voicetree/terminals/<id>.json` with `recovery.native` surfaces
 *     a `resumable-cli` row with Resume action and the native sessionId visible
 *   - Dedup invariant: live tmux + recovery metadata for the same terminalId
 *     produces only the Attach row, never both Attach and Resume
 *
 * IMPORTANT: Block 1 creates a real tmux session via `tmux new-session`.
 * Block 2 only fixtures JSON metadata; the Resume *click* would spawn a real
 * `claude --resume <id>` process, so we assert button presence without clicking.
 * Teardown unconditionally cleans up tmux + metadata.
 */

import {expect} from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
    SCREENSHOT_DIR,
    SEEDED_TERMINAL_ID,
    buildSessionName,
    ensureScreenshotDir,
    ensureVaultLoadedIntoGraph,
    fixtureRecoveryMetadata,
    killSeededTmuxSession,
    spawnSeededTmuxSession,
    test,
    type ExtendedWindow,
    type RecoverableAgentSessionShape,
    type UnclaimedTmuxSessionShape,
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
            VOICETREE_VAULT_PATH: vault.vaultPath,
            VOICETREE_PROJECT_DIR: path.join(vault.vaultPath, '.voicetree'),
            CONTEXT_NODE_PATH: vault.contextNodePath,
        });

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

    test('renders a resumable-cli row + Resume action for dead-pane metadata with native session id', async ({appWindow, vault}) => {
        await ensureScreenshotDir();
        await ensureVaultLoadedIntoGraph(appWindow);

        const fixturedTerminalId = 'ResumerAlpha';
        const fixturedNativeSessionId = 'sess-e2e-alpha-1234';
        const metadataPath: string = await fixtureRecoveryMetadata({
            vaultPath: vault.vaultPath,
            terminalId: fixturedTerminalId,
            agentName: fixturedTerminalId,
            cliBinary: 'claude',
            nativeSessionId: fixturedNativeSessionId,
        });
        console.log(`Fixtured recovery metadata at: ${metadataPath}`);

        const refreshed = await appWindow.evaluate(async () => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.refreshRecoverySessions();
        });

        const resumableRow: RecoverableAgentSessionShape | undefined = refreshed.find(
            (s) => s.kind === 'resumable-cli' && s.terminalId === fixturedTerminalId,
        );
        expect(resumableRow, `discovery should return a resumable-cli row for ${fixturedTerminalId}`).toBeDefined();
        if (!resumableRow || resumableRow.kind !== 'resumable-cli') {
            throw new Error('expected resumable-cli kind after defined check');
        }
        expect(resumableRow.cliType).toBe('claude');
        expect(resumableRow.nativeSessionId).toBe(fixturedNativeSessionId);
        expect(resumableRow.reason).toBe('missing-tmux-session');

        const rowEl = appWindow.locator(
            `[data-row-kind="resumable-cli"][data-terminal-id="${fixturedTerminalId}"]`,
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
    });

    test('dedup: live tmux session for same terminalId wins over the resumable-cli row (Attach only, no Resume)', async ({appWindow, vault}) => {
        await ensureVaultLoadedIntoGraph(appWindow);

        const twinTerminalId = 'TwinAgent';
        const twinSessionName: string = buildSessionName(vault.vaultPath, twinTerminalId);
        let createdSession = false;
        let metadataPath: string | null = null;
        try {
            spawnSeededTmuxSession(twinSessionName, {
                VOICETREE_TERMINAL_ID: twinTerminalId,
                AGENT_NAME: twinTerminalId,
                VOICETREE_VAULT_PATH: vault.vaultPath,
                VOICETREE_PROJECT_DIR: path.join(vault.vaultPath, '.voicetree'),
                CONTEXT_NODE_PATH: vault.contextNodePath,
            });
            createdSession = true;

            metadataPath = await fixtureRecoveryMetadata({
                vaultPath: vault.vaultPath,
                terminalId: twinTerminalId,
                agentName: twinTerminalId,
                cliBinary: 'claude',
                nativeSessionId: 'sess-e2e-twin-9999',
                sessionNameOverride: twinSessionName,
            });

            const refreshed = await appWindow.evaluate(async () => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                if (!api) throw new Error('electronAPI not available');
                return await api.main.refreshRecoverySessions();
            });

            const matching = refreshed.filter(
                (s) => (s.kind === 'attachable-tmux' && s.session.terminalId === twinTerminalId)
                    || (s.kind === 'resumable-cli' && s.terminalId === twinTerminalId),
            );
            expect(matching.length, 'should produce exactly one row for the deduped terminalId').toBe(1);
            expect(matching[0]!.kind).toBe('attachable-tmux');

            const attachableEl = appWindow.locator(
                `[data-row-kind="attachable-tmux"][data-session-name="${twinSessionName}"]`,
            );
            await expect(attachableEl).toBeVisible({timeout: 10000});
            await expect(attachableEl.getByRole('button', {name: /attach/i})).toBeVisible();

            const resumableEl = appWindow.locator(
                `[data-row-kind="resumable-cli"][data-terminal-id="${twinTerminalId}"]`,
            );
            await expect(resumableEl).toHaveCount(0);
        } finally {
            if (metadataPath) await fs.rm(metadataPath, {force: true});
            if (createdSession) killSeededTmuxSession(twinSessionName);
        }
    });
});

export {test};

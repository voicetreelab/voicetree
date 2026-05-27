/**
 * E2E: Crash-recovery flow against pre-seeded canonical-location fixtures (§9.2)
 *
 * SCOPE CHOICE — pre-seeded fixtures, NOT a full kill+relaunch.
 *
 *   The full "spawn 3 real tmux-backed agents → SIGKILL Electron → relaunch
 *   → re-discover" path is exercised end-to-end by
 *   `critical_e2e_verification_tests/electron-phase6-prompt-file-crash-resilience.spec.ts`
 *   (single agent) and is too heavy to repeat 3× per tier1/tier2 run.
 *
 *   This spec scopes to the discovery → render → resume code path that runs
 *   on every cold start: it seeds three persisted metadata JSONs into the
 *   CANONICAL `<projectRoot>/.voicetree/terminals/` location (the bug whose
 *   fix this openspec change ships — see
 *   openspec/changes/fix-resume-recovery-and-surviving-agents-ux/proposal.md),
 *   then verifies that on first electron load:
 *
 *     1. All three rows surface in the Surviving Agents section.
 *     2. Each row carries the §5 row-parity fields (worktreeName chip,
 *        title, agentTypeName badge) — these are the fields that distinguish
 *        the post-`resume-surviving-agent-sessions` UI from the original.
 *     3. The Attach action transitions a fixture-backed live tmux session
 *        into a live terminal node (proxy for "becomes a live terminal" in
 *        the §9.2 acceptance criteria; real-CLI Resume is exercised on
 *        devbox via `run-resume-proof.mjs`, not in headless playwright).
 *
 *   Reading from `<projectRoot>/.voicetree/terminals/` is the exact contract
 *   that the canonical-location refactor (§1) makes correct. If a regression
 *   reintroduces the writeFolder fallback, the row count assertion here
 *   fails — the test guards the post-crash discovery contract.
 */

import {expect} from '@playwright/test';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
    PROJECT_ROOT,
    SCREENSHOT_DIR,
    buildSessionName,
    ensureScreenshotDir,
    ensureVaultLoadedIntoGraph,
    fixtureClaudeTranscript,
    killSeededTmuxSession,
    spawnSeededTmuxSession,
    test,
    tmuxSocketPath,
    type ExtendedWindow,
    type RecoverableAgentSessionShape,
} from '../content/electron-surviving-agents-helpers';

// Touch PROJECT_ROOT so the lint pass doesn't flag the re-export as unused;
// it's part of the helpers public surface and may move screenshots later.
void PROJECT_ROOT;

type SeedAgentSpec = {
    readonly terminalId: string;
    readonly worktreeName: string;
    readonly title: string;
    readonly agentTypeName: 'Claude' | 'Codex';
    readonly cliBinary: 'claude' | 'codex';
    readonly status: 'running' | 'exited' | 'killed';
    readonly endedAtIso?: string;
    readonly killReason?: string;
    readonly sessionNameOverride?: string;
};

/**
 * Write a recovery-metadata JSON carrying the §5 row-parity fields
 * (worktreeName / title / agentTypeName) plus optional exit/kill metadata.
 *
 * Kept inline (rather than extended into the shared helper) so peer agents
 * working on `electron-surviving-agents-helpers.ts` aren't forced into a
 * cross-spec merge conflict. The shape matches `validateMetadata` +
 * `normalizeMetadataTerminalData` in agent-runtime/classifier.ts.
 */
async function seedRichRecoveryMetadata(opts: {
    readonly projectRoot: string;
    readonly taskNodePath: string;
    readonly agent: SeedAgentSpec;
}): Promise<string> {
    const {projectRoot, taskNodePath, agent} = opts;
    const metadataDir: string = path.join(projectRoot, '.voicetree', 'terminals');
    await fs.mkdir(metadataDir, {recursive: true});
    const metadataPath: string = path.join(metadataDir, `${agent.terminalId}.json`);
    const sessionName: string = agent.sessionNameOverride
        ?? buildSessionName(projectRoot, agent.terminalId);
    const startedAtIso: string = new Date(Date.now() - 60_000).toISOString();
    const metadata = {
        name: agent.terminalId,
        status: agent.status,
        session: sessionName,
        startedAt: startedAtIso,
        ...(agent.endedAtIso ? {endedAt: agent.endedAtIso} : {}),
        ...(agent.killReason ? {killReason: agent.killReason} : {}),
        terminalData: {
            type: 'Terminal',
            terminalId: agent.terminalId,
            agentName: agent.terminalId,
            attachedToContextNodeId: taskNodePath,
            initialCommand: agent.cliBinary,
            initialEnvVars: {
                VOICETREE_TERMINAL_ID: agent.terminalId,
                AGENT_NAME: agent.terminalId,
                VOICETREE_VAULT_PATH: projectRoot,
                VOICETREE_PROJECT_DIR: path.join(projectRoot, '.voicetree'),
                TASK_NODE_PATH: taskNodePath,
            },
            isHeadless: false,
            worktreeName: agent.worktreeName,
            title: agent.title,
            agentTypeName: agent.agentTypeName,
        },
    };
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    return metadataPath;
}

test.describe('Recovery crash flow — pre-seeded canonical fixtures', () => {
    test.describe.configure({mode: 'serial', timeout: 180_000});

    test('discovery surfaces 3 recovery rows with worktree+title+agent-type and attach promotes a live tmux row into a terminal', async ({appWindow, vault}) => {
        await ensureScreenshotDir();
        await ensureVaultLoadedIntoGraph(appWindow);

        const taskNodePath: string = path.join(vault.projectRoot, 'readme.md');

        // ── Seed three fixtures into the CANONICAL projectRoot location ──
        // Agent A: claude, resumable via fixture transcript (Resume capability)
        const agentA: SeedAgentSpec = {
            terminalId: 'IrisRecovery',
            worktreeName: 'wt-recovery-iris',
            title: 'Refactor recovery flow',
            agentTypeName: 'Claude',
            cliBinary: 'claude',
            status: 'running',
        };
        const agentANativeSessionId = 'sess-e2e-iris-recovery';

        // Agent B: codex, no native session fixture (row still surfaces, no Resume)
        const agentB: SeedAgentSpec = {
            terminalId: 'CodyHeadless',
            worktreeName: 'wt-codex-dev',
            title: 'Implement codex resume',
            agentTypeName: 'Codex',
            cliBinary: 'codex',
            status: 'exited',
            endedAtIso: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        };

        // Agent C: claude, live tmux session seeded → Attach capability
        const agentC: SeedAgentSpec = {
            terminalId: 'LiveAttachTarget',
            worktreeName: 'wt-live-attach',
            title: 'Live attach target',
            agentTypeName: 'Claude',
            cliBinary: 'claude',
            status: 'running',
        };
        const agentCSessionName: string = buildSessionName(vault.projectRoot, agentC.terminalId);

        const seededPaths: string[] = [];
        let agentATranscriptPath: string | null = null;
        let createdAgentCSession = false;
        try {
            seededPaths.push(await seedRichRecoveryMetadata({projectRoot: vault.projectRoot, taskNodePath, agent: agentA}));
            seededPaths.push(await seedRichRecoveryMetadata({projectRoot: vault.projectRoot, taskNodePath, agent: agentB}));
            seededPaths.push(await seedRichRecoveryMetadata({projectRoot: vault.projectRoot, taskNodePath, agent: {...agentC, sessionNameOverride: agentCSessionName}}));

            agentATranscriptPath = await fixtureClaudeTranscript({
                claudeProjectsRoot: vault.claudeProjectsRoot,
                terminalId: agentA.terminalId,
                projectRoot: vault.projectRoot,
                taskNodePath,
                sessionId: agentANativeSessionId,
            });

            spawnSeededTmuxSession(agentCSessionName, {
                VOICETREE_TERMINAL_ID: agentC.terminalId,
                AGENT_NAME: agentC.terminalId,
                VOICETREE_VAULT_PATH: vault.projectRoot,
                VOICETREE_PROJECT_DIR: path.join(vault.projectRoot, '.voicetree'),
                CONTEXT_NODE_PATH: taskNodePath,
            }, tmuxSocketPath(vault.appSupportPath));
            createdAgentCSession = true;

            // ── Drive recovery discovery ──
            const refreshed = await appWindow.evaluate(async () => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                if (!api) throw new Error('electronAPI not available');
                return await api.main.refreshRecoverySessions();
            });

            const byId: Map<string, RecoverableAgentSessionShape> = new Map(
                refreshed.map((r) => [r.terminalId, r]),
            );
            expect(byId.get(agentA.terminalId), `agent ${agentA.terminalId} should be discovered`).toBeDefined();
            expect(byId.get(agentB.terminalId), `agent ${agentB.terminalId} should be discovered`).toBeDefined();
            expect(byId.get(agentC.terminalId), `agent ${agentC.terminalId} should be discovered`).toBeDefined();

            // Agent A — metadata-only `resume.cliType` surfaces. BF-329's
            // lazy-resolver split moved the native-session lookup out of
            // discovery and into resumePersistedAgentSession (the
            // ~/.claude/projects scan is too expensive for the 10s poll). The
            // Resume-click → resolved `claude --resume <id>` argv gate lives in
            // ./electron-resume-persisted-byte-roundtrip.spec.ts.
            const irisRow = byId.get(agentA.terminalId);
            expect(irisRow?.resume?.cliType).toBe('claude');

            // Agent C — live tmux session seeded → row carries Attach handle.
            const liveRow = byId.get(agentC.terminalId);
            expect(liveRow?.attach?.session.sessionName).toBe(agentCSessionName);
            expect(liveRow?.attach?.session.classification).toBe('this-vault');
            expect(liveRow?.attach?.session.attachable).toBe(true);

            // ── Render assertions (§5 row parity) ──
            const section = appWindow.locator('[data-testid="surviving-agents-section"]');
            await expect(section).toBeVisible({timeout: 10_000});

            for (const agent of [agentA, agentB, agentC]) {
                const rowEl = appWindow.locator(`.surviving-agent-row[data-terminal-id="${agent.terminalId}"]`);
                await expect(rowEl, `row for ${agent.terminalId} should render`).toBeVisible({timeout: 10_000});

                // worktree chip carries the worktreeName from terminalData
                const worktreeChip = rowEl.locator('.surviving-agent-worktree-chip');
                await expect(worktreeChip).toBeVisible();
                await expect(worktreeChip).toContainText(agent.worktreeName);

                // title text uses terminalData.title (§5.1 row payload)
                const titleEl = rowEl.locator('.surviving-agent-title');
                await expect(titleEl).toContainText(agent.title);

                // agent-type badge uses agentTypeName, normalized to lowercase
                // in data-agent-type for stable selection
                const typeBadge = rowEl.locator(`.surviving-agent-type-badge[data-agent-type="${agent.agentTypeName.toLowerCase()}"]`);
                await expect(typeBadge).toBeVisible();
                await expect(typeBadge).toContainText(agent.agentTypeName);
            }

            // Resume button present on the row with a resolved native session.
            const irisRowEl = appWindow.locator(
                `[data-has-resume="true"][data-terminal-id="${agentA.terminalId}"]`,
            );
            await expect(irisRowEl.getByRole('button', {name: /resume claude session/i})).toBeVisible();

            // Attach button present on the live-tmux row.
            const liveRowEl = appWindow.locator(
                `[data-has-attach="true"][data-terminal-id="${agentC.terminalId}"]`,
            );
            await expect(liveRowEl.getByRole('button', {name: /^attach/i})).toBeVisible();

            const sectionShotPath: string = path.join(SCREENSHOT_DIR, 'recovery-crash-flow-3-rows.png');
            await appWindow.screenshot({path: sectionShotPath, fullPage: false});
            console.log(`Recovery crash flow screenshot: ${sectionShotPath}`);

            // ── Promote the live tmux row to a live terminal via Attach ──
            // This is the §9.2 step 5 acceptance proxy: the recovery action
            // turns a Surviving Agents row into a real terminal tree node.
            const attachResult = await appWindow.evaluate(async (sessionName: string) => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                if (!api) throw new Error('electronAPI not available');
                return await api.main.attachUnclaimedTmuxSession(sessionName);
            }, agentCSessionName);

            expect(attachResult.success, `attach error: ${attachResult.error ?? '(none)'}`).toBe(true);

            await expect.poll(
                async () => appWindow.locator(`.surviving-agent-row[data-terminal-id="${agentC.terminalId}"]`).count(),
                {
                    message: 'Live attach should remove the recovery row',
                    timeout: 10_000,
                    intervals: [500, 1000],
                },
            ).toBe(0);

            const liveTerminalNode = appWindow.locator(`.terminal-tree-node[data-terminal-id="${agentC.terminalId}"]`);
            await expect(liveTerminalNode, 'attached row should appear as a live terminal node').toBeVisible({timeout: 10_000});

            // Recovery rows for A and B still present (Attach only promoted C).
            await expect(appWindow.locator(`.surviving-agent-row[data-terminal-id="${agentA.terminalId}"]`)).toBeVisible();
            await expect(appWindow.locator(`.surviving-agent-row[data-terminal-id="${agentB.terminalId}"]`)).toBeVisible();
        } finally {
            for (const p of seededPaths) {
                await fs.rm(p, {force: true});
            }
            if (agentATranscriptPath) {
                await fs.rm(agentATranscriptPath, {force: true});
            }
            if (createdAgentCSession) {
                killSeededTmuxSession(agentCSessionName, tmuxSocketPath(vault.appSupportPath));
            }
        }
    });
});

export {test};

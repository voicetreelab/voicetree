// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Mock} from 'vitest';
import {cleanup, fireEvent, render, screen, within} from '@testing-library/react';
import type {RenderResult} from '@testing-library/react';
import * as O from 'fp-ts/lib/Option.js';
import type {RecoverableAgentSession, TerminalData, UnclaimedTmuxSession} from '@vt/vt-daemon-client';
import {SurvivingAgentsSection} from './SurvivingAgentsSection';
import type {SurvivingAgentResumeResult} from './SurvivingAgentsSection';

function makeTerminalData(overrides: Partial<TerminalData> = {}): TerminalData {
    return {
        type: 'Terminal',
        terminalId: 'Ari' as TerminalData['terminalId'],
        attachedToContextNodeId: '/vault/ctx.md' as TerminalData['attachedToContextNodeId'],
        terminalCount: 0,
        anchoredToNodeId: O.none,
        title: 'Ari',
        resizable: true,
        shadowNodeDimensions: {width: 395, height: 380},
        isPinned: true,
        isDone: false,
        lifecycle: 'idle',
        lastOutputTime: 0,
        activityCount: 0,
        parentTerminalId: null,
        agentName: 'Ari',
        worktreeName: undefined,
        isHeadless: false,
        isMinimized: false,
        contextContent: '',
        agentTypeName: '',
        initialCommand: 'claude',
        initialEnvVars: {VOICETREE_VAULT_PATH: '/vault/current'},
        ...overrides,
    };
}

function makeAttachable(overrides: Partial<UnclaimedTmuxSession> & Partial<RecoverableAgentSession> = {}): RecoverableAgentSession {
    const session: UnclaimedTmuxSession = {
        sessionName: 'vt-aaaaaaaaaa-Ari',
        terminalId: 'Ari',
        hash: 'aaaaaaaaaa',
        classification: 'this-vault',
        attachable: true,
        createdAt: Date.now() - 12_000,
        panePid: 84231,
        agentName: 'Ari',
        projectRoot: '/vault/current',
        contextNodePath: '/vault/current/ctx.md',
        taskNodePath: '/vault/current/task.md',
        ...overrides,
    };
    return {
        terminalId: session.terminalId as TerminalData['terminalId'],
        agentName: session.agentName,
        metadataPath: '',
        terminalData: makeTerminalData({
            terminalId: session.terminalId as TerminalData['terminalId'],
            agentName: session.agentName,
        }),
        isClaimed: false,
        status: 'running',
        attach: {session},
    };
}

function makeResumable(overrides: Partial<RecoverableAgentSession> = {}): RecoverableAgentSession {
    return {
        terminalId: 'Bob' as TerminalData['terminalId'],
        agentName: 'Bob',
        metadataPath: '/vault/current/.voicetree/terminals/Bob.json',
        terminalData: makeTerminalData({
            terminalId: 'Bob' as TerminalData['terminalId'],
            agentName: 'Bob',
        }),
        isClaimed: false,
        status: 'running',
        resume: {cliType: 'claude'},
        ...overrides,
    };
}

function renderSection(
    sessions: readonly RecoverableAgentSession[],
    overrides: {
        readonly onAttachResult?: {readonly success: boolean; readonly error?: string};
        readonly onResumeResult?: SurvivingAgentResumeResult;
    } = {},
): RenderResult & {
    readonly onRefresh: Mock;
    readonly onAttach: Mock;
    readonly onKill: Mock;
    readonly onResume: Mock;
} {
    const onRefresh: Mock = vi.fn(() => Promise.resolve());
    const onAttach: Mock = vi.fn(() => Promise.resolve(overrides.onAttachResult ?? {success: true}));
    const onKill: Mock = vi.fn(() => Promise.resolve({success: true}));
    const onResume: Mock = vi.fn(() => Promise.resolve(overrides.onResumeResult ?? {success: true}));

    const result: RenderResult = render(
        <SurvivingAgentsSection
            sessions={sessions}
            onRefresh={onRefresh}
            onAttach={onAttach}
            onKill={onKill}
            onResume={onResume}
        />,
    );

    return {...result, onRefresh, onAttach, onKill, onResume};
}

describe('SurvivingAgentsSection — attach capability rows', () => {
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it('renders same-vault attach rows with an Attach action', () => {
        const {container, onAttach} = renderSection([makeAttachable()]);

        expect(screen.getByText('Surviving agents (1)')).toBeTruthy();
        const row: Element | null = container.querySelector('[data-terminal-id="Ari"][data-has-attach="true"]');
        expect(row).not.toBeNull();
        expect(within(row as HTMLElement).getByText('This vault')).toBeTruthy();

        fireEvent.click(within(row as HTMLElement).getByRole('button', {name: /attach/i}));

        expect(onAttach).toHaveBeenCalledWith('vt-aaaaaaaaaa-Ari');
    });

    it('renders attach row age from the render-time clock', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-22T00:00:30.000Z'));
        const createdAt: number = new Date('2026-05-22T00:00:00.000Z').getTime();

        const {container} = renderSection([makeAttachable({createdAt})]);

        const row: Element | null = container.querySelector('[data-terminal-id="Ari"][data-has-attach="true"]');
        expect(row).not.toBeNull();
        expect(within(row as HTMLElement).getByText('30s ago | pid 84231')).toBeTruthy();
    });

    it('renders foreign-vault attach rows as kill-only', () => {
        const foreign: RecoverableAgentSession = makeAttachable({
            sessionName: 'vt-bbbbbbbbbb-Beth',
            terminalId: 'Beth',
            hash: 'bbbbbbbbbb',
            classification: 'foreign-vault',
            attachable: false,
            agentName: 'Beth',
            projectRoot: '/vault/other',
        });
        const {container, onKill} = renderSection([foreign]);

        const row: Element | null = container.querySelector('[data-terminal-id="Beth"]');
        expect(row).not.toBeNull();
        expect(within(row as HTMLElement).getByText('Foreign vault')).toBeTruthy();
        expect(within(row as HTMLElement).queryByRole('button', {name: /attach/i})).toBeNull();

        fireEvent.click(within(row as HTMLElement).getByRole('button', {name: /kill beth/i}));

        expect(onKill).toHaveBeenCalledWith('vt-bbbbbbbbbb-Beth');
    });
});

describe('SurvivingAgentsSection — resume capability rows', () => {
    afterEach(() => {
        cleanup();
    });

    it('renders a resume-only row with a Resume action (no Attach)', () => {
        const {container, onResume} = renderSection([makeResumable()]);

        const row: Element | null = container.querySelector('[data-terminal-id="Bob"][data-has-resume="true"]');
        expect(row).not.toBeNull();
        expect(within(row as HTMLElement).getByText(/Resumable \(claude\)/)).toBeTruthy();
        expect(within(row as HTMLElement).queryByRole('button', {name: /attach/i})).toBeNull();

        fireEvent.click(within(row as HTMLElement).getByRole('button', {name: /resume claude session/i}));

        expect(onResume).toHaveBeenCalledWith('Bob');
    });

    it('shows the cliType in the resumable badge (the row does NOT carry a native sessionId — that is resolved lazily on click)', () => {
        const {container} = renderSection([makeResumable({resume: {cliType: 'claude'}})]);
        const row: Element | null = container.querySelector('[data-terminal-id="Bob"]');
        expect(row).not.toBeNull();
        expect((row as HTMLElement).textContent).toContain('Resumable (claude)');
    });
});

describe('SurvivingAgentsSection — combined capabilities', () => {
    afterEach(() => {
        cleanup();
    });

    it('renders both Attach AND Resume buttons on a row that has both capabilities', () => {
        const both: RecoverableAgentSession = {
            ...makeAttachable(),
            resume: {cliType: 'claude'},
        };
        const {container} = renderSection([both]);
        const row: Element | null = container.querySelector('[data-terminal-id="Ari"][data-has-attach="true"][data-has-resume="true"]');
        expect(row).not.toBeNull();
        expect(within(row as HTMLElement).getByRole('button', {name: /attach/i})).toBeTruthy();
        expect(within(row as HTMLElement).getByRole('button', {name: /resume claude session/i})).toBeTruthy();
    });

    it('hides claimed rows — they belong to the live tab strip, not Surviving Agents', () => {
        const claimed: RecoverableAgentSession = {...makeResumable(), isClaimed: true};
        renderSection([claimed]);
        expect(screen.queryByTestId('surviving-agents-section')).toBeNull();
    });

    it('does not render the section when there are no sessions and no error', () => {
        renderSection([]);
        expect(screen.queryByTestId('surviving-agents-section')).toBeNull();
    });
});

describe('SurvivingAgentsSection — refresh and error handling', () => {
    afterEach(() => {
        cleanup();
    });

    it('calls onRefresh when the refresh button is clicked', () => {
        const {onRefresh} = renderSection([makeAttachable()]);
        fireEvent.click(screen.getByRole('button', {name: /refresh surviving agents/i}));
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('surfaces a failed resume error inline so the row stays visible', async () => {
        const {findByText} = renderSection([makeResumable()], {
            onResumeResult: {success: false, error: 'tmux server unreachable'},
        });
        fireEvent.click(screen.getByRole('button', {name: /resume claude session/i}));
        const errorNode: HTMLElement = await findByText('tmux server unreachable');
        expect(errorNode).toBeTruthy();
        expect(screen.getByTestId('surviving-agents-section')).toBeTruthy();
    });
});

// ---------------------------------------------------------------------------
// §5.2 + §5.3: worktree chip + title + agent-type badge on every row
// ---------------------------------------------------------------------------

function makeRecentlyExited(overrides: Partial<RecoverableAgentSession> = {}): RecoverableAgentSession {
    return {
        terminalId: 'Cal' as TerminalData['terminalId'],
        agentName: 'Cal',
        metadataPath: '/vault/current/.voicetree/terminals/Cal.json',
        terminalData: makeTerminalData({
            terminalId: 'Cal' as TerminalData['terminalId'],
            agentName: 'Cal',
            title: 'Refactor watch loop',
            worktreeName: 'wt-watch',
            agentTypeName: 'claude',
        }),
        isClaimed: false,
        status: 'exited',
        worktreeName: 'wt-watch',
        title: 'Refactor watch loop',
        agentTypeName: 'claude',
        startedAt: '2026-05-25T10:00:00.000Z',
        endedAt: '2026-05-25T11:30:00.000Z',
        closedAt: Date.parse('2026-05-25T11:30:00.000Z'),
        ...overrides,
    };
}

describe('SurvivingAgentsSection — row parity (§5.2, §5.3)', () => {
    afterEach(() => {
        cleanup();
    });

    it('renders worktree chip, mono title, and agent-type badge for a claude-resumable row', () => {
        const claudeRow: RecoverableAgentSession = {
            ...makeResumable(),
            title: 'Fix flaky resume test',
            worktreeName: 'wt-resume-fix',
            agentTypeName: 'claude',
            terminalData: makeTerminalData({
                terminalId: 'Bob' as TerminalData['terminalId'],
                agentName: 'Bob',
                title: 'Fix flaky resume test',
                worktreeName: 'wt-resume-fix',
                agentTypeName: 'claude',
            }),
        };
        const {container} = renderSection([claudeRow]);

        const row: Element | null = container.querySelector('[data-terminal-id="Bob"]');
        expect(row).not.toBeNull();
        const rowEl: HTMLElement = row as HTMLElement;
        expect(within(rowEl).getByText('Fix flaky resume test')).toBeTruthy();
        const typeBadge: Element | null = rowEl.querySelector('.surviving-agent-type-badge');
        expect(typeBadge?.textContent).toBe('Claude');
        expect(typeBadge?.getAttribute('data-agent-type')).toBe('claude');
        const worktreeChip: Element | null = rowEl.querySelector('.surviving-agent-worktree-chip');
        expect(worktreeChip).not.toBeNull();
        expect(worktreeChip?.textContent).toContain('wt-resume-fix');
    });

    it('renders three rows together: claude-resumable, codex-resumable, recently-exited', () => {
        const claudeRow: RecoverableAgentSession = {
            ...makeResumable(),
            title: 'Refactor X',
            worktreeName: 'wt-foo',
            agentTypeName: 'claude',
        };
        const codexRow: RecoverableAgentSession = {
            ...makeResumable({
                terminalId: 'Dora' as TerminalData['terminalId'],
                agentName: 'Dora',
                resume: {cliType: 'codex'},
            }),
            title: 'Run codex audit',
            worktreeName: 'wt-codex',
            agentTypeName: 'codex',
        };
        const exitedRow: RecoverableAgentSession = makeRecentlyExited();

        const {container} = renderSection([claudeRow, codexRow, exitedRow]);

        expect(screen.getByText('Surviving agents (3)')).toBeTruthy();

        const bobRow: HTMLElement = container.querySelector('[data-terminal-id="Bob"]') as HTMLElement;
        expect(within(bobRow).getByText('Refactor X')).toBeTruthy();
        expect(bobRow.querySelector('.surviving-agent-type-badge')?.textContent).toBe('Claude');
        expect(within(bobRow).getByText(/Resumable \(claude\)/)).toBeTruthy();

        const doraRow: HTMLElement = container.querySelector('[data-terminal-id="Dora"]') as HTMLElement;
        expect(doraRow.querySelector('.surviving-agent-type-badge')?.textContent).toBe('Codex');
        expect(within(doraRow).getByText(/Resumable \(codex\)/)).toBeTruthy();

        const calRow: HTMLElement = container.querySelector('[data-terminal-id="Cal"]') as HTMLElement;
        expect(calRow.getAttribute('data-status')).toBe('exited');
        expect(within(calRow).getByText('Refactor watch loop')).toBeTruthy();
        expect(within(calRow).getByText('Exited')).toBeTruthy();
        expect(calRow.querySelector('.surviving-agent-worktree-chip')?.textContent).toContain('wt-watch');
    });
});

// ---------------------------------------------------------------------------
// §5.4: missing worktree / title degrades gracefully
// ---------------------------------------------------------------------------

describe('SurvivingAgentsSection — graceful degradation (§5.4)', () => {
    afterEach(() => {
        cleanup();
    });

    it('falls back to terminal id and omits the worktree chip when both fields are missing', () => {
        const sparse: RecoverableAgentSession = {
            ...makeResumable({
                terminalId: 'NoTitle' as TerminalData['terminalId'],
                agentName: '',
            }),
            title: undefined,
            worktreeName: undefined,
            agentTypeName: undefined,
            terminalData: makeTerminalData({
                terminalId: 'NoTitle' as TerminalData['terminalId'],
                agentName: 'NoTitle',
                // makeTerminalData defaults title to 'Ari'; override explicitly to empty
                title: '',
                worktreeName: undefined,
                agentTypeName: '',
            }),
        };
        const {container} = renderSection([sparse]);

        const rowEl: HTMLElement = container.querySelector('[data-terminal-id="NoTitle"]') as HTMLElement;
        expect(rowEl).not.toBeNull();
        expect(within(rowEl).getByText('NoTitle')).toBeTruthy();
        expect(rowEl.querySelector('.surviving-agent-worktree-chip')).toBeNull();
        expect(rowEl.querySelector('.surviving-agent-type-badge')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// §6.5: "Show older" toggle threads horizonDays=null through onRefresh
// ---------------------------------------------------------------------------

describe('SurvivingAgentsSection — show older link (§6.5)', () => {
    afterEach(() => {
        cleanup();
    });

    it('toggles label and calls onRefresh(null) when showing older, then undefined when hiding', () => {
        const {onRefresh, getByTestId} = renderSection([makeResumable()]);
        const toggle: HTMLElement = getByTestId('surviving-agents-show-older');
        expect(toggle.textContent).toMatch(/Show older agents/);

        fireEvent.click(toggle);
        expect(onRefresh).toHaveBeenCalledWith(null);
        expect(toggle.textContent).toMatch(/Hide older agents/);

        fireEvent.click(toggle);
        expect(onRefresh).toHaveBeenLastCalledWith(undefined);
        expect(toggle.textContent).toMatch(/Show older agents/);
    });
});

// ---------------------------------------------------------------------------
// §7 extensibility seam: per-row trash button slot (handed off to Delta)
// ---------------------------------------------------------------------------

describe('SurvivingAgentsSection — renderRowActions slot for Delta', () => {
    afterEach(() => {
        cleanup();
    });

    it('renders a custom action via renderRowActions in the actions region', () => {
        const onRefresh: Mock = vi.fn(() => Promise.resolve());
        const onAttach: Mock = vi.fn(() => Promise.resolve({success: true}));
        const onKill: Mock = vi.fn(() => Promise.resolve({success: true}));
        const onResume: Mock = vi.fn(() => Promise.resolve({success: true}));

        const {container} = render(
            <SurvivingAgentsSection
                sessions={[makeResumable()]}
                onRefresh={onRefresh}
                onAttach={onAttach}
                onKill={onKill}
                onResume={onResume}
                renderRowActions={(row) => (
                    <button key={`trash-${row.terminalId}`} data-testid={`trash-${row.terminalId}`} type="button">
                        Delete
                    </button>
                )}
            />,
        );

        const trash: Element | null = container.querySelector('[data-testid="trash-Bob"]');
        expect(trash).not.toBeNull();
        // The slot must render inside the actions region next to Attach/Resume.
        const actionsRegion: Element | null = container.querySelector('[data-testid="surviving-agent-actions-Bob"]');
        expect(actionsRegion?.contains(trash)).toBe(true);
    });
});

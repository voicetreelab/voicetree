// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Mock} from 'vitest';
import {cleanup, fireEvent, render, screen, within} from '@testing-library/react';
import type {RenderResult} from '@testing-library/react';
import * as O from 'fp-ts/lib/Option.js';
import type {RecoverableAgentSession, TerminalData, UnclaimedTmuxSession} from '@vt/vt-daemon-client';
import {SurvivingAgentsSection} from './SurvivingAgentsSection';

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
        resume: {cliType: 'claude'},
        ...overrides,
    };
}

function renderSection(
    sessions: readonly RecoverableAgentSession[],
    overrides: {
        readonly onAttachResult?: {readonly success: boolean; readonly error?: string};
        readonly onResumeResult?: {readonly success: boolean; readonly error?: string};
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

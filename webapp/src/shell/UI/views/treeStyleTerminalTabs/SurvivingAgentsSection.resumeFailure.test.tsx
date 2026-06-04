// @vitest-environment jsdom
//
// §8 — Resume failure UX: structured-reason rendering + copy-manual-command.
// Split out from `SurvivingAgentsSection.test.tsx` to keep each file under the
// repo's 500-line per-file ceiling.

import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Mock} from 'vitest';
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import type {RenderResult} from '@testing-library/react';
import * as O from 'fp-ts/lib/Option.js';
import type {RecoverableAgentSession, TerminalData} from '@vt/agent-runtime';
import {SurvivingAgentsSection} from './SurvivingAgentsSection';
import type {
    SurvivingAgentResumeFailure,
    SurvivingAgentResumeResult,
} from './SurvivingAgentsSection';

function makeTerminalData(): TerminalData {
    return {
        type: 'Terminal',
        terminalId: 'Bob' as TerminalData['terminalId'],
        attachedToContextNodeId: '/project/ctx.md' as TerminalData['attachedToContextNodeId'],
        terminalCount: 0,
        anchoredToNodeId: O.none,
        title: 'Bob',
        resizable: true,
        shadowNodeDimensions: {width: 395, height: 380},
        isPinned: true,
        isDone: false,
        lifecycle: 'idle',
        statusPhrase: '',
        lastOutputTime: 0,
        activityCount: 0,
        parentTerminalId: null,
        agentName: 'Bob',
        worktreeName: undefined,
        isHeadless: false,
        isMinimized: false,
        contextContent: '',
        agentTypeName: '',
        initialCommand: 'claude',
        initialEnvVars: {VOICETREE_PROJECT_PATH: '/project/current'},
    };
}

function makeResumable(cliType: 'claude' | 'codex'): RecoverableAgentSession {
    return {
        terminalId: 'Bob' as TerminalData['terminalId'],
        agentName: 'Bob',
        metadataPath: '/project/current/.voicetree/terminals/Bob.json',
        terminalData: makeTerminalData(),
        isClaimed: false,
        status: 'running',
        resume: {cliType},
    };
}

function renderWithResumeResult(
    cliType: 'claude' | 'codex',
    onResumeResult: SurvivingAgentResumeResult,
): RenderResult & {readonly onResume: Mock} {
    const onResume: Mock = vi.fn(() => Promise.resolve(onResumeResult));
    const result: RenderResult = render(
        <SurvivingAgentsSection
            sessions={[makeResumable(cliType)]}
            onRefresh={vi.fn(() => Promise.resolve())}
            onAttach={vi.fn(() => Promise.resolve({success: true}))}
            onKill={vi.fn(() => Promise.resolve({success: true}))}
            onResume={onResume}
        />,
    );
    return {...result, onResume};
}

function installClipboard(): Mock {
    const writeText: Mock = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {writeText},
    });
    return writeText;
}

type ReasonCase = {
    readonly reason: SurvivingAgentResumeFailure['reason'];
    readonly cliType: 'claude' | 'codex';
    readonly expectedMessage: string;
};

const REASON_CASES: readonly ReasonCase[] = [
    {
        reason: 'db-missing',
        cliType: 'codex',
        expectedMessage: 'Codex state database not found at ~/.codex/state_5.sqlite',
    },
    {
        reason: 'db-schema-mismatch',
        cliType: 'codex',
        expectedMessage: "Codex state DB schema is unexpected — voicetree can't read it",
    },
    {
        reason: 'outside-recency-window',
        cliType: 'codex',
        expectedMessage: "Session exists but is older than the resolver's recency window",
    },
    {
        reason: 'marker-mismatch',
        cliType: 'codex',
        expectedMessage: 'No saved transcript matched this session — its conversation log may have been deleted or never recorded',
    },
    {
        reason: 'no-rows',
        cliType: 'codex',
        expectedMessage: 'No Codex threads recorded for this project',
    },
    {
        reason: 'projects-dir-missing',
        cliType: 'claude',
        expectedMessage: 'Claude projects directory not found at ~/.claude/projects',
    },
    {
        reason: 'no-jsonl-matches',
        cliType: 'claude',
        expectedMessage: 'No Claude transcripts matched this project/cwd',
    },
    {
        reason: 'scan-timeout',
        cliType: 'claude',
        expectedMessage: 'Claude transcript scan timed out — try again or widen the timeout',
    },
];

describe('SurvivingAgentsSection — structured resume-failure reason rendering (§8.1)', () => {
    afterEach(() => {
        cleanup();
    });

    for (const c of REASON_CASES) {
        it(`renders the plain-language message for reason=${c.reason} (${c.cliType})`, async () => {
            const failure: SurvivingAgentResumeFailure = c.reason === 'outside-recency-window'
                ? {reason: c.reason, cliType: c.cliType, diagnosticSessionId: 'session-123'}
                : {reason: c.reason, cliType: c.cliType};
            const {findByTestId} = renderWithResumeResult(c.cliType, {success: false, failure});

            fireEvent.click(screen.getByRole('button', {name: /resume .* session/i}));

            const failureBlock: HTMLElement = await findByTestId('surviving-agents-resume-failure');
            expect(failureBlock.textContent).toContain(c.expectedMessage);
            expect(failureBlock.getAttribute('data-reason')).toBe(c.reason);
            expect(failureBlock.getAttribute('data-cli-type')).toBe(c.cliType);
        });
    }

    it('prefers structured failure over a plain error string when both are present', async () => {
        const {findByTestId} = renderWithResumeResult('claude', {
            success: false,
            error: 'this generic string must not be shown',
            failure: {reason: 'marker-mismatch', cliType: 'claude'},
        });
        fireEvent.click(screen.getByRole('button', {name: /resume claude session/i}));
        const failureBlock: HTMLElement = await findByTestId('surviving-agents-resume-failure');
        expect(failureBlock.textContent).toContain('No saved transcript matched this session');
        expect(screen.queryByText('this generic string must not be shown')).toBeNull();
    });
});

describe('SurvivingAgentsSection — copy manual resume command (§8.2)', () => {
    afterEach(() => {
        cleanup();
    });

    it('renders the copy button and writes `codex resume <id>` for outside-recency-window codex misses', async () => {
        const writeText: Mock = installClipboard();
        const failure: SurvivingAgentResumeFailure = {
            reason: 'outside-recency-window',
            cliType: 'codex',
            diagnosticSessionId: '019e651e-b53e-79a0-815a-f6247aca3724',
        };
        const {findByTestId} = renderWithResumeResult('codex', {success: false, failure});

        fireEvent.click(screen.getByRole('button', {name: /resume codex session/i}));
        const copyButton: HTMLElement = await findByTestId('surviving-agents-copy-manual-command');

        await act(async () => {
            fireEvent.click(copyButton);
            await Promise.resolve();
        });

        expect(writeText).toHaveBeenCalledTimes(1);
        expect(writeText).toHaveBeenCalledWith('codex resume 019e651e-b53e-79a0-815a-f6247aca3724');
        expect(copyButton.textContent).toContain('Copied');
    });

    it('writes `claude --resume <id>` for outside-recency-window claude misses', async () => {
        const writeText: Mock = installClipboard();
        const failure: SurvivingAgentResumeFailure = {
            reason: 'outside-recency-window',
            cliType: 'claude',
            diagnosticSessionId: 'cl-session-42',
        };
        const {findByTestId} = renderWithResumeResult('claude', {success: false, failure});

        fireEvent.click(screen.getByRole('button', {name: /resume claude session/i}));
        const copyButton: HTMLElement = await findByTestId('surviving-agents-copy-manual-command');

        await act(async () => {
            fireEvent.click(copyButton);
            await Promise.resolve();
        });

        expect(writeText).toHaveBeenCalledWith('claude --resume cl-session-42');
    });

    it('omits the copy button when reason is outside-recency-window but diagnosticSessionId is absent', async () => {
        const failure: SurvivingAgentResumeFailure = {
            reason: 'outside-recency-window',
            cliType: 'codex',
        };
        const {findByTestId} = renderWithResumeResult('codex', {success: false, failure});

        fireEvent.click(screen.getByRole('button', {name: /resume codex session/i}));
        await findByTestId('surviving-agents-resume-failure');
        expect(screen.queryByTestId('surviving-agents-copy-manual-command')).toBeNull();
    });

    it('omits the copy button for every non-outside-recency-window reason', async () => {
        const otherReasons: ReadonlyArray<SurvivingAgentResumeFailure['reason']> = [
            'db-missing',
            'db-schema-mismatch',
            'marker-mismatch',
            'no-rows',
            'projects-dir-missing',
            'no-jsonl-matches',
            'scan-timeout',
        ];
        for (const reason of otherReasons) {
            const cliType: 'claude' | 'codex' = reason.startsWith('no-jsonl')
                || reason === 'projects-dir-missing'
                || reason === 'scan-timeout'
                ? 'claude'
                : 'codex';
            const failure: SurvivingAgentResumeFailure = {
                reason,
                cliType,
                diagnosticSessionId: 'irrelevant-id',
            };
            const {findByTestId, unmount} = renderWithResumeResult(cliType, {success: false, failure});
            fireEvent.click(screen.getByRole('button', {name: /resume .* session/i}));
            await findByTestId('surviving-agents-resume-failure');
            expect(screen.queryByTestId('surviving-agents-copy-manual-command')).toBeNull();
            unmount();
        }
    });
});

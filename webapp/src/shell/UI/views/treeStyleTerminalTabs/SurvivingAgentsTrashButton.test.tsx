// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Mock} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as O from 'fp-ts/lib/Option.js';
import type {RecoverableAgentSession, TerminalData} from '@vt/agent-runtime';
import {SurvivingAgentsSection} from './SurvivingAgentsSection';
import {SurvivingAgentsTrashButton} from './SurvivingAgentsTrashButton';

function makeTerminalData(overrides: Partial<TerminalData> = {}): TerminalData {
    return {
        type: 'Terminal',
        terminalId: 'Bob' as TerminalData['terminalId'],
        attachedToContextNodeId: '/vault/ctx.md' as TerminalData['attachedToContextNodeId'],
        terminalCount: 0,
        anchoredToNodeId: O.none,
        title: 'Bob',
        resizable: true,
        shadowNodeDimensions: {width: 395, height: 380},
        isPinned: true,
        isDone: false,
        lifecycle: 'idle',
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
        initialEnvVars: {VOICETREE_PROJECT_PATH: '/vault/current'},
        ...overrides,
    };
}

function makeResumable(overrides: Partial<RecoverableAgentSession> = {}): RecoverableAgentSession {
    return {
        terminalId: 'Bob' as TerminalData['terminalId'],
        agentName: 'Bob',
        metadataPath: '/vault/current/.voicetree/terminals/Bob.json',
        terminalData: makeTerminalData(),
        isClaimed: false,
        status: 'running',
        resume: {cliType: 'claude'},
        ...overrides,
    };
}

function renderSectionWithTrash(
    sessions: readonly RecoverableAgentSession[],
    onDelete: Mock,
    confirmDelete: () => boolean,
): ReturnType<typeof render> {
    return render(
        <SurvivingAgentsSection
            sessions={sessions}
            onRefresh={vi.fn(() => Promise.resolve())}
            onAttach={vi.fn(() => Promise.resolve({success: true}))}
            onKill={vi.fn(() => Promise.resolve({success: true}))}
            onResume={vi.fn(() => Promise.resolve({success: true}))}
            renderRowActions={(row) => (
                <SurvivingAgentsTrashButton
                    terminalId={row.terminalId}
                    onDelete={onDelete}
                    confirmDelete={confirmDelete}
                />
            )}
        />,
    );
}

describe('SurvivingAgentsTrashButton — per-row delete flow (§7.5)', () => {
    afterEach(() => {
        cleanup();
    });

    it('renders the trash button inside the row actions region', () => {
        const {container} = renderSectionWithTrash([makeResumable()], vi.fn(() => Promise.resolve({success: true})), () => true);

        const trash: Element | null = container.querySelector('[data-testid="surviving-agent-trash-Bob"]');
        expect(trash).not.toBeNull();
        const actionsRegion: Element | null = container.querySelector('[data-testid="surviving-agent-actions-Bob"]');
        expect(actionsRegion?.contains(trash!)).toBe(true);
    });

    it('calls onDelete with the terminal id after confirm, then the row disappears when sessions update', async () => {
        const onDelete: Mock = vi.fn(() => Promise.resolve({success: true}));
        const {container, rerender} = renderSectionWithTrash([makeResumable()], onDelete, () => true);

        fireEvent.click(screen.getByTestId('surviving-agent-trash-Bob'));
        // Let the click handler's promise chain run before assertions.
        await Promise.resolve();
        await Promise.resolve();

        expect(onDelete).toHaveBeenCalledWith('Bob');

        rerender(
            <SurvivingAgentsSection
                sessions={[]}
                onRefresh={vi.fn(() => Promise.resolve())}
                onAttach={vi.fn(() => Promise.resolve({success: true}))}
                onKill={vi.fn(() => Promise.resolve({success: true}))}
                onResume={vi.fn(() => Promise.resolve({success: true}))}
                renderRowActions={(row) => (
                    <SurvivingAgentsTrashButton
                        terminalId={row.terminalId}
                        onDelete={onDelete}
                        confirmDelete={() => true}
                    />
                )}
            />,
        );

        expect(screen.queryByTestId('surviving-agent-trash-Bob')).toBeNull();
        expect(container.querySelector('[data-terminal-id="Bob"]')).toBeNull();
    });

    it('does not call onDelete when the user dismisses the confirm dialog', async () => {
        const onDelete: Mock = vi.fn(() => Promise.resolve({success: true}));
        renderSectionWithTrash([makeResumable()], onDelete, () => false);

        fireEvent.click(screen.getByTestId('surviving-agent-trash-Bob'));
        await Promise.resolve();

        expect(onDelete).not.toHaveBeenCalled();
    });

    it('surfaces a delete failure via the button title tooltip without removing the row', async () => {
        const onDelete: Mock = vi.fn(() => Promise.resolve({success: false, error: 'live-registry-entry'}));
        renderSectionWithTrash([makeResumable()], onDelete, () => true);

        fireEvent.click(screen.getByTestId('surviving-agent-trash-Bob'));

        await waitFor((): void => {
            const trash: HTMLElement = screen.getByTestId('surviving-agent-trash-Bob');
            expect(trash.getAttribute('title')).toContain('live-registry-entry');
        });
        // Row stays — parent still has the session in its list.
        expect(onDelete).toHaveBeenCalledWith('Bob');
        expect(screen.getByTestId('surviving-agent-trash-Bob')).toBeTruthy();
    });
});

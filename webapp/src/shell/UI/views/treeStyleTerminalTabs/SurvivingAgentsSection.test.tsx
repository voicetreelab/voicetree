// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Mock} from 'vitest';
import {cleanup, fireEvent, render, screen, within} from '@testing-library/react';
import type {RenderResult} from '@testing-library/react';
import type {UnclaimedTmuxSession} from '@vt/agent-runtime';
import {SurvivingAgentsSection} from './SurvivingAgentsSection';

function makeSession(overrides: Partial<UnclaimedTmuxSession> = {}): UnclaimedTmuxSession {
    return {
        sessionName: 'vt-aaaaaaaaaa-Ari',
        terminalId: 'Ari',
        hash: 'aaaaaaaaaa',
        classification: 'this-vault',
        attachable: true,
        createdAt: 1_779_365_910_000,
        panePid: 84231,
        agentName: 'Ari',
        vaultPath: '/vault/current',
        contextNodePath: '/vault/current/ctx.md',
        taskNodePath: '/vault/current/task.md',
        ...overrides,
    };
}

function renderSection(
    sessions: readonly UnclaimedTmuxSession[],
): RenderResult & {
    readonly onRefresh: Mock;
    readonly onAttach: Mock;
    readonly onKill: Mock;
} {
    const onRefresh: Mock = vi.fn(() => Promise.resolve());
    const onAttach: Mock = vi.fn(() => Promise.resolve({success: true}));
    const onKill: Mock = vi.fn(() => Promise.resolve({success: true}));

    const result: RenderResult = render(
        <SurvivingAgentsSection
            sessions={sessions}
            onRefresh={onRefresh}
            onAttach={onAttach}
            onKill={onKill}
        />
    );

    return {...result, onRefresh, onAttach, onKill};
}

describe('SurvivingAgentsSection', () => {
    afterEach(() => {
        cleanup();
    });

    it('renders same-vault sessions with an explicit Attach action', () => {
        const session: UnclaimedTmuxSession = makeSession();
        const {container, onAttach} = renderSection([session]);

        expect(screen.getByText('Surviving agents (1)')).toBeTruthy();
        const row: Element | null = container.querySelector('[data-session-name="vt-aaaaaaaaaa-Ari"]');
        expect(row).not.toBeNull();
        expect(within(row as HTMLElement).getByText('This vault')).toBeTruthy();

        fireEvent.click(within(row as HTMLElement).getByRole('button', {name: /attach/i}));

        expect(onAttach).toHaveBeenCalledTimes(1);
        expect(onAttach).toHaveBeenCalledWith('vt-aaaaaaaaaa-Ari');
    });

    it('renders foreign-vault sessions as kill-only', () => {
        const session: UnclaimedTmuxSession = makeSession({
            sessionName: 'vt-bbbbbbbbbb-Beth',
            terminalId: 'Beth',
            hash: 'bbbbbbbbbb',
            classification: 'foreign-vault',
            attachable: false,
            agentName: 'Beth',
            vaultPath: '/vault/other',
        });
        const {container, onKill} = renderSection([session]);

        const row: Element | null = container.querySelector('[data-session-name="vt-bbbbbbbbbb-Beth"]');
        expect(row).not.toBeNull();
        expect(within(row as HTMLElement).getByText('Foreign vault')).toBeTruthy();
        expect(within(row as HTMLElement).queryByRole('button', {name: /attach/i})).toBeNull();

        fireEvent.click(within(row as HTMLElement).getByRole('button', {name: /kill beth/i}));

        expect(onKill).toHaveBeenCalledTimes(1);
        expect(onKill).toHaveBeenCalledWith('vt-bbbbbbbbbb-Beth');
    });

    it('calls refresh from the section header', () => {
        const {onRefresh} = renderSection([makeSession()]);

        fireEvent.click(screen.getByRole('button', {name: /refresh surviving agents/i}));

        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('does not render when there are no surviving sessions', () => {
        renderSection([]);

        expect(screen.queryByTestId('surviving-agents-section')).toBeNull();
    });
});

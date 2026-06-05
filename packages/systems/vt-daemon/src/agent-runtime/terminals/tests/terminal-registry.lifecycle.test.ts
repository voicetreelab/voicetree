/**
 * Black-box tests for the lifecycle wiring in terminal-registry.
 *
 * Verifies:
 *   - recordTerminalSpawn initializes lifecycle to 'spawning'
 *   - updateTerminalIsDone dual-writes lifecycle (active ↔ idle)
 *   - markTerminalExited classifies exit code/signal into completed/errored
 *   - markTerminalKillReason makes a subsequent SIGTERM classify as completed
 *   - terminal states (completed/errored) are sticky against further isDone updates
 *   - applyAgentStatus maps each agent-authored preset to a lifecycle and stores
 *     the free-text status phrase
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { createTerminalData } from '../terminal-registry/types';
import type { TerminalData, TerminalId } from '../terminal-registry/types';
import type { NodeIdAndFilePath } from '@vt/graph-model/graph';
import {
    recordTerminalSpawn,
    getTerminalRecords,
    clearTerminalRecords,
    updateTerminalIsDone,
    markTerminalExited,
    markTerminalKillReason,
    applyAgentStatus,
} from '../terminal-registry';
import {
    setPublishTerminalRegistryEvent,
} from '../terminal-registry/terminal-registry-publisher';
import {MAX_STATUS_PHRASE_LENGTH, type TerminalRegistryEvent} from '@vt/vt-daemon-protocol';

const mockSendTextToTerminal: Mock = vi.fn().mockResolvedValue({ success: true });
vi.mock('@vt/vt-daemon/agent-runtime/inject/send-text-to-terminal.ts', () => ({
    sendTextToTerminal: (terminalId: string, text: string): Promise<{ success: boolean }> =>
        mockSendTextToTerminal(terminalId, text),
}));

function spawn(id: string, parentId: string | null = null): TerminalData {
    const data: TerminalData = createTerminalData({
        terminalId: id as TerminalId,
        attachedToNodeId: '/tmp/ctx.md' as NodeIdAndFilePath,
        terminalCount: 1,
        title: 'test',
        agentName: 'TestAgent',
        parentTerminalId: parentId as TerminalId | null,
    });
    recordTerminalSpawn(id, data);
    return data;
}

function lifecycleOf(id: string): string {
    const records = getTerminalRecords();
    const rec = records.find(r => r.terminalId === id);
    return rec?.terminalData.lifecycle ?? 'MISSING';
}

function statusPhraseOf(id: string): string | undefined {
    const rec = getTerminalRecords().find(r => r.terminalId === id);
    return rec?.terminalData.statusPhrase;
}

function lastReportedStatusOf(id: string): string | null | undefined {
    const rec = getTerminalRecords().find(r => r.terminalId === id);
    return rec?.terminalData.lastReportedStatus;
}

describe('terminal-registry lifecycle wiring', () => {
    beforeEach(() => clearTerminalRecords());

    describe('initial state', () => {
        it('newly spawned terminal has lifecycle "spawning"', () => {
            spawn('t1');
            expect(lifecycleOf('t1')).toBe('spawning');
        });

        it('newly spawned terminal has an empty status phrase', () => {
            spawn('t1');
            expect(statusPhraseOf('t1')).toBe('');
        });
    });

    describe('updateTerminalIsDone — heuristic silence does not flip UI lifecycle to idle', () => {
        it('isDone=false → lifecycle "active"', () => {
            spawn('t1');
            updateTerminalIsDone('t1', false);
            expect(lifecycleOf('t1')).toBe('active');
        });

        it('isDone=true does NOT flip lifecycle to idle (heuristic-silence false-positive guard)', () => {
            spawn('t1');
            updateTerminalIsDone('t1', true);
            expect(lifecycleOf('t1')).not.toBe('idle');
        });

        it('toggling isDone never surfaces idle in the UI lifecycle', () => {
            spawn('t1');
            updateTerminalIsDone('t1', false);
            expect(lifecycleOf('t1')).toBe('active');
            updateTerminalIsDone('t1', true);
            expect(lifecycleOf('t1')).not.toBe('idle');
            updateTerminalIsDone('t1', false);
            expect(lifecycleOf('t1')).toBe('active');
        });
    });

    describe('markTerminalExited classifies exit', () => {
        it('exit code 0 → lifecycle "completed"', () => {
            spawn('t1');
            markTerminalExited('t1', 0, null);
            expect(lifecycleOf('t1')).toBe('completed');
        });

        it('exit code 1 → lifecycle "errored"', () => {
            spawn('t1');
            markTerminalExited('t1', 1, null);
            expect(lifecycleOf('t1')).toBe('errored');
        });

        it('SIGSEGV crash signal → lifecycle "errored"', () => {
            spawn('t1');
            markTerminalExited('t1', null, 'SIGSEGV');
            expect(lifecycleOf('t1')).toBe('errored');
        });

        it('exit also marks status="exited" and stores signal', () => {
            spawn('t1');
            markTerminalExited('t1', 0, null);
            const rec = getTerminalRecords().find(r => r.terminalId === 't1');
            expect(rec?.status).toBe('exited');
            expect(rec?.exitCode).toBe(0);
            expect(rec?.exitSignal).toBeNull();
        });
    });

    describe('kill reason interaction', () => {
        it('user-initiated SIGTERM → lifecycle "completed"', () => {
            spawn('t1');
            markTerminalKillReason('t1', 'user');
            markTerminalExited('t1', null, 'SIGTERM');
            expect(lifecycleOf('t1')).toBe('completed');
        });

        it('external SIGTERM (no kill reason) → lifecycle "errored"', () => {
            spawn('t1');
            markTerminalExited('t1', null, 'SIGTERM');
            expect(lifecycleOf('t1')).toBe('errored');
        });

        it('user-initiated kill stays "completed" even with non-zero exit', () => {
            spawn('t1');
            markTerminalKillReason('t1', 'user');
            markTerminalExited('t1', 143, null);
            expect(lifecycleOf('t1')).toBe('completed');
        });
    });

    // =========================================================================
    // applyAgentStatus — the SOLE driver of awaiting_input now that the legacy
    // CLI-hook adapter is gone. The agent picks a typed preset when it creates a
    // progress node; the preset maps to a lifecycle. Orchestrator-aware: a parent
    // with active children is waiting on those children, not the user, so its
    // awaiting/done preset surfaces as 'idle' (orange standby) rather than blue.
    // =========================================================================
    describe('applyAgentStatus — preset → lifecycle', () => {
        it('preset "working" → lifecycle "active"', () => {
            spawn('t1');
            applyAgentStatus('t1', {preset: 'awaiting_input'});
            applyAgentStatus('t1', {preset: 'working'});
            expect(lifecycleOf('t1')).toBe('active');
        });

        it('preset "awaiting_input" → lifecycle "awaiting_input" for leaf agents', () => {
            spawn('t1');
            updateTerminalIsDone('t1', false);
            applyAgentStatus('t1', {preset: 'awaiting_input'});
            expect(lifecycleOf('t1')).toBe('awaiting_input');
        });

        it('preset "done" → lifecycle "completed" (explicit self-report, not a per-turn signal)', () => {
            // The legacy Claude Stop hook fired every turn, so 'done' could not be
            // trusted as completion. Now 'done' is an explicit agent choice on a
            // progress node — it genuinely means the task is finished.
            spawn('t1');
            applyAgentStatus('t1', {preset: 'working'});
            applyAgentStatus('t1', {preset: 'done'});
            expect(lifecycleOf('t1')).toBe('completed');
        });

        it('preset "failed" → lifecycle "errored"', () => {
            spawn('t1');
            applyAgentStatus('t1', {preset: 'working'});
            applyAgentStatus('t1', {preset: 'failed'});
            expect(lifecycleOf('t1')).toBe('errored');
        });

        it('no-op on unknown terminalId', () => {
            applyAgentStatus('ghost', {preset: 'awaiting_input'});
            expect(lifecycleOf('ghost')).toBe('MISSING');
        });
    });

    describe('applyAgentStatus — orchestrator standby (parent with active children)', () => {
        it('preset "awaiting_input" on orchestrator with active child → "idle", not blue', () => {
            spawn('parent-1');
            spawn('child-1', 'parent-1');
            applyAgentStatus('parent-1', {preset: 'awaiting_input'});
            expect(lifecycleOf('parent-1')).toBe('idle');
        });

        it('preset "done" on orchestrator with active child → "idle" (children still running)', () => {
            spawn('parent-1');
            spawn('child-1', 'parent-1');
            applyAgentStatus('parent-1', {preset: 'done'});
            expect(lifecycleOf('parent-1')).toBe('idle');
        });

        it('preset "awaiting_input" on parent with all-exited children → "awaiting_input"', () => {
            spawn('parent-1');
            spawn('child-1', 'parent-1');
            markTerminalExited('child-1', 0, null);
            applyAgentStatus('parent-1', {preset: 'awaiting_input'});
            expect(lifecycleOf('parent-1')).toBe('awaiting_input');
        });
    });

    // lastReportedStatus records what the agent *declared*, independent of the
    // orchestrator downgrade that renders done/awaiting as idle. The finish gate
    // (requireDeclaredStatus) reads it to tell "idle because reported done" from
    // "idle because output merely stopped".
    describe('applyAgentStatus — lastReportedStatus tracking', () => {
        it('is null on a freshly spawned terminal', () => {
            spawn('t1');
            expect(lastReportedStatusOf('t1')).toBeNull();
        });

        it('records the declared preset on a leaf agent', () => {
            spawn('t1');
            applyAgentStatus('t1', {preset: 'working'});
            expect(lastReportedStatusOf('t1')).toBe('working');
            applyAgentStatus('t1', {preset: 'done'});
            expect(lastReportedStatusOf('t1')).toBe('done');
            expect(lifecycleOf('t1')).toBe('completed');
        });

        it('records "done" on an orchestrator even though lifecycle is downgraded to idle', () => {
            spawn('parent-1');
            spawn('child-1', 'parent-1');
            applyAgentStatus('parent-1', {preset: 'done'});
            // The whole point: lifecycle is lossy here, lastReportedStatus is not.
            expect(lifecycleOf('parent-1')).toBe('idle');
            expect(lastReportedStatusOf('parent-1')).toBe('done');
        });

        it('resets to null when the terminal re-enters active (new turn)', () => {
            spawn('parent-1');
            spawn('child-1', 'parent-1');
            applyAgentStatus('parent-1', {preset: 'done'}); // idle, lastReportedStatus=done
            updateTerminalIsDone('parent-1', false);        // output resumes → active
            expect(lifecycleOf('parent-1')).toBe('active');
            expect(lastReportedStatusOf('parent-1')).toBeNull();
        });
    });

    describe('applyAgentStatus — stickiness against finished states', () => {
        it('does not override completed lifecycle', () => {
            spawn('t1');
            markTerminalExited('t1', 0, null);
            applyAgentStatus('t1', {preset: 'working'});
            expect(lifecycleOf('t1')).toBe('completed');
            applyAgentStatus('t1', {preset: 'awaiting_input'});
            expect(lifecycleOf('t1')).toBe('completed');
        });

        it('does not override errored lifecycle', () => {
            spawn('t1');
            markTerminalExited('t1', 1, null);
            applyAgentStatus('t1', {preset: 'awaiting_input'});
            expect(lifecycleOf('t1')).toBe('errored');
        });
    });

    describe('applyAgentStatus — free-text status phrase', () => {
        it('stores the phrase on the terminal record', () => {
            spawn('t1');
            applyAgentStatus('t1', {preset: 'working', phrase: 'refactoring the spawn pipeline'});
            expect(statusPhraseOf('t1')).toBe('refactoring the spawn pipeline');
            expect(lifecycleOf('t1')).toBe('active');
        });

        it('phrase can be set without a preset (lifecycle unchanged)', () => {
            spawn('t1');
            updateTerminalIsDone('t1', false); // active
            applyAgentStatus('t1', {phrase: 'still chugging'});
            expect(statusPhraseOf('t1')).toBe('still chugging');
            expect(lifecycleOf('t1')).toBe('active');
        });

        it('truncates an over-long phrase to MAX_STATUS_PHRASE_LENGTH', () => {
            spawn('t1');
            const long = 'x'.repeat(MAX_STATUS_PHRASE_LENGTH + 50);
            applyAgentStatus('t1', {preset: 'working', phrase: long});
            expect(statusPhraseOf('t1')).toHaveLength(MAX_STATUS_PHRASE_LENGTH);
        });

        it('empty status object is a no-op (no preset, no phrase)', () => {
            spawn('t1');
            updateTerminalIsDone('t1', false);
            applyAgentStatus('t1', {});
            expect(lifecycleOf('t1')).toBe('active');
            expect(statusPhraseOf('t1')).toBe('');
        });
    });

    describe('terminal-state stickiness against subsequent updateTerminalIsDone', () => {
        it('once completed, updateTerminalIsDone does not flip lifecycle', () => {
            spawn('t1');
            markTerminalExited('t1', 0, null);
            expect(lifecycleOf('t1')).toBe('completed');
            updateTerminalIsDone('t1', false);
            expect(lifecycleOf('t1')).toBe('completed');
            updateTerminalIsDone('t1', true);
            expect(lifecycleOf('t1')).toBe('completed');
        });

        it('once errored, updateTerminalIsDone does not flip lifecycle', () => {
            spawn('t1');
            markTerminalExited('t1', 1, null);
            updateTerminalIsDone('t1', false);
            expect(lifecycleOf('t1')).toBe('errored');
        });
    });

    // =========================================================================
    // SSE broadcast — every lifecycle/status transition must reach the
    // renderer's cache mirror as a `terminal-record-changed` patch.
    // `notifyRegistrySubscribers` only fans out to in-daemon listeners, so
    // without these the sidebar froze at the spawn-time state.
    // =========================================================================
    describe('transitions are broadcast over the SSE topic', () => {
        const published: TerminalRegistryEvent[] = [];

        beforeEach(() => {
            published.length = 0;
            setPublishTerminalRegistryEvent((event: TerminalRegistryEvent): void => {
                published.push(event);
            });
        });

        afterEach(() => {
            setPublishTerminalRegistryEvent(undefined);
        });

        function patchValuesFor(id: string, kind: string): unknown[] {
            return published
                .filter((e): e is Extract<TerminalRegistryEvent, {type: 'terminal-record-changed'}> =>
                    e.type === 'terminal-record-changed' && e.terminalId === id)
                .filter(e => e.patch.kind === kind)
                .map(e => (e.patch as {value: unknown}).value);
        }

        it('output-driven flip (isDone=false) broadcasts lifecycle "active"', () => {
            spawn('t1');
            updateTerminalIsDone('t1', false);
            expect(patchValuesFor('t1', 'lifecycle')).toContain('active');
        });

        it('agent preset "awaiting_input" broadcasts lifecycle "awaiting_input"', () => {
            spawn('t1');
            updateTerminalIsDone('t1', false);
            applyAgentStatus('t1', {preset: 'awaiting_input'});
            expect(patchValuesFor('t1', 'lifecycle')).toContain('awaiting_input');
        });

        it('status phrase broadcasts a statusPhrase patch', () => {
            spawn('t1');
            applyAgentStatus('t1', {phrase: 'building the thing'});
            expect(patchValuesFor('t1', 'statusPhrase')).toContain('building the thing');
        });

        it('process exit broadcasts the classified terminal lifecycle', () => {
            spawn('t1');
            markTerminalExited('t1', 0, null);
            expect(patchValuesFor('t1', 'lifecycle')).toContain('completed');
        });

        it('no redundant lifecycle patch when the value does not change', () => {
            spawn('t1');
            updateTerminalIsDone('t1', false);          // spawning → active (1 patch)
            applyAgentStatus('t1', {preset: 'working'}); // active → active (no change)
            expect(patchValuesFor('t1', 'lifecycle')).toEqual(['active']);
        });
    });
});

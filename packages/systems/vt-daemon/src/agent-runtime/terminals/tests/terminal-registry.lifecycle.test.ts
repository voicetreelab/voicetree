/**
 * Black-box tests for the lifecycle wiring in terminal-registry.
 *
 * Verifies:
 *   - recordTerminalSpawn initializes lifecycle to 'spawning'
 *   - updateTerminalIsDone dual-writes lifecycle (active ↔ idle)
 *   - markTerminalExited classifies exit code/signal into completed/errored
 *   - markTerminalKillReason makes a subsequent SIGTERM classify as completed
 *   - terminal states (completed/errored) are sticky against further isDone updates
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
    updateTerminalStatus,
} from '../terminal-registry';
import {
    setPublishTerminalRegistryEvent,
} from '../terminal-registry/terminal-registry-publisher';
import type {TerminalRegistryEvent} from '@vt/vt-daemon-protocol';

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

describe('terminal-registry lifecycle wiring', () => {
    beforeEach(() => clearTerminalRecords());

    describe('initial state', () => {
        it('newly spawned terminal has lifecycle "spawning"', () => {
            spawn('t1');
            expect(lifecycleOf('t1')).toBe('spawning');
        });
    });

    describe('updateTerminalIsDone — heuristic silence does not flip UI lifecycle to idle', () => {
        it('isDone=false → lifecycle "active"', () => {
            spawn('t1');
            updateTerminalIsDone('t1', false);
            expect(lifecycleOf('t1')).toBe('active');
        });

        it('isDone=true does NOT flip lifecycle to idle (heuristic-silence false-positive guard)', () => {
            // Lifecycle is the UI signal. A 5s output pause is not a reliable
            // "agent done" indicator — Claude Code / Codex pause naturally during
            // thinking and tool execution. The poller's isDone flag is kept for
            // the MCP wait_for_agents path, but must not surface as 'idle' here.
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
    // Agent-declared status — set via create_graph (updateTerminalStatus).
    // Independent of lifecycle (pure PTY/exit liveness): a status declaration
    // sets statusPreset + liveStatus but must NOT move the lifecycle icon.
    // =========================================================================
    describe('updateTerminalStatus — agent-declared status', () => {
        function statusOf(id: string): {preset: string | undefined; live: string | undefined} {
            const rec = getTerminalRecords().find(r => r.terminalId === id);
            return {preset: rec?.terminalData.statusPreset, live: rec?.terminalData.liveStatus};
        }

        it('sets statusPreset + liveStatus on the record', () => {
            spawn('t1');
            updateTerminalStatus('t1', {statusPreset: 'implementing', liveStatus: 'wiring the route'});
            expect(statusOf('t1')).toEqual({preset: 'implementing', live: 'wiring the route'});
        });

        it('does not move the lifecycle icon (status is orthogonal to liveness)', () => {
            spawn('t1');
            updateTerminalIsDone('t1', false); // → active
            updateTerminalStatus('t1', {statusPreset: 'blocked', liveStatus: 'need creds'});
            expect(lifecycleOf('t1')).toBe('active');
        });

        it('truncates an over-long live phrase and drops a blank one', () => {
            spawn('t1');
            const long = 'x'.repeat(200);
            updateTerminalStatus('t1', {statusPreset: 'verifying', liveStatus: long});
            expect((statusOf('t1').live ?? '').length).toBe(48);
            updateTerminalStatus('t1', {statusPreset: 'done', liveStatus: '   '});
            expect(statusOf('t1').live).toBeUndefined();
        });

        it('records status on an exited terminal (final "done" survives)', () => {
            spawn('t1');
            markTerminalExited('t1', 0, null);
            updateTerminalStatus('t1', {statusPreset: 'done', liveStatus: undefined});
            expect(statusOf('t1').preset).toBe('done');
            expect(lifecycleOf('t1')).toBe('completed');
        });

        it('no-op on unknown terminalId', () => {
            updateTerminalStatus('ghost', {statusPreset: 'planning', liveStatus: 'x'});
            expect(lifecycleOf('ghost')).toBe('MISSING');
        });

        it('no-op when neither preset nor phrase is supplied', () => {
            spawn('t1');
            updateTerminalStatus('t1', {statusPreset: undefined, liveStatus: undefined});
            expect(statusOf('t1')).toEqual({preset: undefined, live: undefined});
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
    // SSE broadcast — every lifecycle transition must reach the renderer's
    // cache mirror as a `terminal-record-changed` / `lifecycle` patch.
    // `notifyRegistrySubscribers` only fans out to in-daemon listeners, so
    // without these the sidebar icon froze at the spawn-time 'spawning' dot
    // for every terminal regardless of true state (the reported regression).
    //
    // The publisher is the runtime's public output edge; we capture it rather
    // than asserting on internal calls.
    // =========================================================================
    describe('lifecycle transitions are broadcast over the SSE topic', () => {
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

        function lifecyclePatchesFor(id: string): string[] {
            return published
                .filter((e): e is Extract<TerminalRegistryEvent, {type: 'terminal-record-changed'}> =>
                    e.type === 'terminal-record-changed' && e.terminalId === id)
                .filter(e => e.patch.kind === 'lifecycle')
                .map(e => (e.patch as {kind: 'lifecycle'; value: string}).value);
        }

        function statusPatchesFor(id: string): Array<{statusPreset: string | undefined; liveStatus: string | undefined; statusUpdatedAt: number | undefined}> {
            return published
                .filter((e): e is Extract<TerminalRegistryEvent, {type: 'terminal-record-changed'}> =>
                    e.type === 'terminal-record-changed' && e.terminalId === id)
                .filter(e => e.patch.kind === 'status')
                .map(e => (e.patch as {kind: 'status'; value: {statusPreset: string | undefined; liveStatus: string | undefined; statusUpdatedAt: number | undefined}}).value);
        }

        it('output-driven flip (isDone=false) broadcasts lifecycle "active"', () => {
            spawn('t1');
            updateTerminalIsDone('t1', false);
            expect(lifecyclePatchesFor('t1')).toContain('active');
        });

        it('agent-declared status broadcasts a "status" patch (not a lifecycle patch)', () => {
            spawn('t1');
            updateTerminalStatus('t1', {statusPreset: 'planning', liveStatus: 'scoping'});
            const patches = statusPatchesFor('t1');
            expect(patches).toHaveLength(1);
            expect(patches[0]).toMatchObject({statusPreset: 'planning', liveStatus: 'scoping'});
            expect(typeof patches[0].statusUpdatedAt).toBe('number');
            expect(lifecyclePatchesFor('t1')).toEqual([]);
        });

        it('process exit broadcasts the classified terminal lifecycle', () => {
            spawn('t1');
            markTerminalExited('t1', 0, null);
            expect(lifecyclePatchesFor('t1')).toContain('completed');
        });
    });
});

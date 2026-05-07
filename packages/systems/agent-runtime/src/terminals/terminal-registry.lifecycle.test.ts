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

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { createTerminalData } from '../types';
import type { TerminalData, TerminalId } from '../types';
import type { NodeIdAndFilePath } from '@vt/graph-model/graph';
import {
    recordTerminalSpawn,
    getTerminalRecords,
    clearTerminalRecords,
    updateTerminalIsDone,
    markTerminalExited,
    markTerminalKillReason,
    updateTerminalPromptDetected,
} from './terminal-registry';

const mockSendTextToTerminal: Mock = vi.fn().mockResolvedValue({ success: true });
vi.mock('../inject/send-text-to-terminal', () => ({
    sendTextToTerminal: (terminalId: string, text: string): Promise<{ success: boolean }> =>
        mockSendTextToTerminal(terminalId, text),
}));

function spawn(id: string): TerminalData {
    const data: TerminalData = createTerminalData({
        terminalId: id as TerminalId,
        attachedToNodeId: '/tmp/ctx.md' as NodeIdAndFilePath,
        terminalCount: 1,
        title: 'test',
        agentName: 'TestAgent',
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

    describe('updateTerminalIsDone dual-writes lifecycle', () => {
        it('isDone=false → lifecycle "active"', () => {
            spawn('t1');
            updateTerminalIsDone('t1', false);
            expect(lifecycleOf('t1')).toBe('active');
        });

        it('isDone=true → lifecycle "idle"', () => {
            spawn('t1');
            updateTerminalIsDone('t1', true);
            expect(lifecycleOf('t1')).toBe('idle');
        });

        it('toggling isDone toggles lifecycle between active and idle', () => {
            spawn('t1');
            updateTerminalIsDone('t1', false);
            expect(lifecycleOf('t1')).toBe('active');
            updateTerminalIsDone('t1', true);
            expect(lifecycleOf('t1')).toBe('idle');
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

    describe('updateTerminalPromptDetected', () => {
        it('detected=true → lifecycle "awaiting_input"', () => {
            spawn('t1');
            updateTerminalIsDone('t1', false);
            updateTerminalPromptDetected('t1', true);
            expect(lifecycleOf('t1')).toBe('awaiting_input');
        });

        it('detected=false (cleared) returns to active when isDone=false', () => {
            spawn('t1');
            updateTerminalIsDone('t1', false);
            updateTerminalPromptDetected('t1', true);
            updateTerminalPromptDetected('t1', false);
            expect(lifecycleOf('t1')).toBe('active');
        });

        it('detected=false (cleared) returns to idle when isDone=true', () => {
            spawn('t1');
            updateTerminalIsDone('t1', true);
            updateTerminalPromptDetected('t1', true);
            updateTerminalPromptDetected('t1', false);
            expect(lifecycleOf('t1')).toBe('idle');
        });

        it('does not override completed lifecycle', () => {
            spawn('t1');
            markTerminalExited('t1', 0, null);
            updateTerminalPromptDetected('t1', true);
            expect(lifecycleOf('t1')).toBe('completed');
        });

        it('does not override errored lifecycle', () => {
            spawn('t1');
            markTerminalExited('t1', 1, null);
            updateTerminalPromptDetected('t1', true);
            expect(lifecycleOf('t1')).toBe('errored');
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
});

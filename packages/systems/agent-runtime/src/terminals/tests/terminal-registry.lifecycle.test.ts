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
import { createTerminalData } from '../../types';
import type { TerminalData, TerminalId } from '../../types';
import type { NodeIdAndFilePath } from '@vt/graph-model/graph';
import {
    recordTerminalSpawn,
    getTerminalRecords,
    clearTerminalRecords,
    updateTerminalIsDone,
    markTerminalExited,
    markTerminalKillReason,
    updateTerminalPromptDetected,
} from '../terminal-registry';

const mockSendTextToTerminal: Mock = vi.fn().mockResolvedValue({ success: true });
vi.mock('../../inject/send-text-to-terminal', () => ({
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

        it('detected=false (cleared) returns to active even when poller says isDone=true', () => {
            // Pre-fix this fell back to 'idle' via the heuristic isDone flag,
            // which reintroduced the green-flicker false-positive after a real
            // prompt was answered. Now we always fall back to 'active'.
            spawn('t1');
            updateTerminalIsDone('t1', true);
            updateTerminalPromptDetected('t1', true);
            updateTerminalPromptDetected('t1', false);
            expect(lifecycleOf('t1')).toBe('active');
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

    // =========================================================================
    // Orchestrator standby — when a parent terminal has active children, the
    // parent is by definition waiting on those children, not on the user.
    // The lifecycle indicator must reflect that as 'idle' (orange standby),
    // not 'awaiting_input' (BLUE — reserved for genuine user-input prompts).
    //
    // Background: the Tier-3 prompt detector runs against the orchestrator's
    // visible buffer. If a stale numbered-choice frame from a previous
    // permission box is still in the trailing 8 lines during a quiescent
    // wait_for_agents call, it matches numbered_choice_arrow (high confidence)
    // and flips lifecycle to 'awaiting_input'. The orchestrator is not
    // genuinely awaiting input — it's waiting on its children to finish.
    // =========================================================================
    describe('orchestrator standby — parent with active children does not go awaiting_input', () => {
        it('parent with active child + prompt detected → "idle" (not "awaiting_input")', () => {
            spawn('parent-1');
            spawn('child-1', 'parent-1');
            updateTerminalIsDone('parent-1', false);
            updateTerminalPromptDetected('parent-1', true);
            expect(lifecycleOf('parent-1')).toBe('idle');
        });

        it('parent with active child + isDone=true → "idle" (orchestrator drops out of active spinner)', () => {
            spawn('parent-1');
            spawn('child-1', 'parent-1');
            updateTerminalIsDone('parent-1', false); // becomes active
            updateTerminalIsDone('parent-1', true);  // poller fires while waiting on child
            expect(lifecycleOf('parent-1')).toBe('idle');
        });

        it('parent with NO children + prompt detected → "awaiting_input" (regression — leaf agents still go blue)', () => {
            spawn('solo-1');
            updateTerminalIsDone('solo-1', false);
            updateTerminalPromptDetected('solo-1', true);
            expect(lifecycleOf('solo-1')).toBe('awaiting_input');
        });

        it('parent with all-exited children + prompt detected → "awaiting_input" (no longer orchestrating)', () => {
            spawn('parent-1');
            spawn('child-1', 'parent-1');
            markTerminalExited('child-1', 0, null);
            updateTerminalPromptDetected('parent-1', true);
            expect(lifecycleOf('parent-1')).toBe('awaiting_input');
        });

        it('parent goes idle while children active, then child exits and prompt re-detected → "awaiting_input"', () => {
            // The standby state is bound to the children-still-running condition.
            // Once children finish, prompt detection should resolve as it does
            // for any leaf agent — flipping to awaiting_input is correct.
            spawn('parent-1');
            spawn('child-1', 'parent-1');
            updateTerminalPromptDetected('parent-1', true);
            expect(lifecycleOf('parent-1')).toBe('idle');
            markTerminalExited('child-1', 0, null);
            updateTerminalPromptDetected('parent-1', false);
            updateTerminalPromptDetected('parent-1', true);
            expect(lifecycleOf('parent-1')).toBe('awaiting_input');
        });

        it('parent in idle (children active), prompt cleared → stays idle (not "active")', () => {
            // While children are still running, clearing the prompt should
            // fall back to idle (standby), not active (spinning amber).
            spawn('parent-1');
            spawn('child-1', 'parent-1');
            updateTerminalPromptDetected('parent-1', true);
            expect(lifecycleOf('parent-1')).toBe('idle');
            updateTerminalPromptDetected('parent-1', false);
            expect(lifecycleOf('parent-1')).toBe('idle');
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

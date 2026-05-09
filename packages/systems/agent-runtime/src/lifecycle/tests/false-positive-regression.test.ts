/**
 * Regression tests for false-positive lifecycle transitions.
 *
 * Covers the bug where the terminal tab indicator briefly turns:
 *   - GREEN (✓ "done") while the agent is still running through a normal
 *     thinking / tool-execution pause, and
 *   - BLUE ("awaiting user input") on plain narrative output that happens
 *     to end with "?" (e.g. "Should I proceed with the migration?").
 *
 * Both signals must work for Claude Code AND Codex — the heuristics live in
 * shared layers so the fix has to be agent-agnostic.
 *
 * The lifecycle UI must not flag idle/awaiting_input from time- or shape-only
 * heuristics that fire during normal output; those states must require a
 * higher-confidence signal (a real exit, or a high-confidence prompt match).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTerminalData } from '../../types';
import type { TerminalData, TerminalId } from '../../types';
import type { NodeIdAndFilePath } from '@vt/graph-model/pure/graph';
import {
    recordTerminalSpawn,
    getTerminalRecords,
    clearTerminalRecords,
    updateTerminalIsDone,
} from '../../terminals/terminal-registry';
import {
    startPromptDetection,
    feedPromptDetector,
    __resetAllRunnersForTests,
    __setNowForTests,
    __tickForTests,
    type PromptStateChange,
} from '../prompt-runner';

const TERMINAL_ID: string = 't-fp';

function spawn(id: string, agentName: string = 'TestAgent'): TerminalData {
    const data: TerminalData = createTerminalData({
        terminalId: id as TerminalId,
        attachedToNodeId: '/tmp/ctx.md' as NodeIdAndFilePath,
        terminalCount: 1,
        title: 'test',
        agentName,
    });
    recordTerminalSpawn(id, data);
    return data;
}

function lifecycleOf(id: string): string {
    const records = getTerminalRecords();
    const rec = records.find(r => r.terminalId === id);
    return rec?.terminalData.lifecycle ?? 'MISSING';
}

// =============================================================================
// Green flicker — heuristic silence must not flip the UI to "idle".
// =============================================================================

describe('green-flicker — UI lifecycle must not flag idle from heuristic silence', () => {
    beforeEach(() => clearTerminalRecords());

    it('Claude Code: a 5s output pause (poller fires isDone=true) must not flip lifecycle to idle', () => {
        // Reproduces the user-visible flash: agent narrates, then is silent for
        // a few seconds while reading a file or thinking. The inactivity poller
        // calls updateTerminalIsDone(true), which today flips lifecycle to 'idle'
        // → green ✓ tab. The agent has not actually finished running.
        spawn('cc-1', 'Claude Code');
        updateTerminalIsDone('cc-1', false); // first byte of narration: active
        updateTerminalIsDone('cc-1', true);  // 5s later, poller fires (still mid-task)
        expect(lifecycleOf('cc-1')).not.toBe('idle');
    });

    it('Codex: same 5s pause must not flip lifecycle to idle', () => {
        spawn('codex-1', 'codex');
        updateTerminalIsDone('codex-1', false);
        updateTerminalIsDone('codex-1', true);
        expect(lifecycleOf('codex-1')).not.toBe('idle');
    });

    it('toggling poller signal active→idle→active never surfaces idle (mid-toggle UI flash)', () => {
        spawn('cc-2', 'Claude Code');
        updateTerminalIsDone('cc-2', false); // active
        updateTerminalIsDone('cc-2', true);  // poller-driven; must NOT show as idle
        expect(lifecycleOf('cc-2')).not.toBe('idle');
        updateTerminalIsDone('cc-2', false); // resumed output
        expect(lifecycleOf('cc-2')).toBe('active');
    });
});

// =============================================================================
// Blue flicker — Tier-3 medium-confidence detections must not propagate.
// =============================================================================

describe('blue-flicker — prompt-runner must not propagate medium-confidence narrative ?', () => {
    let now: number;
    let events: { id: string; change: PromptStateChange }[];

    beforeEach(() => {
        now = 1_000_000;
        __setNowForTests(() => now);
        events = [];
        __resetAllRunnersForTests();
    });

    afterEach(() => {
        __resetAllRunnersForTests();
        __setNowForTests(Date.now);
    });

    function startStandard(): void {
        startPromptDetection(
            TERMINAL_ID,
            { onStateChange: (id, change) => events.push({ id, change }) },
            { quiescenceMs: 800, pollIntervalMs: 60_000 },
        );
    }

    it('Claude Code narrating "Should I proceed with the migration?" does NOT fire detected', async () => {
        // The detector classifies a `?`-ending narrative line as 'awaiting'
        // with MEDIUM confidence (generic_question_mark). Medium confidence
        // is inherently ambiguous between narration and a real prompt — it
        // must not propagate as an awaiting-input signal to the UI.
        startStandard();
        await feedPromptDetector(TERMINAL_ID, 'Reading the migration file...\r\n');
        await feedPromptDetector(TERMINAL_ID, 'Should I proceed with the migration?\r\n');
        now += 1000; // exceed quiescence
        await __tickForTests(TERMINAL_ID);
        expect(events).toHaveLength(0);
    });

    it('Codex narrating "What language do you want to use?" does NOT fire detected', async () => {
        startStandard();
        await feedPromptDetector(TERMINAL_ID, 'Considering options.\r\n');
        await feedPromptDetector(TERMINAL_ID, 'What language do you want to use?\r\n');
        now += 1000;
        await __tickForTests(TERMINAL_ID);
        expect(events).toHaveLength(0);
    });

    it('genuine high-confidence prompt (Y/N) still fires detected', async () => {
        // Sanity: removing medium-confidence propagation must not break high-
        // confidence detection. Y/N prompts remain a real awaiting signal.
        startStandard();
        await feedPromptDetector(TERMINAL_ID, 'Continue? (y/n)');
        now += 1000;
        await __tickForTests(TERMINAL_ID);
        expect(events).toHaveLength(1);
        expect(events[0].change.kind).toBe('detected');
        if (events[0].change.kind === 'detected') {
            expect(events[0].change.confidence).toBe('high');
        }
    });
});

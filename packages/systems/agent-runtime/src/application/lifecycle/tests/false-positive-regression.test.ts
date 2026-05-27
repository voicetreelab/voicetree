/**
 * Regression tests for false-positive lifecycle transitions.
 *
 * Specifically: the lifecycle UI must not flag 'idle' from time-only
 * heuristics that fire during normal output. Only the `tick` event in
 * the pure derive machine, OR a sustained orchestrator-with-children
 * condition, may produce 'idle'.
 *
 * (The Tier-3 heuristic prompt detector that previously caused
 * false-positive BLUE was deleted once agent hooks proved adequate.
 * Its regression tests were retired with it.)
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createTerminalData } from '@vt/vt-daemon/terminals/terminal-registry/types';
import type { TerminalData, TerminalId } from '@vt/vt-daemon/terminals/terminal-registry/types';
import type { NodeIdAndFilePath } from '@vt/graph-model/pure/graph';
import {
    recordTerminalSpawn,
    getTerminalRecords,
    clearTerminalRecords,
    updateTerminalIsDone,
} from '@vt/vt-daemon/terminals/terminal-registry';

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

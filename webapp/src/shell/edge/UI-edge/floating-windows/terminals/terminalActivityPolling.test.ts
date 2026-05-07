// @vitest-environment jsdom
/**
 * Black-box tests for terminalActivityPolling — the renderer-side handler that
 * decides when a PTY data event should request the main process to flip a
 * terminal's lifecycle to 'active'.
 *
 * Coverage gap closed: the only previously-tested transition was idle → active.
 * Fresh terminals start at lifecycle: 'spawning' (with isDone: false), so the
 * old `if (terminal.isDone)` gate skipped them entirely — leaving the sidebar
 * dot stuck on the muted-grey 'spawning' style even while the agent produced
 * output.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    startTerminalActivityPolling,
    stopTerminalActivityPolling,
} from './terminalActivityPolling';
import { syncFromMain, clearTerminals } from '@/shell/edge/UI-edge/state/TerminalStore';
import { resetAgentTabsStore } from '@/shell/edge/UI-edge/state/AgentTabsStore';
import { createTerminalData } from '@vt/agent-runtime';
import type { TerminalRecord } from '@vt/agent-runtime';
import type { NodeIdAndFilePath } from '@vt/graph-model/pure/graph';
import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import type { TerminalLifecycle } from '@vt/agent-runtime';

type DataCallback = (terminalId: string, data: string) => void;

interface TestHarness {
    fireOutput: (terminalId: string, data: string) => void;
    isDoneCalls: ReadonlyArray<{ readonly id: string; readonly isDone: boolean }>;
    activityStateCalls: ReadonlyArray<{ readonly id: string; readonly updates: unknown }>;
}

function installElectronAPI(): TestHarness {
    let onDataCb: DataCallback | null = null;
    const isDoneCalls: Array<{ id: string; isDone: boolean }> = [];
    const activityStateCalls: Array<{ id: string; updates: unknown }> = [];

    // @ts-expect-error - test stub fills only the surface terminalActivityPolling touches
    window.electronAPI = {
        terminal: {
            onData: (cb: DataCallback): (() => void) => {
                onDataCb = cb;
                return (): void => { onDataCb = null; };
            },
        },
        main: {
            updateTerminalIsDone: (id: string, isDone: boolean): void => {
                isDoneCalls.push({ id, isDone });
            },
            updateTerminalActivityState: (id: string, updates: unknown): void => {
                activityStateCalls.push({ id, updates });
            },
        },
    };

    return {
        fireOutput: (terminalId: string, data: string): void => {
            if (!onDataCb) throw new Error('startTerminalActivityPolling did not subscribe');
            onDataCb(terminalId, data);
        },
        isDoneCalls,
        activityStateCalls,
    };
}

function recordWithLifecycle(
    terminalId: string,
    lifecycle: TerminalLifecycle,
    isDone: boolean,
): TerminalRecord {
    const data = createTerminalData({
        terminalId: terminalId as TerminalId,
        attachedToNodeId: '/tmp/ctx.md' as NodeIdAndFilePath,
        terminalCount: 0,
        title: 't',
        agentName: 'A',
    });
    return {
        terminalId,
        terminalData: { ...data, lifecycle, isDone },
        status: 'running',
        exitCode: null,
        exitSignal: null,
        killReason: null,
        auditRetryCount: 0,
        spawnedAt: Date.now(),
    };
}

describe('terminalActivityPolling onData → flip-to-active', () => {
    let harness: TestHarness;

    beforeEach(() => {
        clearTerminals();
        resetAgentTabsStore();
        vi.useFakeTimers();
        harness = installElectronAPI();
    });

    afterEach(() => {
        stopTerminalActivityPolling();
        vi.useRealTimers();
        Reflect.deleteProperty(window, 'electronAPI');
        clearTerminals();
        resetAgentTabsStore();
    });

    it('flips a freshly-spawned terminal (lifecycle="spawning") to active on first output', () => {
        // The bug: spawning terminals have isDone=false, so the old
        // `if (terminal.isDone)` gate never fired the IPC and the sidebar dot
        // stayed muted-grey while output flowed.
        syncFromMain([recordWithLifecycle('t-spawn', 'spawning', false)]);
        startTerminalActivityPolling();

        harness.fireOutput('t-spawn', 'hello from claude');

        expect(harness.isDoneCalls).toEqual([{ id: 't-spawn', isDone: false }]);
    });

    it('still flips an idle terminal (lifecycle="idle", isDone=true) to active on output', () => {
        // Regression guard for the original supported case.
        syncFromMain([recordWithLifecycle('t-idle', 'idle', true)]);
        startTerminalActivityPolling();

        harness.fireOutput('t-idle', 'resumed work');

        expect(harness.isDoneCalls).toEqual([{ id: 't-idle', isDone: false }]);
    });

    it('does not redundantly flip an already-active terminal', () => {
        syncFromMain([recordWithLifecycle('t-active', 'active', false)]);
        startTerminalActivityPolling();

        harness.fireOutput('t-active', 'more output');

        expect(harness.isDoneCalls).toEqual([]);
    });

    it('does not flip a completed terminal (sticky end-state) on stray output', () => {
        // Stickiness is enforced in the registry, but the renderer should not
        // even bother sending the IPC. This guards against extra work plus
        // any future renderer-side decisions that assume the IPC was a no-op.
        syncFromMain([recordWithLifecycle('t-done', 'completed', true)]);
        startTerminalActivityPolling();

        harness.fireOutput('t-done', 'tail bytes');

        expect(harness.isDoneCalls).toEqual([]);
    });
});

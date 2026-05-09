/**
 * Black-box tests for the prompt-detection runner.
 *
 * Strategy: feed bytes, advance the test clock, manually tick the runner,
 * assert callback invocations.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    startPromptDetection,
    feedPromptDetector,
    stopPromptDetection,
    __resetAllRunnersForTests,
    __setNowForTests,
    __tickForTests,
    type PromptStateChange,
} from '../prompt-runner';

const TERMINAL_ID: string = 't1';

describe('prompt-runner', () => {
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

    function startStandard(quiescenceMs: number = 800): void {
        startPromptDetection(
            TERMINAL_ID,
            { onStateChange: (id, change) => events.push({ id, change }) },
            { quiescenceMs, pollIntervalMs: 60_000 /* effectively disabled — drive via __tickForTests */ },
        );
    }

    it('does not fire detection before first byte', async () => {
        startStandard(0);
        await __tickForTests(TERMINAL_ID);
        expect(events).toHaveLength(0);
    });

    it('does not fire while bytes are still arriving (quiescence not met)', async () => {
        startStandard(800);
        await feedPromptDetector(TERMINAL_ID, 'Continue? (y/n)');
        // Clock has not advanced — write was just now.
        await __tickForTests(TERMINAL_ID);
        expect(events).toHaveLength(0);
    });

    it('fires "detected" after quiescence with matching prompt', async () => {
        startStandard(800);
        await feedPromptDetector(TERMINAL_ID, 'Continue? (y/n)');
        now += 1000; // exceed quiescence
        await __tickForTests(TERMINAL_ID);
        expect(events).toHaveLength(1);
        expect(events[0].change.kind).toBe('detected');
        if (events[0].change.kind === 'detected') {
            expect(events[0].change.patternId).toBe('yn_paren');
            expect(events[0].change.confidence).toBe('high');
        }
    });

    it('does not re-fire on subsequent ticks while still awaiting', async () => {
        startStandard(800);
        await feedPromptDetector(TERMINAL_ID, 'Continue? (y/n)');
        now += 1000;
        await __tickForTests(TERMINAL_ID);
        await __tickForTests(TERMINAL_ID);
        await __tickForTests(TERMINAL_ID);
        expect(events).toHaveLength(1); // only the initial detection
    });

    it('fires "cleared" eagerly when new bytes arrive after a detected prompt', async () => {
        startStandard(800);
        await feedPromptDetector(TERMINAL_ID, 'Continue? (y/n)');
        now += 1000;
        await __tickForTests(TERMINAL_ID);
        expect(events).toHaveLength(1);

        // User responded — agent is producing output again. Eager clear.
        await feedPromptDetector(TERMINAL_ID, '\r\nProceeding...');
        expect(events).toHaveLength(2);
        expect(events[1].change.kind).toBe('cleared');
    });

    it('shell prompt does NOT trigger awaiting (treated as shell_idle)', async () => {
        startStandard(800);
        await feedPromptDetector(TERMINAL_ID, 'lochlan@mac voicetree % ');
        now += 1000;
        await __tickForTests(TERMINAL_ID);
        expect(events).toHaveLength(0);
    });

    it('Claude-Code-style boxed UI fires "detected"', async () => {
        startStandard(800);
        await feedPromptDetector(TERMINAL_ID, '╭──────────────╮\r\n');
        await feedPromptDetector(TERMINAL_ID, '│ Bash command │\r\n');
        await feedPromptDetector(TERMINAL_ID, '│   git push   │\r\n');
        await feedPromptDetector(TERMINAL_ID, '│ Run this command? │\r\n');
        await feedPromptDetector(TERMINAL_ID, '│ ❯ 1. Yes     │\r\n');
        await feedPromptDetector(TERMINAL_ID, '│   2. No      │\r\n');
        await feedPromptDetector(TERMINAL_ID, '╰──────────────╯');
        now += 1000;
        await __tickForTests(TERMINAL_ID);
        expect(events).toHaveLength(1);
        expect(events[0].change.kind).toBe('detected');
    });

    it('alt-screen mode + quiescence → fires "detected"', async () => {
        startStandard(800);
        await feedPromptDetector(TERMINAL_ID, '\x1b[?1049h\x1b[2JTUI rendered');
        now += 1000;
        await __tickForTests(TERMINAL_ID);
        expect(events).toHaveLength(1);
        expect(events[0].change.kind).toBe('detected');
        if (events[0].change.kind === 'detected') {
            expect(events[0].change.patternId).toBe('tui_alt_screen');
        }
    });

    it('starting twice for the same terminal is idempotent', () => {
        startStandard();
        expect(() => startStandard()).not.toThrow();
    });

    it('stopPromptDetection clears state — subsequent feed is no-op', async () => {
        startStandard(800);
        await feedPromptDetector(TERMINAL_ID, 'Continue? (y/n)');
        stopPromptDetection(TERMINAL_ID);
        // Should not throw or fire callbacks
        await feedPromptDetector(TERMINAL_ID, 'more bytes');
        now += 1000;
        await __tickForTests(TERMINAL_ID);
        expect(events).toHaveLength(0);
    });

    it('feedPromptDetector on unknown terminal is silent', async () => {
        await expect(feedPromptDetector('nonexistent', 'data')).resolves.toBeUndefined();
    });

    it('full cycle: detect → clear → re-detect', async () => {
        startStandard(800);

        // First detection
        await feedPromptDetector(TERMINAL_ID, 'Continue? (y/n)');
        now += 1000;
        await __tickForTests(TERMINAL_ID);

        // User responded
        await feedPromptDetector(TERMINAL_ID, '\r\ny\r\nNext step done.\r\n');

        // Second prompt
        await feedPromptDetector(TERMINAL_ID, 'Apply changes? [Y/n]');
        now += 1000;
        await __tickForTests(TERMINAL_ID);

        const kinds: string[] = events.map(e => e.change.kind);
        expect(kinds).toEqual(['detected', 'cleared', 'detected']);
    });
});

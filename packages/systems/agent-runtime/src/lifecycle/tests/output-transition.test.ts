import { describe, it, expect } from 'vitest';
import { shouldFlipToActiveOnOutput } from '../output-transition';
import type { TerminalLifecycle } from '../types';

describe('shouldFlipToActiveOnOutput', () => {
    it('returns true for spawning (the reported bug — fresh terminals must transition to active on first output)', () => {
        expect(shouldFlipToActiveOnOutput('spawning')).toBe(true);
    });

    it('returns true for idle (resume from quiet)', () => {
        expect(shouldFlipToActiveOnOutput('idle')).toBe(true);
    });

    it('returns true for awaiting_input (output observed while waiting on user means agent resumed work — matches derive() output branch)', () => {
        expect(shouldFlipToActiveOnOutput('awaiting_input')).toBe(true);
    });

    it('returns false for active (no-op IPC suppression)', () => {
        expect(shouldFlipToActiveOnOutput('active')).toBe(false);
    });

    it('returns false for completed (sticky end state)', () => {
        expect(shouldFlipToActiveOnOutput('completed')).toBe(false);
    });

    it('returns false for errored (sticky end state)', () => {
        expect(shouldFlipToActiveOnOutput('errored')).toBe(false);
    });

    it('covers every TerminalLifecycle variant', () => {
        const all: readonly TerminalLifecycle[] = ['spawning', 'active', 'idle', 'awaiting_input', 'completed', 'errored'];
        for (const lc of all) {
            const result: boolean = shouldFlipToActiveOnOutput(lc);
            expect(typeof result).toBe('boolean');
        }
    });
});

import { describe, expect, it } from 'vitest';
import { classifyExit } from '../exit';

describe('classifyExit', () => {
    describe('user-initiated kills', () => {
        it('treats user-initiated kill as completed regardless of signal', () => {
            expect(classifyExit(null, 'SIGTERM', 'user')).toBe('completed');
            expect(classifyExit(null, 'SIGKILL', 'user')).toBe('completed');
        });

        it('treats user-initiated kill as completed even with non-zero exit code', () => {
            expect(classifyExit(143, null, 'user')).toBe('completed');
        });
    });

    describe('crash signals', () => {
        const crashes: readonly string[] = ['SIGSEGV', 'SIGABRT', 'SIGBUS', 'SIGILL', 'SIGFPE'];
        for (const sig of crashes) {
            it(`maps ${sig} to errored`, () => {
                expect(classifyExit(null, sig, null)).toBe('errored');
            });
        }
    });

    describe('external kills', () => {
        it('maps SIGTERM without user reason to errored', () => {
            expect(classifyExit(null, 'SIGTERM', null)).toBe('errored');
        });

        it('maps SIGKILL without user reason to errored', () => {
            expect(classifyExit(null, 'SIGKILL', null)).toBe('errored');
        });

        it('maps SIGHUP without user reason to errored', () => {
            expect(classifyExit(null, 'SIGHUP', null)).toBe('errored');
        });
    });

    describe('exit codes', () => {
        it('maps exit code 0 to completed', () => {
            expect(classifyExit(0, null, null)).toBe('completed');
        });

        it('maps non-zero exit code to errored', () => {
            expect(classifyExit(1, null, null)).toBe('errored');
            expect(classifyExit(127, null, null)).toBe('errored');
            expect(classifyExit(255, null, null)).toBe('errored');
        });

        it('treats null code with no signal as errored (unknown)', () => {
            expect(classifyExit(null, null, null)).toBe('errored');
        });
    });

    describe('precedence', () => {
        it('user kill reason wins over crash signal', () => {
            // Edge: VoiceTree initiated kill, but the process happened to crash mid-shutdown
            expect(classifyExit(null, 'SIGSEGV', 'user')).toBe('completed');
        });
    });
});

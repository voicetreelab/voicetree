import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateDateSubfolder } from './project-utils';

describe('generateDateSubfolder', () => {
    beforeEach(() => {
        // Mock Date to return Feb 13 (day=13, month=2)
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 1, 13)); // month is 0-indexed
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns base name when no existing names match', () => {
        const result: string = generateDateSubfolder(['other-folder', 'docs']);
        expect(result).toBe('voicetree-13-2');
    });

    it('returns base name with -1 when base already exists', () => {
        const result: string = generateDateSubfolder(['voicetree-13-2']);
        expect(result).toBe('voicetree-13-2-1');
    });

    it('returns -2 when base and -1 exist', () => {
        const result: string = generateDateSubfolder(['voicetree-13-2', 'voicetree-13-2-1']);
        expect(result).toBe('voicetree-13-2-2');
    });

    it('works with empty array (backwards compat)', () => {
        const result: string = generateDateSubfolder([]);
        expect(result).toBe('voicetree-13-2');
    });

    it('works with no arguments (backwards compat)', () => {
        const result: string = generateDateSubfolder();
        expect(result).toBe('voicetree-13-2');
    });
});

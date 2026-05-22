import { describe, it, expect } from 'vitest';
import { buildPatternAllowlist } from '../buildPatternAllowlist';

describe('buildPatternAllowlist', () => {
    it('starts the allowlist with the subfolder', () => {
        const plan = buildPatternAllowlist('/vault/voicetree', [], true);

        expect(plan.allowlist).toEqual(['/vault/voicetree']);
        expect(plan.pathsToMarkExpanded).toEqual([]);
    });

    it('appends every probe whose path exists', () => {
        const probes = [
            { patternPath: '/vault/notes', exists: true },
            { patternPath: '/vault/missing', exists: false },
            { patternPath: '/vault/extras', exists: true },
        ];

        const plan = buildPatternAllowlist('/vault/voicetree', probes, true);

        expect(plan.allowlist).toEqual([
            '/vault/voicetree',
            '/vault/notes',
            '/vault/extras',
        ]);
    });

    it('deduplicates patterns that collide with the subfolder', () => {
        const probes = [
            { patternPath: '/vault/voicetree', exists: true },
            { patternPath: '/vault/notes', exists: true },
        ];

        const plan = buildPatternAllowlist('/vault/voicetree', probes, true);

        expect(plan.allowlist).toEqual(['/vault/voicetree', '/vault/notes']);
        expect(plan.pathsToMarkExpanded).toEqual(['/vault/notes']);
    });

    it('omits expansion intents when persistDefaultExpandedPaths is false', () => {
        const probes = [
            { patternPath: '/vault/notes', exists: true },
            { patternPath: '/vault/extras', exists: true },
        ];

        const plan = buildPatternAllowlist('/vault/voicetree', probes, false);

        expect(plan.allowlist).toEqual([
            '/vault/voicetree',
            '/vault/notes',
            '/vault/extras',
        ]);
        expect(plan.pathsToMarkExpanded).toEqual([]);
    });
});

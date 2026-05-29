import { describe, it, expect } from 'vitest';
import { buildPatternAllowlist } from '../buildPatternAllowlist';

describe('buildPatternAllowlist', () => {
    it('starts the allowlist with the subfolder', () => {
        const plan = buildPatternAllowlist('/project/voicetree', [], true);

        expect(plan.allowlist).toEqual(['/project/voicetree']);
        expect(plan.pathsToMarkExpanded).toEqual([]);
    });

    it('appends every probe whose path exists', () => {
        const probes = [
            { patternPath: '/project/notes', exists: true },
            { patternPath: '/project/missing', exists: false },
            { patternPath: '/project/extras', exists: true },
        ];

        const plan = buildPatternAllowlist('/project/voicetree', probes, true);

        expect(plan.allowlist).toEqual([
            '/project/voicetree',
            '/project/notes',
            '/project/extras',
        ]);
    });

    it('deduplicates patterns that collide with the subfolder', () => {
        const probes = [
            { patternPath: '/project/voicetree', exists: true },
            { patternPath: '/project/notes', exists: true },
        ];

        const plan = buildPatternAllowlist('/project/voicetree', probes, true);

        expect(plan.allowlist).toEqual(['/project/voicetree', '/project/notes']);
        expect(plan.pathsToMarkExpanded).toEqual(['/project/notes']);
    });

    it('omits expansion intents when persistDefaultExpandedPaths is false', () => {
        const probes = [
            { patternPath: '/project/notes', exists: true },
            { patternPath: '/project/extras', exists: true },
        ];

        const plan = buildPatternAllowlist('/project/voicetree', probes, false);

        expect(plan.allowlist).toEqual([
            '/project/voicetree',
            '/project/notes',
            '/project/extras',
        ]);
        expect(plan.pathsToMarkExpanded).toEqual([]);
    });
});

import { describe, it, expect } from 'vitest';
import { selectObsidianProjectPaths } from './project-scanner';

// project-vocabulary:allow vault — these fixtures mirror Obsidian's real config,
// which keys its vault map "vaults"; the term is Obsidian's, not VoiceTree's.
//
// `pathExists` is injected as a function input (not a mocked internal dependency),
// so these stay pure black-box tests: parsed-config in, project-paths out.
const EXISTS = (): boolean => true;
const MISSING = (): boolean => false;

describe('selectObsidianProjectPaths', () => {
    it('reads vault paths from the `vaults` key (regression: code read a non-existent `projects` key)', () => {
        const config = {
            vaults: {
                h1: { path: '/repos/notes', ts: 1 },
                h2: { path: '/repos/work', ts: 2 },
            },
        };
        expect(selectObsidianProjectPaths(config, ['/repos'], EXISTS)).toEqual([
            '/repos/notes',
            '/repos/work',
        ]);
    });

    it('returns [] without throwing when `vaults` is absent — the original crash scenario', () => {
        // A fresh Obsidian install has no `vaults` key; the old code threw
        // "Cannot convert undefined or null to object" on Object.values(undefined).
        expect(selectObsidianProjectPaths({}, ['/repos'], EXISTS)).toEqual([]);
        // The historically (wrongly) assumed shape must also be inert, not fatal.
        expect(
            selectObsidianProjectPaths({ projects: { h1: { path: '/repos/x' } } }, ['/repos'], EXISTS)
        ).toEqual([]);
    });

    it('never throws on a malformed config of any shape', () => {
        const bad: unknown[] = [null, undefined, 42, 'str', [], { vaults: null }, { vaults: 'nope' }];
        for (const value of bad) {
            expect(() => selectObsidianProjectPaths(value, ['/repos'], EXISTS)).not.toThrow();
            expect(selectObsidianProjectPaths(value, ['/repos'], EXISTS)).toEqual([]);
        }
    });

    it('skips malformed vault entries but keeps the valid ones', () => {
        const config = {
            vaults: {
                ok: { path: '/repos/good', ts: 1 },
                noPath: { ts: 2 },
                wrongType: { path: 123 },
                nullEntry: null,
                emptyPath: { path: '' },
            },
        };
        expect(selectObsidianProjectPaths(config, ['/repos'], EXISTS)).toEqual(['/repos/good']);
    });

    it('filters out vaults outside the search directories', () => {
        const config = {
            vaults: {
                a: { path: '/repos/inside', ts: 1 },
                b: { path: '/elsewhere/outside', ts: 2 },
            },
        };
        expect(selectObsidianProjectPaths(config, ['/repos'], EXISTS)).toEqual(['/repos/inside']);
    });

    it('filters out vaults whose path no longer exists on disk', () => {
        const config = { vaults: { a: { path: '/repos/deleted', ts: 1 } } };
        expect(selectObsidianProjectPaths(config, ['/repos'], MISSING)).toEqual([]);
    });
});

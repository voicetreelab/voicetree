import { describe, it, expect } from 'vitest';
import { deriveFolderGroups } from './deriveFolderGroups';
import type { FolderStructure, FolderGroup } from './types';

describe('deriveFolderGroups', () => {
    describe('core derivation', () => {
        it('returns empty FolderStructure for empty input', () => {
            const result: FolderStructure = deriveFolderGroups([]);
            expect(result.folders.size).toBe(0);
            expect(result.nodeToFolder.size).toBe(0);
            expect(result.rootNodeIds).toEqual([]);
        });

        it('returns all nodes as rootNodeIds when no paths have slashes', () => {
            const result: FolderStructure = deriveFolderGroups(['readme.md', 'index.md', 'todo.md']);
            expect(result.folders.size).toBe(0);
            expect(result.rootNodeIds).toEqual(['readme.md', 'index.md', 'todo.md']);
        });

        it('creates folder for path prefix with 2+ direct child files', () => {
            const result: FolderStructure = deriveFolderGroups(['auth/login.md', 'auth/jwt.md']);
            expect(result.folders.size).toBe(1);
            const authFolder: FolderGroup | undefined = result.folders.get('auth/');
            expect(authFolder).toBeDefined();
            expect(authFolder!.childNodeIds).toEqual(['auth/login.md', 'auth/jwt.md']);
            expect(authFolder!.folderPath).toBe('auth/');
            expect(authFolder!.parentFolderPath).toBeNull();
            expect(authFolder!.depth).toBe(1);
        });

        it('filters out folders with fewer than 2 direct child files', () => {
            const result: FolderStructure = deriveFolderGroups(['auth/login.md', 'readme.md']);
            expect(result.folders.size).toBe(0);
            expect(result.rootNodeIds).toContain('auth/login.md');
            expect(result.rootNodeIds).toContain('readme.md');
        });

        it('excludes ctx-nodes/ prefix by default', () => {
            const result: FolderStructure = deriveFolderGroups([
                'ctx-nodes/a.md',
                'ctx-nodes/b.md',
                'auth/login.md',
                'auth/jwt.md'
            ], ['ctx-nodes/']);
            expect(result.folders.has('ctx-nodes/')).toBe(false);
            expect(result.folders.has('auth/')).toBe(true);
            // ctx-nodes children should be root nodes (no folder assignment)
            expect(result.rootNodeIds).toContain('ctx-nodes/a.md');
            expect(result.rootNodeIds).toContain('ctx-nodes/b.md');
        });

        it('excludes image nodes', () => {
            const result: FolderStructure = deriveFolderGroups([
                'auth/login.md',
                'auth/jwt.md',
                'auth/logo.png',
                'auth/banner.jpg'
            ]);
            // Only .md files count toward the min-2 threshold
            const authFolder: FolderGroup | undefined = result.folders.get('auth/');
            expect(authFolder).toBeDefined();
            // Image nodes are excluded from folder membership entirely
            expect(authFolder!.childNodeIds).toEqual(['auth/login.md', 'auth/jwt.md']);
        });

        it('computes depth correctly', () => {
            const result: FolderStructure = deriveFolderGroups([
                'a/b/x.md',
                'a/b/y.md',
            ]);
            const abFolder: FolderGroup | undefined = result.folders.get('a/b/');
            expect(abFolder).toBeDefined();
            expect(abFolder!.depth).toBe(2);
        });

        it('maps nodeToFolder correctly', () => {
            const result: FolderStructure = deriveFolderGroups([
                'auth/login.md',
                'auth/jwt.md',
                'readme.md'
            ]);
            expect(result.nodeToFolder.get('auth/login.md')).toBe('auth/');
            expect(result.nodeToFolder.get('auth/jwt.md')).toBe('auth/');
            expect(result.nodeToFolder.has('readme.md')).toBe(false);
        });
    });

    describe('M3: min-2 means direct child files', () => {
        it('subfolder with 2 files qualifies, parent with 0 direct files does NOT', () => {
            const result: FolderStructure = deriveFolderGroups([
                'a/b/x.md',
                'a/b/y.md',
            ]);
            expect(result.folders.has('a/b/')).toBe(true);
            expect(result.folders.has('a/')).toBe(false);
        });

        it('parent with 2 direct files qualifies even if subfolder does not', () => {
            const result: FolderStructure = deriveFolderGroups([
                'a/x.md',
                'a/y.md',
                'a/b/z.md',
            ]);
            expect(result.folders.has('a/')).toBe(true);
            expect(result.folders.has('a/b/')).toBe(false);
            // a/b/z.md is a root-level child of a/ (its immediate folder a/b/ doesn't qualify)
            // So it goes to rootNodeIds since a/b/ doesn't exist as a folder
            expect(result.rootNodeIds).toContain('a/b/z.md');
        });

        it('both parent and child qualify when each has 2+ direct files', () => {
            const result: FolderStructure = deriveFolderGroups([
                'a/x.md',
                'a/y.md',
                'a/b/p.md',
                'a/b/q.md',
            ]);
            expect(result.folders.has('a/')).toBe(true);
            expect(result.folders.has('a/b/')).toBe(true);

            const aFolder: FolderGroup | undefined = result.folders.get('a/');
            // a/'s direct children are only the files directly in a/, not in a/b/
            expect(aFolder!.childNodeIds).toEqual(['a/x.md', 'a/y.md']);

            const abFolder: FolderGroup | undefined = result.folders.get('a/b/');
            expect(abFolder!.childNodeIds).toEqual(['a/b/p.md', 'a/b/q.md']);
            expect(abFolder!.parentFolderPath).toBe('a/');
        });
    });

    describe('dissolution support (for F2 consumption)', () => {
        it('3 nodes in folder minus 1 still returns folder (2 remaining)', () => {
            const result: FolderStructure = deriveFolderGroups([
                'auth/a.md',
                'auth/b.md',
                // auth/c.md was removed
            ]);
            expect(result.folders.has('auth/')).toBe(true);
            expect(result.folders.get('auth/')!.childNodeIds.length).toBe(2);
        });

        it('2 nodes in folder minus 1 returns NO folder (below threshold)', () => {
            const result: FolderStructure = deriveFolderGroups([
                'auth/a.md',
                // auth/b.md was removed
            ]);
            expect(result.folders.has('auth/')).toBe(false);
        });
    });

    describe('deletion-aware input (for F2 consumption)', () => {
        it('with deletion filtered out, no phantom folder created', () => {
            // auth/login.md is about to be deleted, so we pass only auth/jwt.md
            const result: FolderStructure = deriveFolderGroups(['auth/jwt.md']);
            expect(result.folders.has('auth/')).toBe(false);
        });
    });

    describe('deeply nested intermediate folders', () => {
        it('only deepest folder qualifies when intermediates have no direct files', () => {
            const result: FolderStructure = deriveFolderGroups([
                'a/b/c/x.md',
                'a/b/c/y.md',
            ]);
            expect(result.folders.has('a/b/c/')).toBe(true);
            expect(result.folders.has('a/b/')).toBe(false);
            expect(result.folders.has('a/')).toBe(false);
        });

        it('multiple levels qualify when each has 2+ direct files', () => {
            const result: FolderStructure = deriveFolderGroups([
                'a/b/x.md',
                'a/b/y.md',
                'a/b/c/p.md',
                'a/b/c/q.md',
            ]);
            expect(result.folders.has('a/b/')).toBe(true);
            expect(result.folders.has('a/b/c/')).toBe(true);
            expect(result.folders.has('a/')).toBe(false);
        });

        it('sets parentFolderPath to nearest qualifying ancestor', () => {
            const result: FolderStructure = deriveFolderGroups([
                'a/b/x.md',
                'a/b/y.md',
                'a/b/c/p.md',
                'a/b/c/q.md',
            ]);
            const abcFolder: FolderGroup | undefined = result.folders.get('a/b/c/');
            expect(abcFolder!.parentFolderPath).toBe('a/b/');
        });

        it('sets parentFolderPath to null when no ancestor qualifies', () => {
            const result: FolderStructure = deriveFolderGroups([
                'a/b/c/x.md',
                'a/b/c/y.md',
            ]);
            const abcFolder: FolderGroup | undefined = result.folders.get('a/b/c/');
            expect(abcFolder!.parentFolderPath).toBeNull();
        });
    });

    describe('mixed scenarios', () => {
        it('handles multiple independent folders', () => {
            const result: FolderStructure = deriveFolderGroups([
                'auth/login.md',
                'auth/jwt.md',
                'api/routes.md',
                'api/middleware.md',
                'readme.md',
            ]);
            expect(result.folders.size).toBe(2);
            expect(result.folders.has('auth/')).toBe(true);
            expect(result.folders.has('api/')).toBe(true);
            expect(result.rootNodeIds).toEqual(['readme.md']);
        });

        it('handles nodes with exclude prefixes mixed in', () => {
            const result: FolderStructure = deriveFolderGroups([
                'ctx-nodes/a.md',
                'ctx-nodes/b.md',
                'ctx-nodes/c.md',
                'auth/x.md',
                'auth/y.md',
            ], ['ctx-nodes/']);
            expect(result.folders.has('ctx-nodes/')).toBe(false);
            expect(result.folders.has('auth/')).toBe(true);
        });
    });
});

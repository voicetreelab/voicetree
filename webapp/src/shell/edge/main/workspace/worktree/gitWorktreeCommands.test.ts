/**
 * Black-box coverage for the placement-convention-free `gitWorktreeCommands`.
 *
 * The app makes NO claim about where a worktree lives: `createWorktree` passes a
 * bare name to `git worktree add` and reads the real path back from git. These
 * tests run against a throwaway repo with PLAIN git (no git-gate wrapper on
 * PATH), so worktrees land nested under the repo — and the suite asserts the
 * observable outcome (worktree exists at the path git reports, branch created,
 * listing reflects it) without hardcoding any directory convention.
 */

import {afterEach, describe, expect, it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, realpathSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {createWorktree, listWorktrees} from './gitWorktreeCommands';

const cleanups: Array<() => void> = [];

afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()!();
});

function git(repoRoot: string, args: readonly string[]): string {
    return execFileSync('git', args, {cwd: repoRoot, stdio: 'pipe', encoding: 'utf-8'});
}

function makeRepo(): string {
    const parent: string = realpathSync(mkdtempSync(join(tmpdir(), 'vt-wt-core-')));
    cleanups.push(() => rmSync(parent, {recursive: true, force: true}));
    const repoRoot: string = join(parent, 'repo');
    mkdirSync(repoRoot, {recursive: true});
    git(repoRoot, ['init', '-q', '-b', 'main']);
    git(repoRoot, ['config', 'user.email', 'test@example.com']);
    git(repoRoot, ['config', 'user.name', 'Test']);
    git(repoRoot, ['config', 'commit.gpgsign', 'false']);
    writeFileSync(join(repoRoot, 'seed.md'), '# seed\n');
    git(repoRoot, ['add', '.']);
    git(repoRoot, ['commit', '-q', '-m', 'seed']);
    return repoRoot;
}

describe('createWorktree (discover-based)', () => {
    it('creates the branch+worktree and returns the path git actually placed it at', async () => {
        const repoRoot: string = makeRepo();

        const worktreePath: string = await createWorktree(repoRoot, 'wt-discover');

        // The returned path is whatever git reports — it exists on disk...
        expect(statSync(worktreePath).isDirectory()).toBe(true);
        // ...and git's own listing agrees the branch lives there.
        const listing: string = git(repoRoot, ['worktree', 'list', '--porcelain']);
        expect(listing).toContain(`worktree ${worktreePath}`);
        expect(listing).toContain('branch refs/heads/wt-discover');
    });

    it('runs the blocking hook with (worktreePath, worktreeName) against the discovered path', async () => {
        const repoRoot: string = makeRepo();
        const markerDir: string = realpathSync(mkdtempSync(join(tmpdir(), 'vt-wt-hook-')));
        cleanups.push(() => rmSync(markerDir, {recursive: true, force: true}));
        const markerPath: string = join(markerDir, 'marker.txt');
        const hookPath: string = join(markerDir, 'hook.sh');
        writeFileSync(hookPath, `#!/bin/sh\necho "$1 $2" > "${markerPath}"\n`, 'utf-8');
        execFileSync('chmod', ['755', hookPath]);

        const worktreePath: string = await createWorktree(repoRoot, 'wt-hooked', hookPath);

        expect(execFileSync('cat', [markerPath], {encoding: 'utf-8'}).trim()).toBe(
            `${worktreePath} wt-hooked`,
        );
    });

    it('throws when worktree creation fails (duplicate branch)', async () => {
        const repoRoot: string = makeRepo();
        await createWorktree(repoRoot, 'wt-dup');
        await expect(createWorktree(repoRoot, 'wt-dup')).rejects.toThrow(/Failed to create git worktree/);
    });
});

describe('listWorktrees (git-driven)', () => {
    it('returns linked worktrees and excludes the main checkout', async () => {
        const repoRoot: string = makeRepo();
        const pathA: string = await createWorktree(repoRoot, 'wt-alpha');
        const pathB: string = await createWorktree(repoRoot, 'wt-beta');

        const worktrees = await listWorktrees(repoRoot);
        const paths: string[] = worktrees.map(w => w.path);

        expect(paths).toContain(pathA);
        expect(paths).toContain(pathB);
        // Main checkout is never surfaced.
        expect(paths).not.toContain(repoRoot);
        // Display name strips the "wt-" prefix.
        expect(worktrees.map(w => w.name)).toEqual(expect.arrayContaining(['alpha', 'beta']));
    });

    it('returns an empty array when there are no linked worktrees', async () => {
        const repoRoot: string = makeRepo();
        expect(await listWorktrees(repoRoot)).toEqual([]);
    });
});

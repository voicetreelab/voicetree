/**
 * Black-box coverage for `gitWorktreeCommands`.
 *
 * Placement: when git-gate (the machine-level git wrapper) is on PATH it owns
 * where worktrees live and `createWorktree` passes the bare name through; when
 * git-gate is absent the app owns placement and creates the worktree at an
 * absolute path under `VT_WORKTREE_ROOT ?? <parent-of-main-checkout>/vt-wts`.
 * The decision is unit-tested via the pure `isGitGateActive` /
 * `planWorktreePlacement`; the impure `createWorktree` is exercised against
 * throwaway repos (with HOME pinned to a git-gate-free temp so the app-owned
 * path is deterministic), reading the real path back from git.
 */

import {afterEach, describe, expect, it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, delimiter, dirname, join} from 'node:path';

import {createWorktree, listWorktrees} from './gitWorktreeCommands';
import {isGitGateActive, planWorktreePlacement} from './worktreePlacement';
import {gitEnv} from './gitWorktreeInternals';

const cleanups: Array<() => void> = [];

afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()!();
});

// Strip any GIT_DIR/GIT_WORK_TREE/GIT_COMMON_DIR leaked into the test process by
// an enclosing git hook (e.g. branch-verification running under a pre-push
// hook, or the mutagen mirror) — exactly as the production `gitEnv` does — so
// the throwaway repos resolve from `cwd` and never operate on the real repo.
function git(repoRoot: string, args: readonly string[]): string {
    return execFileSync('git', args, {cwd: repoRoot, stdio: 'pipe', encoding: 'utf-8', env: gitEnv()});
}

// Set an env var for the duration of one test, restoring it in afterEach.
function setEnvUntilCleanup(key: string, value: string | undefined): void {
    const had: boolean = key in process.env;
    const prev: string | undefined = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    cleanups.push(() => {
        if (had) process.env[key] = prev as string;
        else delete process.env[key];
    });
}

// A temp HOME with no `bin/git`, so isGitGateActive() is deterministically false
// regardless of whether the test machine actually has git-gate installed (e.g. a
// dev with ~/bin/git). This pins createWorktree onto the app-owned placement path.
function gitGateFreeHome(): string {
    const home: string = realpathSync(mkdtempSync(join(tmpdir(), 'vt-wt-home-')));
    cleanups.push(() => rmSync(home, {recursive: true, force: true}));
    return home;
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

    // ROOT-CAUSE REGRESSION GUARD for "spawning in a new worktree takes 10+s":
    // `git worktree add` fires post-checkout from the BRANCH TREE just checked
    // out. A stale base whose post-checkout still runs `pnpm install` would
    // re-stall the spawn even after PR #225 (which only fixed the hook in
    // newer commits). createWorktree overrides `core.hooksPath` for THIS one
    // invocation onto an app-owned no-op dir, so the branch-tree hook is
    // bypassed regardless of how stale the base is.
    it('overrides core.hooksPath so a post-checkout checked into the branch tree does not run', async () => {
        const repoRoot: string = makeRepo();
        // Plant a "branch tree" post-checkout that writes a marker on every
        // checkout, and tell git to look there via core.hooksPath. This is the
        // exact shape of the project's real hooks dir.
        const markerDir: string = realpathSync(mkdtempSync(join(tmpdir(), 'vt-wt-stale-hook-')));
        cleanups.push(() => rmSync(markerDir, {recursive: true, force: true}));
        const markerPath: string = join(markerDir, 'stale-hook-ran.txt');
        const branchHooks: string = join(repoRoot, 'scripts', 'hooks');
        mkdirSync(branchHooks, {recursive: true});
        const branchHook: string = join(branchHooks, 'post-checkout');
        writeFileSync(branchHook, `#!/bin/sh\necho "ran" > "${markerPath}"\n`, 'utf-8');
        chmodSync(branchHook, 0o755);
        git(repoRoot, ['config', 'core.hooksPath', 'scripts/hooks']);
        git(repoRoot, ['add', '.']);
        git(repoRoot, ['commit', '-q', '-m', 'plant stale hook']);
        setEnvUntilCleanup('HOME', gitGateFreeHome());

        await createWorktree(repoRoot, 'wt-hardened');

        // The branch-tree hook MUST NOT have fired — `-c core.hooksPath=<no-op>`
        // diverted git to the app-owned dir for this invocation.
        expect(existsSync(markerPath)).toBe(false);
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

describe('isGitGateActive (resolves git on PATH like execFile does)', () => {
    const homeDir = '/Users/dev';
    const shim = '/Users/dev/bin/git';
    const execIn = (paths: readonly string[]) => {
        const set: Set<string> = new Set(paths);
        return (candidate: string): boolean => set.has(candidate);
    };

    it('true when ~/bin/git resolves first on PATH', () => {
        expect(isGitGateActive({
            pathEnv: ['/Users/dev/bin', '/opt/homebrew/bin', '/usr/bin'].join(delimiter),
            homeDir,
            isExecutable: execIn([shim, '/opt/homebrew/bin/git', '/usr/bin/git']),
        })).toBe(true);
    });

    it('false when the real git resolves first and the shim is absent', () => {
        expect(isGitGateActive({
            pathEnv: ['/opt/homebrew/bin', '/usr/bin'].join(delimiter),
            homeDir,
            isExecutable: execIn(['/opt/homebrew/bin/git', '/usr/bin/git']),
        })).toBe(false);
    });

    it('false when a stale ~/bin/git exists but is shadowed earlier on PATH', () => {
        // /opt/homebrew/bin precedes ~/bin → execFile would run the real git.
        expect(isGitGateActive({
            pathEnv: ['/opt/homebrew/bin', '/Users/dev/bin'].join(delimiter),
            homeDir,
            isExecutable: execIn(['/opt/homebrew/bin/git', shim]),
        })).toBe(false);
    });

    it('false when PATH is empty or undefined', () => {
        expect(isGitGateActive({pathEnv: '', homeDir, isExecutable: () => true})).toBe(false);
        expect(isGitGateActive({pathEnv: undefined, homeDir, isExecutable: () => true})).toBe(false);
    });

    it('false when no git is found anywhere on PATH', () => {
        expect(isGitGateActive({
            pathEnv: ['/Users/dev/bin', '/usr/bin'].join(delimiter),
            homeDir,
            isExecutable: () => false,
        })).toBe(false);
    });
});

describe('planWorktreePlacement', () => {
    const mainCheckout = '/Users/dev/voicetree';

    // No-op proof: when git-gate is active the destination argument passed to
    // `git worktree add` is the BARE name, unchanged — placement is delegated to
    // git-gate exactly as before, so git-gate users (Manu) see no change.
    it('git-gate active → bare name, app does not own placement', () => {
        expect(planWorktreePlacement({
            gitGateActive: true,
            worktreeName: 'wt-x-abc',
            mainCheckout,
            worktreeRootEnv: '/whatever/ignored',
        })).toEqual({destination: 'wt-x-abc', appOwned: false});
    });

    it('git-gate absent → absolute dest under <parent-of-main>/vt-wts', () => {
        expect(planWorktreePlacement({
            gitGateActive: false,
            worktreeName: 'wt-x-abc',
            mainCheckout,
            worktreeRootEnv: undefined,
        })).toEqual({destination: '/Users/dev/vt-wts/wt-x-abc', appOwned: true});
    });

    it('git-gate absent + VT_WORKTREE_ROOT → absolute dest under that root', () => {
        expect(planWorktreePlacement({
            gitGateActive: false,
            worktreeName: 'wt-x-abc',
            mainCheckout,
            worktreeRootEnv: '/custom/wts',
        })).toEqual({destination: '/custom/wts/wt-x-abc', appOwned: true});
    });

    it('git-gate absent + blank VT_WORKTREE_ROOT → treated as unset', () => {
        expect(planWorktreePlacement({
            gitGateActive: false,
            worktreeName: 'wt-x-abc',
            mainCheckout,
            worktreeRootEnv: '   ',
        })).toEqual({destination: '/Users/dev/vt-wts/wt-x-abc', appOwned: true});
    });
});

describe('createWorktree placement (no git-gate → app owns placement)', () => {
    it('lands under VT_WORKTREE_ROOT, never nested inside the watched repo', async () => {
        const repoRoot: string = makeRepo();
        const parent: string = dirname(repoRoot);
        const wtsRoot: string = join(parent, 'custom-wts');
        setEnvUntilCleanup('HOME', gitGateFreeHome());
        setEnvUntilCleanup('VT_WORKTREE_ROOT', wtsRoot);

        const worktreePath: string = await createWorktree(repoRoot, 'wt-placed');

        expect(basename(worktreePath)).toBe('wt-placed');
        expect(basename(dirname(worktreePath))).toBe('custom-wts');
        // NOT nested under the watched repo — the bug this change fixes.
        expect(worktreePath.startsWith(repoRoot + '/')).toBe(false);
        expect(statSync(worktreePath).isDirectory()).toBe(true);
        expect((await listWorktrees(repoRoot)).map(w => w.branch)).toContain('wt-placed');
    });

    it('defaults to <parent-of-main-checkout>/vt-wts when VT_WORKTREE_ROOT is unset', async () => {
        const repoRoot: string = makeRepo();
        const parent: string = dirname(repoRoot);
        setEnvUntilCleanup('HOME', gitGateFreeHome());
        setEnvUntilCleanup('VT_WORKTREE_ROOT', undefined);

        const worktreePath: string = await createWorktree(repoRoot, 'wt-default');

        // main checkout = repoRoot; parent-of-main = parent; root = parent/vt-wts.
        expect(worktreePath).toBe(join(parent, 'vt-wts', 'wt-default'));
        expect(statSync(worktreePath).isDirectory()).toBe(true);
    });

    // ROOT-CAUSE REGRESSION GUARD. The pre-fix code computed placement as
    // `path.resolve(repoRoot, '..', 'vt-wts')` — a pure-string operation keyed off
    // the WATCHED dir handed in. When that dir was a SUBDIRECTORY of the checkout
    // (or a case-variant), the worktree scattered to `<repo>/vt-wts` (nested) or a
    // case-variant sibling. The fix resolves the true main checkout via git first,
    // so placement is anchored to `<parent-of-MAIN-checkout>/vt-wts` no matter which
    // path inside the repo `createWorktree` is invoked from.
    it('anchors placement to the MAIN checkout when called from a subdirectory', async () => {
        const repoRoot: string = makeRepo();
        const parent: string = dirname(repoRoot);
        const subDir: string = join(repoRoot, 'nested', 'deep');
        mkdirSync(subDir, {recursive: true});
        setEnvUntilCleanup('HOME', gitGateFreeHome());
        setEnvUntilCleanup('VT_WORKTREE_ROOT', undefined);

        const worktreePath: string = await createWorktree(subDir, 'wt-from-subdir');

        // Sibling of MAIN — not `<subDir>/../vt-wts` and not nested inside the repo.
        expect(worktreePath).toBe(join(parent, 'vt-wts', 'wt-from-subdir'));
        expect(worktreePath.startsWith(repoRoot + '/')).toBe(false);
    });

    it('anchors placement to the MAIN checkout when called from a linked worktree', async () => {
        const repoRoot: string = makeRepo();
        const parent: string = dirname(repoRoot);
        setEnvUntilCleanup('HOME', gitGateFreeHome());
        setEnvUntilCleanup('VT_WORKTREE_ROOT', undefined);

        // A linked worktree's git-common-dir still resolves to the MAIN checkout, so
        // a worktree spawned from inside another worktree lands as a sibling of MAIN,
        // never relative to (or nested under) the linked worktree it was spawned from.
        const firstWt: string = await createWorktree(repoRoot, 'wt-first');
        const secondWt: string = await createWorktree(firstWt, 'wt-second');

        expect(secondWt).toBe(join(parent, 'vt-wts', 'wt-second'));
        expect(secondWt.startsWith(firstWt + '/')).toBe(false);
    });

    it('normalizes the new worktree git pointer to a relative (host-portable) path', async () => {
        const repoRoot: string = makeRepo();
        const parent: string = dirname(repoRoot);
        setEnvUntilCleanup('HOME', gitGateFreeHome());
        setEnvUntilCleanup('VT_WORKTREE_ROOT', join(parent, 'wts'));

        const worktreePath: string = await createWorktree(repoRoot, 'wt-relative');

        // App-owned placement runs `worktree repair --relative-paths`, so the
        // worktree's `.git` gitdir pointer is relative, not an absolute
        // host-specific path that would break the mutagen mac↔devbox mirror.
        const gitPointer: string = readFileSync(join(worktreePath, '.git'), 'utf-8').trim();
        expect(gitPointer.startsWith('gitdir: ')).toBe(true);
        expect(gitPointer.startsWith('gitdir: /')).toBe(false);
    });
});

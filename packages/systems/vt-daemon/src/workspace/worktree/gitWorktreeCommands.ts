/**
 * Git Worktree Commands
 *
 * Functions for creating and managing git worktrees for isolated agent work.
 * Worktrees allow agents to work on separate branches without conflicts.
 *
 * Home: this lives in vt-daemon because the daemon is the single git gateway —
 * both the browser (via the `worktree.*` RPC routes) and the Electron main
 * process (which imports these functions directly) drive the SAME
 * implementation, so the two runtimes can never drift.
 *
 * Composition: pure placement decisions live in `worktreePlacement.ts`; the git
 * subprocess wrappers and the hook runner live in `gitWorktreeInternals.ts`.
 * This module is the thin public surface that composes them.
 */

import fs from 'fs';
import os from 'os';

import type { WorktreeInfo } from '@vt/vt-daemon-protocol';

import { isGitGateActive, planWorktreePlacement, isExecutableFile } from './worktreePlacement.ts';
import {
    execFileAsync,
    gitEnv,
    runWorktreeHook,
    getAppOwnedHooksDir,
    resolveMainCheckout,
    repairWorktreeMetadata,
    discoverWorktreePathForBranch,
} from './gitWorktreeInternals.ts';

/**
 * Generate a valid git branch/worktree name from a node title.
 * Sanitizes the title to follow git branch naming conventions.
 *
 * @param nodeTitle - The node title to derive the name from
 * @returns A valid git branch name with unique suffix
 */
export function generateWorktreeName(nodeTitle: string): string {
    // Sanitize: lowercase, replace spaces/special chars with hyphens
    const sanitized: string = nodeTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
        .slice(0, 30); // limit length

    // Add short random suffix to prevent collisions (~46k combinations per title)
    const suffix: string = Math.random().toString(36).slice(2, 5);

    return `wt-${sanitized || 'agent'}-${suffix}`;
}

/**
 * Create a new git worktree with a corresponding branch, then return the
 * absolute path git actually placed it at.
 *
 * Placement depends on whether git-gate is the resolved `git`:
 *   - git-gate ACTIVE → pass the BARE name through unchanged; git-gate rewrites
 *     it to its per-machine worktree root and normalizes the metadata. A strict
 *     no-op vs. the wrapper-owns-placement design.
 *   - git-gate ABSENT → THIS app owns placement: the worktree is created at an
 *     absolute path under `VT_WORKTREE_ROOT ?? <parent-of-main-checkout>/vt-wts`
 *     (a sibling of the main checkout, never nested inside the watched project),
 *     with `VT_GIT_GATE_NO_PLACEMENT=1` set so a git-gate we failed to detect
 *     would still honour the explicit path. The app then runs
 *     `worktree repair --relative-paths` itself — the normalization git-gate
 *     would otherwise have done.
 *
 * Either way we read the resulting path back from git via
 * `discoverWorktreePathForBranch` rather than trusting the computed path.
 *
 * `repoRoot` may be any directory inside the repository (the watched dir, a
 * subdirectory of it, or a linked worktree); the true main checkout is resolved
 * from it for placement.
 *
 * `VT_GIT_GATE_SKIP_WORKTREE_PREWARM=1`: this caller owns the worktree
 * lifecycle hooks (the async hook installs deps + links .env), so the wrapper
 * must NOT also run its own dependency bootstrap — that would double-install
 * and race on `node_modules`. The flag is a no-op for plain git.
 *
 * `-c core.hooksPath=<app-owned no-op dir>`: belt-and-suspenders for the SKIP
 * flag. `git worktree add` runs the post-checkout the branch tree contains, so a
 * stale base re-introduces a blocking `pnpm install`; pointing `core.hooksPath`
 * at an app-owned no-op dir for THIS invocation makes the fast path immune to a
 * stale base. See `getAppOwnedHooksDir`.
 *
 * @param repoRoot - A directory inside the git repository (placement is
 *   resolved against the repo's main checkout)
 * @param worktreeName - The name for the worktree and branch
 * @param blockingHookCommand - Optional command awaited after creation, before
 *   returning. Run with cwd = the repo's main checkout (so repo-relative hook
 *   paths resolve regardless of which subdirectory `repoRoot` points at).
 * @param asyncHookCommand - Optional fire-and-forget command run after creation,
 *   also with cwd = the repo's main checkout.
 * @returns The absolute path to the created worktree directory
 * @throws Error if worktree creation fails (hook failure does NOT throw)
 */
export async function createWorktree(
    repoRoot: string,
    worktreeName: string,
    blockingHookCommand?: string,
    asyncHookCommand?: string,
): Promise<string> {
    const mainCheckout: string = await resolveMainCheckout(repoRoot);
    const gitGateActive: boolean = isGitGateActive({
        pathEnv: process.env.PATH,
        homeDir: os.homedir(),
        isExecutable: isExecutableFile,
    });
    const placement: { destination: string; appOwned: boolean } = planWorktreePlacement({
        gitGateActive,
        worktreeName,
        mainCheckout,
        worktreeRootEnv: process.env.VT_WORKTREE_ROOT,
    });

    // SKIP_WORKTREE_PREWARM: the app owns the worktree hooks (below), so git-gate
    // must not also bootstrap deps. NO_PLACEMENT (app-owned only): pins our
    // explicit path so an undetected git-gate would still honour it. gitEnv()
    // strips a hook-leaked GIT_DIR so `git worktree add` resolves the repo from
    // the explicit cwd below.
    const env: NodeJS.ProcessEnv = placement.appOwned
        ? gitEnv({ VT_GIT_GATE_SKIP_WORKTREE_PREWARM: '1', VT_GIT_GATE_NO_PLACEMENT: '1' })
        : gitEnv({ VT_GIT_GATE_SKIP_WORKTREE_PREWARM: '1' });

    // -b creates a new branch named after the worktree; `placement.destination`
    // is either the bare name (git-gate places it) or an absolute path (app
    // places it). Run from the main checkout so placement is anchored there.
    const hooksDir: string = getAppOwnedHooksDir();
    try {
        await execFileAsync(
            'git',
            ['-c', `core.hooksPath=${hooksDir}`, 'worktree', 'add', '-b', worktreeName, placement.destination],
            { cwd: mainCheckout, env },
        );
    } catch (error) {
        const errorMessage: string = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to create git worktree: ${errorMessage}`);
    }

    const worktreePath: string = await discoverWorktreePathForBranch(mainCheckout, worktreeName);

    // App-owned placement: normalize the metadata git-gate would have normalized
    // (host-portable relative pointers for the mutagen mirror).
    if (placement.appOwned) {
        await repairWorktreeMetadata(worktreePath);
    }

    // Hooks run from the MAIN CHECKOUT, not `repoRoot`. `repoRoot` may be any
    // directory inside the repo — including a markdown subfolder watched by the
    // app that is nested arbitrarily deep. Hook commands are repo-relative (the
    // settings default is `./scripts/git/worktree/on-created-blocking.sh`), so
    // they only resolve when cwd is the repo's main checkout, where `scripts/`
    // lives.

    // Blocking hook: awaited after creation, before returning worktreePath to caller
    if (blockingHookCommand) {
        const result: { success: boolean; error?: string } = await runWorktreeHook(blockingHookCommand, [worktreePath, worktreeName], mainCheckout);
        if (result.success) {
            console.log(`[createWorktree] Blocking hook succeeded for ${worktreeName}`);
        } else {
            console.warn(`[createWorktree] Blocking hook failed for ${worktreeName}: ${result.error}`);
        }
    }

    // Async hook: fire-and-forget after creation, does not block terminal spawn
    if (asyncHookCommand) {
        void runWorktreeHook(asyncHookCommand, [worktreePath, worktreeName], mainCheckout).then(result => {
            if (result.success) {
                console.log(`[createWorktree] Async hook succeeded for ${worktreeName}`);
            } else {
                console.warn(`[createWorktree] Async hook failed for ${worktreeName}: ${result.error}`);
            }
        });
    }

    return worktreePath;
}

/**
 * List the repository's linked git worktrees (everything except the main
 * checkout), as reported by git itself. Returns up to 5 most recently modified
 * worktrees, sorted newest first.
 *
 * Git-driven on purpose: the app holds no placement convention, so it does not
 * filter by any sibling directory — it simply trusts git's inventory and drops
 * the main worktree (always the first porcelain block).
 *
 * @param repoRoot - The root directory of the git repository
 * @returns Array of worktree info objects, empty if none exist
 */
export async function listWorktrees(repoRoot: string): Promise<WorktreeInfo[]> {
    let stdout: string;
    try {
        const result: { stdout: string; stderr: string } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot, env: gitEnv() });
        stdout = result.stdout;
    } catch {
        return [];
    }

    // Parse porcelain output: blocks separated by blank lines.
    // Each block: "worktree <path>\nHEAD <hash>\nbranch refs/heads/<name>\n".
    // The first block is always the main worktree — exclude it; we only surface
    // linked (agent) worktrees.
    const blocks: string[] = stdout.split('\n\n').filter((b: string) => b.trim());
    const linkedBlocks: string[] = blocks.slice(1);
    const worktrees: WorktreeInfo[] = [];

    for (const block of linkedBlocks) {
        const lines: string[] = block.trim().split('\n');
        const worktreeLine: string | undefined = lines.find((l: string) => l.startsWith('worktree '));
        const headLine: string | undefined = lines.find((l: string) => l.startsWith('HEAD '));
        const branchLine: string | undefined = lines.find((l: string) => l.startsWith('branch '));

        // Skip detached / bare entries (no branch line).
        if (!worktreeLine || !headLine || !branchLine) continue;

        const wtPath: string = worktreeLine.slice('worktree '.length);
        const head: string = headLine.slice('HEAD '.length);
        const branch: string = branchLine.slice('branch refs/heads/'.length);

        // Extract display name: strip "wt-" prefix if present
        const name: string = branch.startsWith('wt-') ? branch.slice(3) : branch;

        worktrees.push({ path: wtPath, branch, head, name });
    }

    // Sort by filesystem modification time (most recent first)
    const withMtime: Array<{ info: WorktreeInfo; mtime: number }> = [];
    for (const info of worktrees) {
        try {
            const stat: fs.Stats = await fs.promises.stat(info.path);
            withMtime.push({ info, mtime: stat.mtimeMs });
        } catch {
            // Worktree path no longer exists on disk — skip it
        }
    }

    withMtime.sort((a: { info: WorktreeInfo; mtime: number }, b: { info: WorktreeInfo; mtime: number }) => b.mtime - a.mtime);

    return withMtime.slice(0, 5).map((item: { info: WorktreeInfo; mtime: number }) => item.info);
}

/**
 * Remove a git worktree and prune stale refs.
 *
 * @param repoRoot - The root directory of the git repository
 * @param worktreePath - The path to the worktree to remove
 * @param force - Whether to force removal (for worktrees with uncommitted changes)
 * @returns Object with success status, command string, and optional error
 */
export async function removeWorktree(
    repoRoot: string,
    worktreePath: string,
    force: boolean = false
): Promise<{ success: boolean; command: string; error?: string }> {
    const args: string[] = ['worktree', 'remove']
    if (force) args.push('--force')
    args.push(worktreePath)
    const command: string = `git ${args.join(' ')}`;
    try {
        await execFileAsync('git', args, { cwd: repoRoot, env: gitEnv() });
        await execFileAsync('git', ['worktree', 'prune'], { cwd: repoRoot, env: gitEnv() });
        return { success: true, command };
    } catch (error) {
        const errorMessage: string = error instanceof Error ? error.message : String(error);
        return { success: false, command, error: errorMessage };
    }
}

/**
 * Get the command string that would be run to remove a worktree (for preview/confirmation UI).
 *
 * @param worktreePath - The path to the worktree to remove
 * @param force - Whether to include the --force flag
 * @returns The git command string (not executed)
 */
export function getRemoveWorktreeCommand(
    worktreePath: string,
    force: boolean = false
): string {
    return `git worktree remove ${force ? '--force ' : ''}"${worktreePath}"`;
}

export type { WorktreeInfo };

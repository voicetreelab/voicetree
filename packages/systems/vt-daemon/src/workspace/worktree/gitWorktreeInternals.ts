/**
 * Side-effecting internals for the worktree commands: the git subprocess
 * wrappers and the worktree-created hook runner. Separated from the public
 * `gitWorktreeCommands` surface so that surface stays a thin, readable
 * composition of named steps.
 */

import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { shellQuote } from '@vt/vt-daemon/agent-runtime/terminals/util/shellQuote.ts';

export const execFileAsync: (
    file: string,
    args: readonly string[],
    options?: { cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }> = promisify(execFile);

/**
 * The keys git uses to override repository discovery. A git hook exports these
 * into its environment (a `git worktree add` post-checkout, a pre-commit gate,
 * the per-machine mutagen mirror's wrapper, …); when they leak into a
 * long-lived process that later shells out to git, working-tree commands like
 * `git worktree add/list/remove` resolve against the LEAKED repo instead of the
 * `cwd` they were given — aborting with "must be run in a work tree" or, worse,
 * silently operating on the wrong checkout. GIT_COMMON_DIR matters as much as
 * GIT_DIR for worktree ops: it redirects where worktree admin (refs, the
 * worktrees/ registry) is read and written.
 */
export const GIT_LOCATION_OVERRIDE_KEYS: ReadonlySet<string> = new Set([
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_COMMON_DIR',
    'GIT_INDEX_FILE',
]);

/**
 * The process environment with git's location overrides stripped, so git
 * resolves the repository from the explicit `cwd` each worktree call already
 * passes (none depend on an ambient GIT_DIR). The daemon shells out to git from
 * a potentially hook-leaked environment, so every worktree git invocation runs
 * through this. A no-op when the overrides are absent, so it is safe everywhere.
 */
export function gitEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    const base: NodeJS.ProcessEnv = Object.fromEntries(
        Object.entries(process.env).filter(
            ([key]: [string, string | undefined]) => !GIT_LOCATION_OVERRIDE_KEYS.has(key),
        ),
    );
    return { ...base, ...extra };
}

/**
 * Execute a user-defined hook command, appending arguments.
 * The command is run through the shell as-is — same convention as npm scripts and git hooks.
 * Catches all errors gracefully — logs a warning but never throws.
 *
 * @param command - Shell command to run (e.g. "node scripts/on-new-node.cjs", "./my-hook.sh")
 * @param args - Arguments appended to the command (e.g. [nodePath])
 * @param cwd - Working directory for execution (e.g. repo root)
 * @returns Object indicating success or failure with optional error message
 */
export async function runWorktreeHook(
    command: string,
    args: string[],
    cwd: string,
): Promise<{ success: boolean; error?: string; stdout?: string; stderr?: string }> {
    const quotedArgs: string = args.map(shellQuote).join(' ')
    const fullCommand: string = quotedArgs ? `${command} ${quotedArgs}` : command
    return new Promise((resolve) => {
        exec(fullCommand, { cwd, timeout: 30000 }, (error: Error | null, stdout: string, stderr: string) => {
            if (error) {
                const message: string = error instanceof Error ? error.message : String(error);
                console.warn(`[runWorktreeHook] Hook failed (${command}): ${message}`);
                resolve({ success: false, error: message, stdout, stderr });
            } else {
                resolve({ success: true, stdout, stderr });
            }
        });
    });
}

/**
 * Materialize an app-controlled, no-op `post-checkout` git hook and return its
 * directory, suitable for `-c core.hooksPath=<dir>` on `git worktree add`.
 *
 * WHY: `git worktree add` fires post-checkout AFTER checking out the branch's
 * files, so the hook that runs is whatever `scripts/hooks/post-checkout` happens
 * to live in that branch's tree. If the base branch is stale, the OLD hook runs
 * — historically a blocking `pnpm install --frozen-lockfile` (~15-45 s) that
 * stalled the spawn-in-worktree UI. We can't rely on the base branch's hook
 * version, so we override `core.hooksPath` for THIS one invocation to point at
 * a dir we control, containing a no-op hook.
 *
 * That is the right behaviour for the app-spawned path: the app already owns
 * worktree setup via the configured blocking + async hooks (configure-cdp.sh
 * + on-created-async.sh). git's post-checkout has nothing to add.
 *
 * The override applies only to the `git worktree add` invocation — it is NOT
 * written to the new worktree's config, so subsequent git ops in the new
 * worktree resolve hooks normally (e.g. real `git switch` still gets deps
 * reconciliation via the branch's checked-in post-checkout).
 *
 * Idempotent and race-safe: identical content, mkdir-recursive, unconditional
 * write. Lives under `os.tmpdir()` (per-user on macOS); fine to leave behind.
 */
export function getAppOwnedHooksDir(): string {
    const dir: string = path.join(os.tmpdir(), 'voicetree-worktree-hooks');
    const hookPath: string = path.join(dir, 'post-checkout');
    const body: string = '#!/bin/sh\n# No-op: VoiceTree owns worktree setup via configured hooks.\nexit 0\n';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(hookPath, body);
    fs.chmodSync(hookPath, 0o755);
    return dir;
}

/**
 * Resolve the absolute path of the repository's MAIN checkout from any path
 * inside the repo — the watched dir, which may be a subdirectory of the
 * checkout or even a linked worktree. `--path-format=absolute` is required: a
 * bare `--git-common-dir` may be returned relative to cwd (or, from a linked
 * worktree, surface the per-worktree git dir on some setups). With the flag,
 * git always yields the shared `<main>/.git`, whose parent is the main checkout.
 */
export async function resolveMainCheckout(repoDir: string): Promise<string> {
    const { stdout }: { stdout: string } = await execFileAsync(
        'git',
        ['-C', repoDir, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
        { env: gitEnv() },
    );
    return path.dirname(stdout.trim());
}

/**
 * Make the new worktree's admin pointers relative, so they are host-portable
 * across the mutagen mac↔devbox mirror — the same normalization git-gate does
 * after its own add. `--relative-paths` needs git >= 2.48; fall back to a plain
 * repair on older git (absolute pointers are fine for trees that never sync).
 * Best-effort: a repair failure never fails worktree creation.
 */
export async function repairWorktreeMetadata(worktreePath: string): Promise<void> {
    try {
        await execFileAsync('git', ['-C', worktreePath, 'worktree', 'repair', '--relative-paths'], { env: gitEnv() });
        return;
    } catch {
        // Older git without --relative-paths — fall through to a plain repair.
    }
    try {
        await execFileAsync('git', ['-C', worktreePath, 'worktree', 'repair'], { env: gitEnv() });
    } catch {
        // Best-effort: leave pointers exactly as `git worktree add` wrote them.
    }
}

/**
 * Discover the absolute path of the worktree checked out on `branch`, by asking
 * git itself rather than computing it from any placement convention.
 *
 * This is the read-the-truth-back half of the "app makes no claim about WHERE
 * the worktree lives" design: `createWorktree` passes a bare name to
 * `git worktree add` and whatever layer sits below (the git-gate wrapper, or
 * plain git for external users) decides the actual location; we then parse
 * `git worktree list --porcelain` to find where it landed.
 *
 * @throws Error if no worktree for `branch` is found in git's listing.
 */
export async function discoverWorktreePathForBranch(repoRoot: string, branch: string): Promise<string> {
    const { stdout }: { stdout: string } = await execFileAsync(
        'git',
        ['worktree', 'list', '--porcelain'],
        { cwd: repoRoot, env: gitEnv() },
    );
    // Porcelain output is blank-line-separated blocks; each block carries a
    // `worktree <path>` line and (for non-detached entries) a `branch
    // refs/heads/<name>` line.
    const branchLine: string = `branch refs/heads/${branch}`;
    for (const block of stdout.split('\n\n')) {
        const lines: string[] = block.trim().split('\n');
        if (!lines.includes(branchLine)) continue;
        const worktreeLine: string | undefined = lines.find((l: string) => l.startsWith('worktree '));
        if (worktreeLine) return worktreeLine.slice('worktree '.length);
    }
    throw new Error(`Created worktree on branch '${branch}' but could not locate it in 'git worktree list'`);
}

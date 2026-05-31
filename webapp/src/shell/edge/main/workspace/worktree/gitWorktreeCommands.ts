/**
 * Git Worktree Commands
 *
 * Functions for creating and managing git worktrees for isolated agent work.
 * Worktrees allow agents to work on separate branches without conflicts.
 */

import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';

/** Shell-quote a single argument for POSIX-style hook commands. */
export function shellQuote(arg: string): string {
    return "'" + arg.replace(/'/g, "'\\''") + "'";
}

const execFileAsync: (
    file: string,
    args: readonly string[],
    options?: { cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }> = promisify(execFile);

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
export async function runHook(
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
                console.warn(`[runHook] Hook failed (${command}): ${message}`);
                resolve({ success: false, error: message, stdout, stderr });
            } else {
                resolve({ success: true, stdout, stderr });
            }
        });
    });
}

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
 * Decide whether the `git` binary this process will invoke is the git-gate
 * shim, by replicating Node's PATH lookup (`execFile('git', …)` runs the first
 * executable `git` on PATH) and comparing the winner to git-gate's install
 * location, `$HOME/bin/git`.
 *
 * git-gate (scripts/dev-setup/git-gate) is the machine-level wrapper that owns
 * worktree PLACEMENT: it rewrites a bare worktree name to its per-machine root.
 * When it is the resolved `git`, this app must NOT also compute a path — it
 * passes the bare name through and lets git-gate place the tree (a strict
 * no-op vs. the wrapper-owns-placement design). When it is absent, this app
 * owns placement instead.
 *
 * Resolving the binary — rather than merely testing whether `$HOME/bin/git`
 * exists — is deliberate: a stale `$HOME/bin/git` shadowed by an earlier PATH
 * entry is correctly reported inactive, because `execFile` would run that
 * earlier real git, not the shim.
 *
 * Pure: the filesystem probe is injected via `isExecutable`.
 */
export function isGitGateActive({
    pathEnv,
    homeDir,
    isExecutable,
}: {
    pathEnv: string | undefined;
    homeDir: string;
    isExecutable: (candidate: string) => boolean;
}): boolean {
    const shim: string = path.join(homeDir, 'bin', 'git');
    const dirs: string[] = (pathEnv ?? '').split(path.delimiter).filter((dir: string) => dir !== '');
    for (const dir of dirs) {
        const candidate: string = path.join(dir, 'git');
        if (isExecutable(candidate)) {
            // First match wins, exactly as execFile's PATH search does.
            return candidate === shim;
        }
    }
    return false;
}

/**
 * Decide the destination passed to `git worktree add`, and whether THIS app
 * owns placement (and must therefore normalize the worktree's git metadata
 * afterwards):
 *
 *   git-gate active → BARE name (argv unchanged): git-gate rewrites it to its
 *                     per-machine root. `appOwned` is false.
 *   git-gate absent → ABSOLUTE path under `VT_WORKTREE_ROOT`, or — absent that
 *                     shared override — the canonical sibling of the main
 *                     checkout, `<parent-of-main-checkout>/vt-wts`. Never nested
 *                     inside the watched project. `appOwned` is true.
 *
 * Pure.
 */
export function planWorktreePlacement({
    gitGateActive,
    worktreeName,
    mainCheckout,
    worktreeRootEnv,
}: {
    gitGateActive: boolean;
    worktreeName: string;
    mainCheckout: string;
    worktreeRootEnv: string | undefined;
}): { destination: string; appOwned: boolean } {
    if (gitGateActive) {
        return { destination: worktreeName, appOwned: false };
    }
    const root: string = (worktreeRootEnv !== undefined && worktreeRootEnv.trim() !== '')
        ? worktreeRootEnv
        : path.join(path.dirname(mainCheckout), 'vt-wts');
    return { destination: path.join(root, worktreeName), appOwned: true };
}

/**
 * Probe whether `candidate` is an executable regular file. Impure (fs);
 * injected into the pure `isGitGateActive`.
 */
function isExecutableFile(candidate: string): boolean {
    try {
        if (!fs.statSync(candidate).isFile()) return false;
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Resolve the absolute path of the repository's MAIN checkout from any path
 * inside the repo — the watched dir, which may be a subdirectory of the
 * checkout or even a linked worktree. `--path-format=absolute` is required: a
 * bare `--git-common-dir` may be returned relative to cwd (or, from a linked
 * worktree, surface the per-worktree git dir on some setups). With the flag,
 * git always yields the shared `<main>/.git`, whose parent is the main checkout.
 */
async function resolveMainCheckout(repoDir: string): Promise<string> {
    const { stdout }: { stdout: string } = await execFileAsync(
        'git',
        ['-C', repoDir, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
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
async function repairWorktreeMetadata(worktreePath: string): Promise<void> {
    try {
        await execFileAsync('git', ['-C', worktreePath, 'worktree', 'repair', '--relative-paths']);
        return;
    } catch {
        // Older git without --relative-paths — fall through to a plain repair.
    }
    try {
        await execFileAsync('git', ['-C', worktreePath, 'worktree', 'repair']);
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
async function discoverWorktreePathForBranch(repoRoot: string, branch: string): Promise<string> {
    const { stdout }: { stdout: string } = await execFileAsync(
        'git',
        ['worktree', 'list', '--porcelain'],
        { cwd: repoRoot },
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
 * @param repoRoot - A directory inside the git repository (placement is
 *   resolved against the repo's main checkout)
 * @param worktreeName - The name for the worktree and branch
 * @param blockingHookCommand - Optional command awaited after creation, before returning
 * @param asyncHookCommand - Optional fire-and-forget command run after creation
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
    // explicit path so an undetected git-gate would still honour it.
    const env: NodeJS.ProcessEnv = placement.appOwned
        ? { ...process.env, VT_GIT_GATE_SKIP_WORKTREE_PREWARM: '1', VT_GIT_GATE_NO_PLACEMENT: '1' }
        : { ...process.env, VT_GIT_GATE_SKIP_WORKTREE_PREWARM: '1' };

    // -b creates a new branch named after the worktree; `placement.destination`
    // is either the bare name (git-gate places it) or an absolute path (app
    // places it). Run from the main checkout so placement is anchored there.
    try {
        await execFileAsync(
            'git',
            ['worktree', 'add', '-b', worktreeName, placement.destination],
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

    // Blocking hook: awaited after creation, before returning worktreePath to caller
    if (blockingHookCommand) {
        const result: { success: boolean; error?: string } = await runHook(blockingHookCommand, [worktreePath, worktreeName], repoRoot);
        if (result.success) {
            console.log(`[createWorktree] Blocking hook succeeded for ${worktreeName}`);
        } else {
            console.warn(`[createWorktree] Blocking hook failed for ${worktreeName}: ${result.error}`);
        }
    }

    // Async hook: fire-and-forget after creation, does not block terminal spawn
    if (asyncHookCommand) {
        void runHook(asyncHookCommand, [worktreePath, worktreeName], repoRoot).then(result => {
            if (result.success) {
                console.log(`[createWorktree] Async hook succeeded for ${worktreeName}`);
            } else {
                console.warn(`[createWorktree] Async hook failed for ${worktreeName}: ${result.error}`);
            }
        });
    }

    return worktreePath;
}

export interface WorktreeInfo {
    path: string;       // absolute path
    branch: string;     // branch name
    head: string;       // commit hash
    name: string;       // display name (extracted from branch, e.g. "fix-auth-bug" from "wt-fix-auth-bug")
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
        const result: { stdout: string; stderr: string } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot });
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
        await execFileAsync('git', args, { cwd: repoRoot });
        await execFileAsync('git', ['worktree', 'prune'], { cwd: repoRoot });
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

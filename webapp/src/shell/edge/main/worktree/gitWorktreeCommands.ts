/**
 * Git Worktree Commands
 *
 * Functions for creating and managing git worktrees for isolated agent work.
 * Worktrees allow agents to work on separate branches without conflicts.
 */

import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execFileAsync: (file: string, args: readonly string[], options?: { cwd?: string }) => Promise<{ stdout: string; stderr: string }> = promisify(execFile);

/** Normalize path separators to forward slashes (for cross-platform comparison) */
function toForwardSlashes(p: string): string {
    return p.replace(/\\/g, '/');
}

/** Shell-quote a single argument (wrap in single quotes, escape existing single quotes) */
function shellQuote(arg: string): string {
    return "'" + arg.replace(/'/g, "'\\''") + "'"
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
export async function runHook(
    command: string,
    args: string[],
    cwd: string
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
 * Get the worktree directory path for a given worktree name.
 *
 * @param repoRoot - The root directory of the git repository
 * @param worktreeName - The worktree name
 * @returns The absolute path to the worktree directory
 */
export function getWorktreePath(repoRoot: string, worktreeName: string): string {
    return path.join(repoRoot, '.worktrees', worktreeName);
}

/**
 * Create a new git worktree with a corresponding branch.
 * Optionally runs a user-defined hook script after successful creation.
 *
 * @param repoRoot - The root directory of the git repository
 * @param worktreeName - The name for the worktree and branch
 * @param hookScriptPath - Optional path to a shell script to run after worktree creation
 * @returns The absolute path to the created worktree directory
 * @throws Error if worktree creation fails (hook failure does NOT throw)
 */
export async function createWorktree(
    repoRoot: string,
    worktreeName: string,
    blockingHookCommand?: string,
    asyncHookCommand?: string,
): Promise<string> {
    const worktreePath: string = getWorktreePath(repoRoot, worktreeName);

    // Pre-hook: blocking, runs before git worktree add
    if (blockingHookCommand) {
        const result: { success: boolean; error?: string } = await runHook(blockingHookCommand, [repoRoot, worktreeName], repoRoot);
        if (result.success) {
            console.log(`[createWorktree] Blocking hook succeeded for ${worktreeName}`);
        } else {
            console.warn(`[createWorktree] Blocking hook failed for ${worktreeName}: ${result.error}`);
        }
    }

    // Create the worktree with a new branch based on current HEAD
    // -b creates a new branch with the worktree name
    try {
        await execFileAsync('git', ['worktree', 'add', '-b', worktreeName, worktreePath], { cwd: repoRoot });
    } catch (error) {
        const errorMessage: string = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to create git worktree: ${errorMessage}`);
    }

    // Post-hook: fire-and-forget, runs after creation
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
 * List existing git worktrees under the `.worktrees/` directory.
 * Returns up to 5 most recently modified worktrees, sorted newest first.
 *
 * @param repoRoot - The root directory of the git repository
 * @returns Array of worktree info objects, empty if none exist
 */
export async function listWorktrees(repoRoot: string): Promise<WorktreeInfo[]> {
    const worktreesDir: string = path.join(repoRoot, '.worktrees');

    // Gracefully handle missing .worktrees/ directory
    if (!fs.existsSync(worktreesDir)) {
        return [];
    }

    let stdout: string;
    try {
        const result: { stdout: string; stderr: string } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot });
        stdout = result.stdout;
    } catch {
        return [];
    }

    // Parse porcelain output: blocks separated by blank lines
    // Each block: "worktree <path>\nHEAD <hash>\nbranch refs/heads/<name>\n"
    const blocks: string[] = stdout.split('\n\n').filter((b: string) => b.trim());
    const worktrees: WorktreeInfo[] = [];
    // Normalize worktreesDir to forward slashes for cross-platform comparison
    // (git on Windows may output forward-slash paths while path.join uses backslashes)
    const normalizedWorktreesDir: string = toForwardSlashes(worktreesDir);

    for (const block of blocks) {
        const lines: string[] = block.trim().split('\n');
        const worktreeLine: string | undefined = lines.find((l: string) => l.startsWith('worktree '));
        const headLine: string | undefined = lines.find((l: string) => l.startsWith('HEAD '));
        const branchLine: string | undefined = lines.find((l: string) => l.startsWith('branch '));

        if (!worktreeLine || !headLine || !branchLine) continue;

        const wtPath: string = worktreeLine.slice('worktree '.length);
        const head: string = headLine.slice('HEAD '.length);
        const branch: string = branchLine.slice('branch refs/heads/'.length);

        // Filter: only include worktrees under .worktrees/
        // Normalize both sides for cross-platform comparison
        if (!toForwardSlashes(wtPath).startsWith(normalizedWorktreesDir)) continue;

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

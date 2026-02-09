/**
 * Git Worktree Commands
 *
 * Functions for creating and managing git worktrees for isolated agent work.
 * Worktrees allow agents to work on separate branches without conflicts.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execAsync: (command: string, options?: { cwd?: string }) => Promise<{ stdout: string; stderr: string }> = promisify(exec);

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
 *
 * @param repoRoot - The root directory of the git repository
 * @param worktreeName - The name for the worktree and branch
 * @returns The absolute path to the created worktree directory
 * @throws Error if worktree creation fails
 */
export async function createWorktree(repoRoot: string, worktreeName: string): Promise<string> {
    const worktreePath: string = getWorktreePath(repoRoot, worktreeName);

    // Create the worktree with a new branch based on current HEAD
    // -b creates a new branch with the worktree name
    const command: string = `git worktree add -b "${worktreeName}" "${worktreePath}"`;

    try {
        await execAsync(command, { cwd: repoRoot });
        //console.log(`[createWorktree] Created worktree at ${worktreePath}`);
        return worktreePath;
    } catch (error) {
        const errorMessage: string = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to create git worktree: ${errorMessage}`);
    }
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
        const result: { stdout: string; stderr: string } = await execAsync('git worktree list --porcelain', { cwd: repoRoot });
        stdout = result.stdout;
    } catch {
        return [];
    }

    // Parse porcelain output: blocks separated by blank lines
    // Each block: "worktree <path>\nHEAD <hash>\nbranch refs/heads/<name>\n"
    const blocks: string[] = stdout.split('\n\n').filter((b: string) => b.trim());
    const worktrees: WorktreeInfo[] = [];

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
        if (!wtPath.startsWith(worktreesDir)) continue;

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

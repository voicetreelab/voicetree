/**
 * Git Worktree Commands
 *
 * Functions for creating and managing git worktrees for isolated agent work.
 * Worktrees allow agents to work on separate branches without conflicts.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

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

    // Add short unique suffix to prevent collisions
    const suffix: string = Date.now().toString(36).slice(-4);

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

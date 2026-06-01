import type {TerminalId} from '../terminal-registry/types';

/**
 * Tmux spawn planning helpers. Project-path discovery helpers (resolveTmuxProjectPath,
 * withResolvedTmuxProjectPath, withVoicetreeProjectPath) feed terminal-manager's
 * active spawn flow; the prompt-file primitive itself (write, env scrub, command
 * rewrite) lives in `../headless/tmuxPromptFile.ts` as `applyPromptFileToTmuxSpawn`
 * so headless and interactive paths share it.
 *
 * The pure planning helpers below (resolvePromptFileWrite, buildTmuxEnv) are
 * tested in `tests/tmuxSpawnPlanning.test.ts` and kept available as primitives
 * for a future refactor that would extract write/scrub steps out of
 * applyPromptFileToTmuxSpawn — they are not currently wired into the active
 * spawn path.
 */

export type PromptFileWriteRequest = {
    readonly projectRoot: string;
    readonly terminalId: TerminalId;
    readonly prompt: string;
};

export type HeadfulPromptInjectionRequest = {
    readonly terminalId: TerminalId;
    readonly command: string;
    readonly projectRoot?: string;
};

/**
 * Resolve the canonical project root for tmux env exposure. The third-tier
 * fallback is the daemon's project root (the directory containing `.voicetree/`),
 * NOT the daemon's writeFolderPath — `$VOICETREE_PROJECT_PATH/.voicetree/auth-token` is
 * read by the CLI, the agent hook script, and the prompt-file primitive, all of
 * which need the canonical root. See buildTerminalEnvVars for the same contract.
 */
export function resolveTmuxProjectPath(
    env: {readonly VOICETREE_PROJECT_PATH?: string},
    initialEnvVars: Record<string, string>,
    runtimeProjectRoot?: string | null,
): string | undefined {
    return initialEnvVars.VOICETREE_PROJECT_PATH ?? runtimeProjectRoot ?? env.VOICETREE_PROJECT_PATH ?? undefined;
}

export function withResolvedTmuxProjectPath(
    initialEnvVars: Record<string, string>,
    projectRoot: string | undefined,
): Record<string, string> | undefined {
    if (!projectRoot && Object.keys(initialEnvVars).length === 0) return undefined;
    if (!projectRoot || initialEnvVars.VOICETREE_PROJECT_PATH) return initialEnvVars;
    return {...initialEnvVars, VOICETREE_PROJECT_PATH: projectRoot};
}

/**
 * Build the tmux -e env vector from a (possibly already prompt-file-scrubbed)
 * env map. Drops non-string entries (defensive against bad input from the
 * IPC boundary, where the TS type can't be enforced) and backfills
 * VOICETREE_PROJECT_PATH if the env doesn't carry one.
 */
export function withVoicetreeProjectPath(
    env: Record<string, string>,
    projectPath: string | undefined,
): Record<string, string> {
    const tmuxEnv: Record<string, string> = {};
    for (const key of Object.keys(env)) {
        const value: string = env[key];
        if (typeof value === 'string') tmuxEnv[key] = value;
    }
    if (projectPath && !tmuxEnv.VOICETREE_PROJECT_PATH) tmuxEnv.VOICETREE_PROJECT_PATH = projectPath;
    return tmuxEnv;
}

/**
 * Pure planning helper — decides whether a prompt-file should be written.
 * Returns `null` when there's nothing to write (no project root or no prompt).
 * Kept available as a primitive for a future refactor; not wired into the
 * active spawn path. See module docstring.
 */
export function resolvePromptFileWrite(
    projectRoot: string | undefined,
    terminalId: TerminalId,
    agentPrompt: string | undefined,
): PromptFileWriteRequest | null {
    if (!projectRoot || !agentPrompt) return null;
    return {projectRoot, terminalId, prompt: agentPrompt};
}

/**
 * Pure planning helper — builds the tmux -e env vector with AGENT_PROMPT_FILE
 * + VOICETREE_PROJECT_PATH backfill. Drops non-string entries defensively.
 * Kept available as a primitive; not wired into the active spawn path. See
 * module docstring.
 */
export function buildTmuxEnv(
    initialEnvVars: Record<string, string>,
    projectRoot: string | undefined,
    promptFilePath: string | null,
): Record<string, string> {
    const tmuxEnv: Record<string, string> = {};
    for (const key of Object.keys(initialEnvVars)) {
        const value: string = initialEnvVars[key];
        if (typeof value === 'string') tmuxEnv[key] = value;
    }
    if (promptFilePath) tmuxEnv.AGENT_PROMPT_FILE = promptFilePath;
    if (projectRoot && !tmuxEnv.VOICETREE_PROJECT_PATH) tmuxEnv.VOICETREE_PROJECT_PATH = projectRoot;
    return tmuxEnv;
}

/**
 * Pure planning helper — kept available as a primitive; not wired into the
 * active spawn path. See module docstring.
 */
export function resolveHeadfulPromptInjection(
    terminalId: TerminalId,
    initialCommand: string | undefined,
    projectRoot?: string,
): HeadfulPromptInjectionRequest | null {
    if (!initialCommand) return null;
    const base: HeadfulPromptInjectionRequest = {terminalId, command: initialCommand};
    return projectRoot ? {...base, projectRoot} : base;
}

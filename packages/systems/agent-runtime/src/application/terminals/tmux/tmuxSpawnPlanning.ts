/**
 * Tmux spawn planning helpers — only the vault-path discovery helpers remain
 * here. The prompt-file primitive itself (write, env scrub, command rewrite)
 * lives in `../headless/tmuxPromptFile.ts` as `applyPromptFileToTmuxSpawn`
 * so the headless and interactive paths share it.
 */

export function resolveTmuxVaultPath(
    env: {readonly VOICETREE_VAULT_PATH?: string},
    initialEnvVars: Record<string, string>,
    runtimeWritePath?: string | null,
): string | undefined {
    return env.VOICETREE_VAULT_PATH ?? initialEnvVars.VOICETREE_VAULT_PATH ?? runtimeWritePath ?? undefined;
}

export function withResolvedTmuxVaultPath(
    initialEnvVars: Record<string, string>,
    vaultPath: string | undefined,
): Record<string, string> | undefined {
    if (!vaultPath && Object.keys(initialEnvVars).length === 0) return undefined;
    if (!vaultPath || initialEnvVars.VOICETREE_VAULT_PATH) return initialEnvVars;
    return {...initialEnvVars, VOICETREE_VAULT_PATH: vaultPath};
}

/**
 * Build the tmux -e env vector from a (possibly already prompt-file-scrubbed)
 * env map. Drops non-string entries (defensive against bad input from the
 * IPC boundary, where the TS type can't be enforced) and backfills
 * VOICETREE_VAULT_PATH if the env doesn't carry one.
 */
export function withVoicetreeVaultPath(
    env: Record<string, string>,
    vaultPath: string | undefined,
): Record<string, string> {
    const tmuxEnv: Record<string, string> = {};
    for (const key of Object.keys(env)) {
        const value: string = env[key];
        if (typeof value === 'string') tmuxEnv[key] = value;
    }
    if (vaultPath && !tmuxEnv.VOICETREE_VAULT_PATH) tmuxEnv.VOICETREE_VAULT_PATH = vaultPath;
    return tmuxEnv;
}

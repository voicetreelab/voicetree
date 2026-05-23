/**
 * Tmux spawn planning helpers — only the vault-path discovery helpers remain
 * here. The prompt-file primitive itself (write, env scrub, command rewrite)
 * lives in `../headless/tmuxPromptFile.ts` as `applyPromptFileToTmuxSpawn`
 * so the headless and interactive paths share it.
 */

/**
 * Resolve the canonical vault root for tmux env exposure. The third-tier
 * fallback is the daemon's project root (the directory containing `.voicetree/`),
 * NOT the daemon's writePath — `$VOICETREE_VAULT_PATH/.voicetree/auth-token` is
 * read by the CLI, the agent hook script, and the prompt-file primitive, all of
 * which need the canonical root. See buildTerminalEnvVars for the same contract.
 */
export function resolveTmuxVaultPath(
    env: {readonly VOICETREE_VAULT_PATH?: string},
    initialEnvVars: Record<string, string>,
    runtimeProjectRoot?: string | null,
): string | undefined {
    return env.VOICETREE_VAULT_PATH ?? initialEnvVars.VOICETREE_VAULT_PATH ?? runtimeProjectRoot ?? undefined;
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

import type {TerminalId} from './terminal-registry/types';

export type PromptFileWriteRequest = {
    readonly vaultPath: string;
    readonly terminalId: TerminalId;
    readonly prompt: string;
};

export type HeadfulPromptInjectionRequest = {
    readonly terminalId: TerminalId;
    readonly command: string;
    readonly promptFilePath: string;
};

export function resolveTmuxVaultPath(
    env: Pick<NodeJS.ProcessEnv, 'VOICETREE_VAULT_PATH'>,
    initialEnvVars: Record<string, string>,
): string | undefined {
    return env.VOICETREE_VAULT_PATH ?? initialEnvVars.VOICETREE_VAULT_PATH;
}

export function resolvePromptFileWrite(
    vaultPath: string | undefined,
    terminalId: TerminalId,
    agentPrompt: string | undefined,
): PromptFileWriteRequest | null {
    if (!vaultPath || !agentPrompt) return null;
    return {vaultPath, terminalId, prompt: agentPrompt};
}

export function buildTmuxEnv(
    initialEnvVars: Record<string, string>,
    vaultPath: string | undefined,
    promptFilePath: string | null,
): Record<string, string> {
    const tmuxEnv: Record<string, string> = {};
    for (const key of Object.keys(initialEnvVars)) {
        if (key === 'AGENT_PROMPT') continue;
        const value: string = initialEnvVars[key];
        if (typeof value === 'string') tmuxEnv[key] = value;
    }
    tmuxEnv.AGENT_PROMPT = '';
    if (promptFilePath) tmuxEnv.AGENT_PROMPT_FILE = promptFilePath;
    if (vaultPath && !tmuxEnv.VOICETREE_VAULT_PATH) tmuxEnv.VOICETREE_VAULT_PATH = vaultPath;
    return tmuxEnv;
}

export function resolveHeadfulPromptInjection(
    terminalId: TerminalId,
    initialCommand: string | undefined,
    promptFilePath: string | null,
): HeadfulPromptInjectionRequest | null {
    if (!promptFilePath || !initialCommand) return null;
    return {terminalId, command: initialCommand, promptFilePath};
}

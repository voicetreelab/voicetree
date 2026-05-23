import type {TerminalId} from '../terminal-registry/types';

export type PromptFileWriteRequest = {
    readonly projectRoot: string;
    readonly terminalId: TerminalId;
    readonly prompt: string;
};

export type HeadfulPromptInjectionRequest = {
    readonly terminalId: TerminalId;
    readonly command: string;
};

export function resolveTmuxVaultPath(
    env: {readonly VOICETREE_VAULT_PATH?: string},
    initialEnvVars: Record<string, string>,
    runtimeWriteFolder?: string | null,
): string | undefined {
    return env.VOICETREE_VAULT_PATH ?? initialEnvVars.VOICETREE_VAULT_PATH ?? runtimeWriteFolder ?? undefined;
}

export function withResolvedTmuxVaultPath(
    initialEnvVars: Record<string, string>,
    projectRoot: string | undefined,
): Record<string, string> | undefined {
    if (!projectRoot && Object.keys(initialEnvVars).length === 0) return undefined;
    if (!projectRoot || initialEnvVars.VOICETREE_VAULT_PATH) return initialEnvVars;
    return {...initialEnvVars, VOICETREE_VAULT_PATH: projectRoot};
}

export function resolvePromptFileWrite(
    projectRoot: string | undefined,
    terminalId: TerminalId,
    agentPrompt: string | undefined,
): PromptFileWriteRequest | null {
    if (!projectRoot || !agentPrompt) return null;
    return {projectRoot, terminalId, prompt: agentPrompt};
}

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
    if (projectRoot && !tmuxEnv.VOICETREE_VAULT_PATH) tmuxEnv.VOICETREE_VAULT_PATH = projectRoot;
    return tmuxEnv;
}

export function resolveHeadfulPromptInjection(
    terminalId: TerminalId,
    initialCommand: string | undefined,
): HeadfulPromptInjectionRequest | null {
    if (!initialCommand) return null;
    return {terminalId, command: initialCommand};
}

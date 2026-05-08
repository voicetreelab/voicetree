// Late-bound runtime dependencies. Both Electron and vt-mcpd register their
// own implementations at boot. Headless callers can register only `env`
// (required for buildTerminalEnvVars); the UI bridge stays empty.

import type { TerminalData } from './types';

export type TraceFn = <T>(name: string, fn: () => Promise<T> | T) => Promise<T>;

export type RuntimeUIBridge = {
    readonly launchTerminalOntoUI?: (nodeId: string, terminalData: TerminalData, skipFitAnimation?: boolean) => void;
    readonly closeTerminalById?: (terminalId: string) => void;
    readonly logHookResult?: (message: string) => void;
    readonly registerChildIfMonitored?: (parentTerminalId: string, childTerminalId: string) => void;
};

export type RuntimeEnvProvider = {
    readonly getAppSupportPath: () => string;
    readonly getMcpPort: () => number;
    readonly getOTLPReceiverPort?: () => number | null;
    readonly getProjectRootWatchedDirectory?: () => string | null;
    readonly getVaultPaths?: () => Promise<readonly string[]>;
    readonly getWritePath?: () => Promise<string | null>;
};

export type AgentRuntimeConfig = {
    readonly ui?: RuntimeUIBridge;
    readonly env?: RuntimeEnvProvider;
    readonly trace?: TraceFn;
};

let config: AgentRuntimeConfig = {};

export function configureAgentRuntime(c: AgentRuntimeConfig): void {
    config = c;
}

export function getRuntimeUI(): RuntimeUIBridge {
    return config.ui ?? {};
}

export function getRuntimeEnv(): RuntimeEnvProvider {
    if (!config.env) {
        throw new Error('Agent runtime env provider not configured. Call configureAgentRuntime({ env: ... }) at boot.');
    }
    return config.env;
}

export function getRuntimeTrace(): TraceFn {
    return config.trace ?? (<T>(_name: string, fn: () => Promise<T> | T): Promise<T> => Promise.resolve(fn()));
}

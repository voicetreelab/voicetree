// Late-bound runtime dependencies. Both Electron and vt-mcpd register their
// own implementations at boot. Headless callers can register only `env`
// (required for buildTerminalEnvVars); the UI bridge stays empty.

import type { TerminalData } from './types';
import type { GraphDbClient } from '@vt/graph-db-client';

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
};

export type AgentRuntimeConfig = {
    readonly ui?: RuntimeUIBridge;
    readonly env?: RuntimeEnvProvider;
    readonly trace?: TraceFn;
    readonly graphDbClient?: GraphDbClient | (() => GraphDbClient | null | undefined);
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

export function getRuntimeGraphDbClient(): GraphDbClient {
    const graphDbClient = typeof config.graphDbClient === 'function'
        ? config.graphDbClient()
        : config.graphDbClient;

    if (!graphDbClient) {
        throw new Error('Agent runtime GraphDbClient not configured. Call configureAgentRuntime({ graphDbClient: ... }) at boot.');
    }

    return graphDbClient;
}

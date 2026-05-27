// Late-bound runtime dependencies. Both Electron and vt-mcpd register their
// own implementations at boot. Headless callers can register only `env`
// (required for buildTerminalEnvVars); the UI bridge stays empty.

import * as O from 'fp-ts/lib/Option.js';
import type { FilePath, Graph, GraphDelta, NodeIdAndFilePath } from '@vt/graph-model/graph';
import type { UnseenNode } from '@vt/graph-db-protocol';
import type { TerminalData } from '../terminals/terminal-registry/types';

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
    readonly getProjectRoot?: () => Promise<string | null>;
    readonly getVaultSnapshot: () => Promise<{
        readonly projectRoot: string | null;
        readonly readPaths: readonly string[];
        readonly writeFolder: string | null;
    }>;
    readonly getWriteFolder?: () => Promise<string | null>;
};

export type WatchStatus = {
    readonly isWatching: boolean;
    readonly directory: string | undefined;
};

export type GraphStateBridge = {
    readonly getGraph: () => Promise<Graph>;
    readonly getVaultPaths: () => Promise<readonly FilePath[]>;
    readonly getWriteFolder: () => Promise<O.Option<FilePath>>;
    readonly getProjectRoot: () => Promise<FilePath | null>;
    readonly getWatchStatus: () => Promise<WatchStatus>;
    readonly applyGraphDelta: (delta: GraphDelta, recordForUndo?: boolean) => Promise<void>;
    readonly createContextNode: (
        parentNodeId: NodeIdAndFilePath,
        semanticNodeIds?: readonly NodeIdAndFilePath[],
    ) => Promise<NodeIdAndFilePath>;
    readonly createContextNodeFromSelectedNodes: (
        taskNodeId: NodeIdAndFilePath,
        selectedNodeIds: readonly NodeIdAndFilePath[],
    ) => Promise<NodeIdAndFilePath>;
    readonly getUnseenNodesAroundContextNode: (
        contextNodeId: NodeIdAndFilePath,
        searchFromNode?: NodeIdAndFilePath,
    ) => Promise<readonly UnseenNode[]>;
    readonly updateContextNodeContainedIds: (
        contextNodeId: NodeIdAndFilePath,
        newNodeIds: readonly string[],
    ) => Promise<void>;
};

export type AgentRuntimeConfig = {
    readonly graph?: GraphStateBridge;
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

export function getGraphBridge(): GraphStateBridge | undefined {
    return config.graph;
}

export function getRuntimeTrace(): TraceFn {
    return config.trace ?? (<T>(_name: string, fn: () => Promise<T> | T): Promise<T> => Promise.resolve(fn()));
}

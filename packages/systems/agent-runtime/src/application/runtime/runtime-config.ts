// Late-bound runtime dependencies. The per-vault VTD (and headless
// vt-mcpd) register their own implementations at boot. Webapp/Electron
// is a client of VTD post-BF-376 and never configures agent-runtime
// directly.

import * as O from 'fp-ts/lib/Option.js';
import type { FilePath, Graph, GraphDelta, NodeIdAndFilePath } from '@vt/graph-model/graph';
import type { UnseenNode } from '@vt/graph-db-protocol';
import {
    setPublishTerminalRegistryEvent,
    type PublishTerminalRegistryEvent,
} from '../terminals/terminal-registry/terminal-registry-publisher';

export type TraceFn = <T>(name: string, fn: () => Promise<T> | T) => Promise<T>;

export type RuntimeEnvProvider = {
    readonly getAppSupportPath: () => string;
    readonly getProjectRoot?: () => Promise<string | null>;
    readonly getVaultPaths?: () => Promise<readonly string[]>;
    readonly getWriteFolder?: () => Promise<string | null>;
    /**
     * Absolute path to the canonical CLI manual file
     * (`packages/systems/voicetree-cli/prompts/cli-manual.md`). The spawn pipeline reads this file
     * and injects its contents into each spawned agent's AGENT_PROMPT so
     * the agent learns the `vt` CLI surface. Returns null when the file
     * cannot be located in this shell (headless tests, etc.); injection
     * is then skipped silently.
     */
    readonly getCliManualPath?: () => string | null;
    /**
     * Absolute path to the directory containing the `vt` CLI executable
     * (the daemon's known vt-bin dir). The spawn pipeline prepends this
     * directory to each spawned agent's PATH so commands like
     * `vt agent spawn` resolve as bare names in the agent's shell.
     * Returns null when the daemon shell did not register a location
     * (headless tests, etc.); PATH injection is then skipped silently.
     */
    readonly getVtBinDir?: () => string | null;
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
    readonly env?: RuntimeEnvProvider;
    readonly trace?: TraceFn;
    /**
     * Sink for the `terminal-registry` SSE topic. VTD injects the real publisher
     * at boot; unit tests inject a capturing array; everything else gets the
     * no-op default registered by `terminal-registry-publisher.ts`.
     */
    readonly publishTerminalRegistryEvent?: PublishTerminalRegistryEvent;
};

let config: AgentRuntimeConfig = {};

export function configureAgentRuntime(c: AgentRuntimeConfig): void {
    config = c;
    setPublishTerminalRegistryEvent(c.publishTerminalRegistryEvent);
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

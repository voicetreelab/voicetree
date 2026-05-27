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
    readonly recovery?: RecoveryEnv;
};

// ---------------------------------------------------------------------------
// Recovery community Reader-env (FP Pattern 3).
//
// The recovery resolvers/discovery/persistence functions used to reach for
// `node:fs`, `node:path`, `node:sqlite`, and `process.env.X` directly. That
// made their dependencies invisible in their signatures and inflated the
// implicit-globals subgraph measure on the `agent-runtime/application`
// community.
//
// Every recovery function now takes a `RecoveryEnv` argument carrying just
// the capabilities it needs (fs / path / sqlite / clock / config). The shell
// (Electron main, vt-mcpd, vt-resume) wires real `node:*` implementations
// at boot via `configureAgentRuntime({env: {..., recovery: ...}})`.
// ---------------------------------------------------------------------------

export type CodexThreadsQuery = {
    readonly limit: number;
    readonly sinceMs?: number;
};

export type CodexThreadsQueryResult =
    | {readonly kind: 'rows'; readonly rows: readonly Record<string, unknown>[]}
    | {readonly kind: 'db-missing'}
    | {readonly kind: 'db-schema-mismatch'};

export type RecoveryEnv = {
    readonly fs: {
        readonly existsSync: (path: string) => boolean;
        readonly readdirSync: (path: string) => readonly string[];
        /** Returns the file's contents as utf8, or '' if the file cannot be read. */
        readonly readFileUtf8: (path: string) => string;
        /** Returns `null` if the path does not exist or is otherwise unstattable. */
        readonly statSync: (path: string) => {
            readonly mtimeMs: number;
            readonly isDirectory: () => boolean;
            readonly isFile: () => boolean;
        } | null;
        readonly mkdirSync: (path: string, opts?: {readonly recursive?: boolean}) => void;
        readonly renameSync: (oldPath: string, newPath: string) => void;
        /** Writes utf8 contents; swallows errors (mirror readFileUtf8). */
        readonly writeFileUtf8: (path: string, contents: string) => void;
        /** Async unlink. ENOENT must propagate as an Error with `code: 'ENOENT'`. */
        readonly unlink: (path: string) => Promise<void>;
    };
    readonly path: {
        readonly join: (...parts: readonly string[]) => string;
        readonly resolve: (...parts: readonly string[]) => string;
    };
    readonly sqlite: {
        readonly queryCodexThreads: (dbPath: string, opts: CodexThreadsQuery) => CodexThreadsQueryResult;
    };
    readonly now: () => number;
    readonly recoveryConfig: {
        readonly claudeProjectsDir: string;
        readonly codexStateDb: string;
        /**
         * Override for the recovery horizon window (in days). Undefined falls
         * back to `RECOVERY_HORIZON_MS` (7 days). The shell reads
         * `VOICETREE_RECOVERY_HORIZON_DAYS` and propagates it here so the
         * discovery community doesn't reach for `process` directly.
         */
        readonly horizonDays?: number;
    };
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

export function getRecoveryEnv(): RecoveryEnv {
    const recovery: RecoveryEnv | undefined = getRuntimeEnv().recovery;
    if (!recovery) {
        throw new Error(
            'Agent runtime recovery env not configured. '
            + 'Call configureAgentRuntime({ env: { ..., recovery: { fs, path, sqlite, now, recoveryConfig } } }) at boot.',
        );
    }
    return recovery;
}

export function getGraphBridge(): GraphStateBridge | undefined {
    return config.graph;
}

export function getRuntimeTrace(): TraceFn {
    return config.trace ?? (<T>(_name: string, fn: () => Promise<T> | T): Promise<T> => Promise.resolve(fn()));
}

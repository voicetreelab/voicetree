import type { Option } from 'fp-ts/lib/Option.js';
import * as O from 'fp-ts/lib/Option.js';
import type { NodeIdAndFilePath } from '@vt/graph-model/graph';
import type { TerminalLifecycle } from '../../lifecycle/types';

export type TerminalId = string & { readonly __brand: 'TerminalId' };

export type TerminalData = {
    readonly type: 'Terminal';
    readonly terminalId: TerminalId;
    readonly attachedToContextNodeId: NodeIdAndFilePath;
    readonly terminalCount: number;

    readonly anchoredToNodeId: Option<NodeIdAndFilePath>;
    readonly title: string;
    readonly resizable: boolean;
    readonly shadowNodeDimensions: { readonly width: number; readonly height: number };

    readonly initialEnvVars?: Record<string, string>;
    readonly initialSpawnDirectory?: string;
    readonly initialCommand?: string;
    readonly executeCommand?: boolean;

    readonly isPinned: boolean;
    readonly isDone: boolean;
    readonly lifecycle: TerminalLifecycle;
    readonly lastOutputTime: number;
    readonly activityCount: number;

    readonly parentTerminalId: TerminalId | null;

    readonly agentName: string;
    readonly worktreeName: string | undefined;
    readonly isHeadless: boolean;
    readonly isMinimized: boolean;
    readonly contextContent: string;
    readonly agentTypeName: string;
};

export type CreateTerminalDataParams = {
    readonly terminalId: TerminalId;
    readonly attachedToNodeId: NodeIdAndFilePath;
    readonly terminalCount: number;
    readonly title: string;
    readonly anchoredToNodeId?: NodeIdAndFilePath;
    readonly initialEnvVars?: Record<string, string>;
    readonly initialSpawnDirectory?: string;
    readonly initialCommand?: string;
    readonly executeCommand?: boolean;
    readonly resizable?: boolean;
    readonly shadowNodeDimensions?: { width: number; height: number };
    readonly isPinned?: boolean;
    readonly parentTerminalId?: TerminalId | null;
    readonly agentName: string;
    readonly worktreeName?: string;
    readonly isHeadless?: boolean;
    readonly isMinimized?: boolean;
    readonly contextContent?: string;
    readonly agentTypeName?: string;
};

export function computeTerminalId(attachedToNodeId: string, terminalCount: number): TerminalId {
    return `${attachedToNodeId}-terminal-${terminalCount}` as TerminalId;
}

export function getTerminalId(terminal: TerminalData): TerminalId {
    return terminal.terminalId;
}

function currentTimeMillis(): number {
    return Date.now();
}

export function createTerminalData(
    params: CreateTerminalDataParams,
    now: () => number = currentTimeMillis
): TerminalData {
    return {
        type: 'Terminal',
        terminalId: params.terminalId,
        attachedToContextNodeId: params.attachedToNodeId,
        terminalCount: params.terminalCount,
        title: params.title,
        anchoredToNodeId: params.anchoredToNodeId ? O.some(params.anchoredToNodeId) : O.none,
        initialEnvVars: params.initialEnvVars,
        initialSpawnDirectory: params.initialSpawnDirectory,
        initialCommand: params.initialCommand,
        executeCommand: params.executeCommand,
        resizable: params.resizable ?? true,
        shadowNodeDimensions: params.shadowNodeDimensions ?? { width: 395, height: 380 },
        isPinned: params.isPinned ?? true,
        isDone: false,
        lifecycle: 'spawning',
        lastOutputTime: now(),
        activityCount: 0,
        parentTerminalId: params.parentTerminalId ?? null,
        agentName: params.agentName,
        worktreeName: params.worktreeName,
        isHeadless: params.isHeadless ?? false,
        isMinimized: params.isMinimized ?? false,
        contextContent: params.contextContent ?? '',
        agentTypeName: params.agentTypeName ?? '',
    };
}

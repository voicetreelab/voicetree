/**
 * Runtime helpers around the canonical terminal types.
 *
 * The type definitions for `TerminalId`, `TerminalData`, and
 * `CreateTerminalDataParams` are now owned by `@vt/vt-daemon-protocol`
 * (BF-376 outbound) so both the VTD daemon and its clients can share
 * one shape without laundering a runtime dependency on agent-runtime.
 * This file re-exports them so the existing deep import path
 * (`agent-runtime/.../terminal-registry/types`) stays stable, and
 * keeps the side-effect-free helpers that operate on those shapes
 * (constructor, ID derivation).
 */

import * as O from 'fp-ts/lib/Option.js';
import type {
    TerminalId,
    TerminalData,
    CreateTerminalDataParams,
} from '@vt/vt-daemon-protocol';

export type {TerminalId, TerminalData, CreateTerminalDataParams};

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
        worktreeName: params.worktreeName,
        isHeadless: params.isHeadless ?? false,
        isMinimized: params.isMinimized ?? false,
        contextContent: params.contextContent ?? '',
        agentTypeName: params.agentTypeName ?? '',
    };
}

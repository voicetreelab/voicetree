import type { NodeIdAndFilePath } from '../graph'

/**
 * Branded TerminalId type — matches the shell definition.
 */
export type TerminalId = string & { readonly __brand: 'TerminalId' };

/**
 * Minimal pure-boundary TerminalData interface.
 * The full TerminalData in shell/edge extends this with UI fields.
 * Pure functions should use this or a generic constrained to it.
 */
export interface TerminalData {
    readonly type: 'Terminal';
    readonly terminalId: TerminalId;
    readonly attachedToContextNodeId: NodeIdAndFilePath;
    readonly terminalCount: number;
    readonly initialEnvVars?: Record<string, string>;
    readonly initialSpawnDirectory?: string;
    readonly initialCommand?: string;
    readonly executeCommand?: boolean;
    readonly isPinned: boolean;
    readonly isDone: boolean;
    readonly lastOutputTime: number;
    readonly activityCount: number;
    readonly parentTerminalId: TerminalId | null;
    readonly agentName: string;
    readonly worktreeName: string | undefined;
    readonly isHeadless: boolean;
    readonly isMinimized: boolean;
    readonly contextContent: string;
    readonly agentTypeName: string;
}

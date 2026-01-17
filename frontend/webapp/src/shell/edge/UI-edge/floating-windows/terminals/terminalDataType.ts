import type {NodeIdAndFilePath} from "@/pure/graph";
import type {FloatingWindowFields} from "@/shell/edge/UI-edge/floating-windows/types";

export type TerminalData = FloatingWindowFields & {
    readonly type: 'Terminal';
    readonly attachedToNodeId: NodeIdAndFilePath;
    readonly terminalCount: number; // Multiple terminals per parent node allowed
    readonly initialEnvVars?: Record<string, string>;
    readonly initialSpawnDirectory?: string;
    readonly initialCommand?: string;
    readonly executeCommand?: boolean;
    // Tab UI state (managed by TerminalStore, rendered by AgentTabsBar)
    readonly isPinned: boolean;
    readonly isDone: boolean;
    readonly lastOutputTime: number;
    readonly activityCount: number;
};
export type CreateTerminalDataParams = {
    readonly attachedToNodeId: NodeIdAndFilePath;
    readonly terminalCount: number;
    readonly title: string;
    readonly anchoredToNodeId?: NodeIdAndFilePath; // defaults to O.none
    readonly initialEnvVars?: Record<string, string>;
    readonly initialSpawnDirectory?: string;
    readonly initialCommand?: string;
    readonly executeCommand?: boolean;
    readonly resizable?: boolean; // defaults to true
    readonly shadowNodeDimensions?: { width: number; height: number };
    readonly isPinned?: boolean; // defaults to true
};
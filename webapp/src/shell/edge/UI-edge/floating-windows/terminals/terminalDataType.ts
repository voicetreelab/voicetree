import type {NodeIdAndFilePath} from "@/pure/graph";
import type {FloatingWindowFields, TerminalId} from "@/shell/edge/UI-edge/floating-windows/types";

export type TerminalData = FloatingWindowFields & {
    readonly type: 'Terminal';
    readonly terminalId: TerminalId; // Single source of truth for terminal identity
    readonly attachedToContextNodeId: NodeIdAndFilePath;
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
    // Parent-child relationship for tree-style tabs (null = root terminal)
    readonly parentTerminalId: TerminalId | null;
    // Agent name for matching terminal to nodes it creates (via agent_name in YAML)
    readonly agentName: string;
    // Worktree directory name when terminal was spawned in a git worktree (undefined = not in worktree)
    readonly worktreeName: string | undefined;
};
export type CreateTerminalDataParams = {
    readonly terminalId: TerminalId; // Now passed directly (equals agentName)
    readonly attachedToNodeId: NodeIdAndFilePath;
    readonly terminalCount: number;
    readonly title: string;
    readonly anchoredToNodeId?: NodeIdAndFilePath; // IMPORTANT anchoredToNodeId is the task node for terminals (todo leakage)
    readonly initialEnvVars?: Record<string, string>;
    readonly initialSpawnDirectory?: string;
    readonly initialCommand?: string;
    readonly executeCommand?: boolean;
    readonly resizable?: boolean; // defaults to true
    readonly shadowNodeDimensions?: { width: number; height: number };
    readonly isPinned?: boolean; // defaults to true
    readonly parentTerminalId?: TerminalId | null; // defaults to null (root terminal)
    readonly agentName: string; // Agent name for terminal-to-node edge matching (same as terminalId)
    readonly worktreeName?: string; // Worktree directory name (undefined = not in worktree)
};
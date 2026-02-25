import {type HotkeySettings, type VTSettings} from "@/pure/settings/types";

/** Mac-style defaults using Meta key */
const MAC_HOTKEYS: HotkeySettings = {
    fitToLastNode: { key: ' ', modifiers: [] },
    nextTerminal: { key: ']', modifiers: ['Meta'] },
    prevTerminal: { key: '[', modifiers: ['Meta'] },
    createNewNode: { key: 'n', modifiers: ['Meta'] },
    runTerminal: { key: 'Enter', modifiers: ['Meta'] },
    deleteSelectedNodes: { key: 'Backspace', modifiers: ['Meta'] },
    closeWindow: { key: 'w', modifiers: ['Meta'] },
    openSettings: { key: ',', modifiers: ['Meta'] },
    openSearch: { key: 'f', modifiers: ['Meta'] },
    openSearchAlt: { key: 'e', modifiers: ['Meta'] },
    recentNode1: { key: '1', modifiers: ['Meta'] },
    recentNode2: { key: '2', modifiers: ['Meta'] },
    recentNode3: { key: '3', modifiers: ['Meta'] },
    recentNode4: { key: '4', modifiers: ['Meta'] },
    recentNode5: { key: '5', modifiers: ['Meta'] },
    voiceRecording: { key: 'r', modifiers: ['Alt'] },
};

/** Non-Mac defaults using Control key */
const NON_MAC_HOTKEYS: HotkeySettings = {
    fitToLastNode: { key: ' ', modifiers: [] },
    nextTerminal: { key: ']', modifiers: ['Control'] },
    prevTerminal: { key: '[', modifiers: ['Control'] },
    createNewNode: { key: 'n', modifiers: ['Control'] },
    runTerminal: { key: 'Enter', modifiers: ['Control'] },
    deleteSelectedNodes: { key: 'Backspace', modifiers: ['Control'] },
    closeWindow: { key: 'w', modifiers: ['Control'] },
    openSettings: { key: ',', modifiers: ['Control'] },
    openSearch: { key: 'f', modifiers: ['Control'] },
    openSearchAlt: { key: 'e', modifiers: ['Control'] },
    recentNode1: { key: '1', modifiers: ['Control'] },
    recentNode2: { key: '2', modifiers: ['Control'] },
    recentNode3: { key: '3', modifiers: ['Control'] },
    recentNode4: { key: '4', modifiers: ['Control'] },
    recentNode5: { key: '5', modifiers: ['Control'] },
    voiceRecording: { key: 'r', modifiers: ['Alt'] },
};

const isMac: boolean = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');

/** Platform-appropriate default hotkeys */
export const DEFAULT_HOTKEYS: HotkeySettings = isMac ? MAC_HOTKEYS : NON_MAC_HOTKEYS;


const isWindows: boolean = typeof process !== 'undefined' && process.platform === 'win32';
/** Platform-aware env var syntax for agent commands */
const AGENT_PROMPT_VAR: string = isWindows ? '$env:AGENT_PROMPT' : '$AGENT_PROMPT';
export const DEFAULT_SETTINGS: VTSettings = {
    terminalSpawnPathRelativeToWatchedDirectory: '/',
    contextNodeMaxDistance: 5,
    askModeContextDistance: 3,
    emptyFolderTemplate: `# {{DATE}}

Highest priority task: `,
    disableStarterNodes: false,
    agents: [
        {
            name: 'Claude',
            command: `claude --dangerously-skip-permissions "${AGENT_PROMPT_VAR}"`,
        },
        {
            name: 'Claude Sonnet',
            command: `claude --dangerously-skip-permissions --model sonnet "${AGENT_PROMPT_VAR}"`,
        },
        {
            name: 'Gemini',
            command: `gemini -i "${AGENT_PROMPT_VAR}"`,
        },
        {
            name: 'Codex',
            command: `codex "${AGENT_PROMPT_VAR}"`,
        },
        {
            name: 'Rovodev',
            command: `acli rovodev run "${AGENT_PROMPT_VAR}"`,
        },
        {
            name: 'Opencode',
            command: `opencode --prompt "${AGENT_PROMPT_VAR}"`
        }
    ],
    shiftEnterSendsOptionEnter: true,
    vimMode: false,
    INJECT_ENV_VARS: {
        AGENT_PROMPT_LIGHTWEIGHT: `First read and analyze the context of your task, which is stored at $CONTEXT_NODE_PATH
You are being run within a graph of Markdown files that represents your project context. These markdown files are stored within $ALL_MARKDOWN_READ_PATHS
Follow the <AGENT_INSTRUCTIONS> from your context node.
<YOUR_ENV_VARS>
VOICETREE_TERMINAL_ID = $VOICETREE_TERMINAL_ID
AGENT_NAME = $AGENT_NAME
CONTEXT_NODE_PATH = $CONTEXT_NODE_PATH
TASK_NODE_PATH = $TASK_NODE_PATH
VOICETREE_VAULT_PATH = $VOICETREE_VAULT_PATH
VOICETREE_APP_SUPPORT = $VOICETREE_APP_SUPPORT
VOICETREE_PROJECT_DIR = $VOICETREE_PROJECT_DIR
VOICETREE_MCP_PORT = $VOICETREE_MCP_PORT
</YOUR_ENV_VARS>`,
        AGENT_PROMPT: `First read and analyze the context of your task, which is stored at $CONTEXT_NODE_PATH
You are being run within a graph of Markdown files that represents your project context. These markdown files are stored within $ALL_MARKDOWN_READ_PATHS
<HANDLING_AMBIGUITY>
If your task has non-trivial ambiguity, stop and ask the user for clarifications. For each clarifying question include your current working assumption. Otherwise, if the task is clear, continue working on it, or developing your task plan until ambiguity does arise.
</HANDLING_AMBIGUITY>
<ORCHESTRATION>
Before starting work, answer: Does this task have 2+ distinct concerns or phases?

YES → Decompose into nodes and spawn voicetree agents first (mcp__voicetree__spawn_agent). Users get visibility into subagent work this way—built-in subagents are a black box.
NO → Proceed directly.

See decompose_subtask_dependency_graph.md for decomposition / dependency graph patterns.
</ORCHESTRATION>
<TASK_NODES_INSTRUCTION>
For the entire duration of this session, before you report completion to the user for any query, task, sub-task, proposal, or other form of non-trivial progress, you MUST create progress node(s) documenting your work.

Add to your todolist now to read addProgressTree.md and create progress node(s).

Primary method: Use the \`create_graph\` MCP tool with VOICETREE_TERMINAL_ID=$VOICETREE_TERMINAL_ID. Supports 1+ nodes per call — single concept nodes or multi-node trees.
Before creating your first progress node, read $VOICETREE_PROJECT_DIR/prompts/addProgressTree.md for composition guidance (when to split, scope rules, what to embed).

You must create a progress node before reporting completion to the user. You must continue to do this for any follow-ups by either updating existing progress nodes, or creating new ones.
</TASK_NODES_INSTRUCTION>
<YOUR_ENV_VARS>
VOICETREE_TERMINAL_ID = $VOICETREE_TERMINAL_ID
AGENT_NAME = $AGENT_NAME
CONTEXT_NODE_PATH = $CONTEXT_NODE_PATH
TASK_NODE_PATH = $TASK_NODE_PATH
VOICETREE_VAULT_PATH = $VOICETREE_VAULT_PATH
VOICETREE_APP_SUPPORT = $VOICETREE_APP_SUPPORT
VOICETREE_PROJECT_DIR = $VOICETREE_PROJECT_DIR
VOICETREE_MCP_PORT = $VOICETREE_MCP_PORT
</YOUR_ENV_VARS>`,
    },
    hotkeys: DEFAULT_HOTKEYS,
    defaultAllowlistPatterns: [],
    autoNotifyUnseenNodes: false,
    darkMode: false,
    zoomSensitivity: 1.0,
    nodeLineLimit: 70,
    showFps: false,
    starredFolders: [],
    hooks: {
        onWorktreeCreatedBlocking: './.voicetree/hooks/on-worktree-created-blocking.sh',
        postWorktreeCreatedAsync: './.voicetree/hooks/on-worktree-created-async.sh',
        onNewNode: 'node .voicetree/hooks/on-new-node.cjs',
    },
    layoutConfig: JSON.stringify({
        engine: 'cola',
        // Cola layout options
        nodeSpacing: 120,
        convergenceThreshold: 0.4,
        unconstrIter: 15,
        allConstIter: 25,
        handleDisconnected: true,
        tile: true,
        tilingPaddingVertical: 10,
        tilingPaddingHorizontal: 10,
        edgeElasticity: 0.45,
        // Cola — static fallback; runtime default uses per-edge function (350 normal / 125 editor)
        edgeLength: 350,
    }, null, 2),
};
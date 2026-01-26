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
    agents: [
        {
            name: 'Claude',
            command: `claude --settings "$VOICETREE_APP_SUPPORT/tools/claude-settings.json" "${AGENT_PROMPT_VAR}"`,
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
        }
    ],
    shiftEnterSendsOptionEnter: true,
    vimMode: false,
    INJECT_ENV_VARS: {
        AGENT_PROMPT: `First read and analyze the context of your task, which is stored at $CONTEXT_NODE_PATH
You are being run within a graph of Markdown files that represents your project context. These markdown files are stored within $ALL_MARKDOWN_READ_PATHS
<HANDLING_AMBIGUITY>
If your task has non-trivial ambiguity, stop and ask the user for clarifications. For each clarifying question include your current working assumption. Otherwise, if the task is clear, continue working on it, or developing your task plan until ambiguity does arise.
</HANDLING_AMBIGUITY>

<TASK_NODES_INSTRUCTION>
For the entire duration of this session, before you report completion to the user for any query, task, sub-task, proposal, or other form of non-trivial progress, you MUST: 1. Read $VOICETREE_APP_SUPPORT/tools/prompts/addNode.md 2. Follow the instructions to create progress nodes documenting your work. If using a todolist, add 'Read instructions to create progress nodes' as an item. You must create a progress node before reporting completion to the user. You must continue to create progress nodes for any follow-ups by either updating existing progress nodes, or creating new ones.
</TASK_NODES_INSTRUCTION>`,
    },
    hotkeys: DEFAULT_HOTKEYS,
    defaultAllowlistPatterns: [],
    darkMode: false
};
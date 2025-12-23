export interface AgentConfig {
    readonly name: string;
    readonly command: string;
}

export const AGENT_NAMES: readonly string[] = [
    'Aki', 'Ama', 'Amit', 'Amy', 'Anna', 'Ari', 'Ayu', 'Ben', 'Bob', 'Cho',
    'Dae', 'Dan', 'Eli', 'Emi', 'Eva', 'Eve', 'Fei', 'Gia', 'Gus', 'Hana',
    'Ian', 'Iris', 'Ivan', 'Ivy', 'Jay', 'Jin', 'John', 'Jose', 'Juan', 'Jun',
    'Kai', 'Kate', 'Leo', 'Lou', 'Luis', 'Mary', 'Max', 'Meg', 'Mei', 'Mia',
    'Nia', 'Noa', 'Omar', 'Otto', 'Raj', 'Ren', 'Rex', 'Rio', 'Sai', 'Sam',
    'Siti', 'Tao', 'Tara', 'Timi', 'Uma', 'Vic', 'Wei', 'Xan', 'Yan', 'Zoe',
] as const;

export function getRandomAgentName(): string {
    const randomIndex: number = Math.floor(Math.random() * AGENT_NAMES.length);
    return AGENT_NAMES[randomIndex];
}

export type EnvVarValue = string | readonly string[];

// Hotkey configuration types
export type HotkeyModifier = 'Meta' | 'Control' | 'Alt' | 'Shift';

export interface HotkeyBinding {
    readonly key: string;
    readonly modifiers: readonly HotkeyModifier[];
}

export interface HotkeySettings {
    readonly fitToLastNode: HotkeyBinding;
    readonly nextTerminal: HotkeyBinding;
    readonly prevTerminal: HotkeyBinding;
    readonly createNewNode: HotkeyBinding;
    readonly runTerminal: HotkeyBinding;
    readonly deleteSelectedNodes: HotkeyBinding;
    readonly closeWindow: HotkeyBinding;
    readonly openSettings: HotkeyBinding;
    readonly openSearch: HotkeyBinding;
    readonly openSearchAlt: HotkeyBinding; // Cmd+E recent nodes ninja
    readonly recentNode1: HotkeyBinding;
    readonly recentNode2: HotkeyBinding;
    readonly recentNode3: HotkeyBinding;
    readonly recentNode4: HotkeyBinding;
    readonly recentNode5: HotkeyBinding;
}

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
};

const isMac: boolean = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');

/** Platform-appropriate default hotkeys */
export const DEFAULT_HOTKEYS: HotkeySettings = isMac ? MAC_HOTKEYS : NON_MAC_HOTKEYS;

export interface VTSettings {
    readonly terminalSpawnPathRelativeToWatchedDirectory: string;
    readonly agents: readonly AgentConfig[];
    readonly shiftEnterSendsOptionEnter: boolean;
    readonly INJECT_ENV_VARS: Record<string, EnvVarValue>;
    /** Maximum traversal distance when creating context nodes */
    readonly contextNodeMaxDistance: number;
    /** Maximum traversal distance when creating context nodes in Ask mode (from each relevant node) */
    readonly askModeContextDistance: number;
    /** Whether user has been prompted about agent permission mode (auto-run vs safe mode) */
    readonly agentPermissionModeChosen?: boolean;
    /** User email for PostHog identification - stored here to persist across app updates */
    readonly userEmail?: string;
    /** Template for starter node created when opening an empty folder. Supports {{DATE}} placeholder. */
    readonly emptyFolderTemplate?: string;
    /** Enable VIM keybindings in markdown editors */
    readonly vimMode?: boolean;
    /** Custom hotkey bindings - falls back to DEFAULT_HOTKEYS if not set */
    readonly hotkeys?: HotkeySettings;
}

export const DEFAULT_SETTINGS: VTSettings = {
    terminalSpawnPathRelativeToWatchedDirectory: '/',
    contextNodeMaxDistance: 6,
    askModeContextDistance: 3,
    emptyFolderTemplate: `# {{DATE}}

Highest priority task: `,
    agents: [
        {
            name: 'Claude',
            command: `claude "$AGENT_PROMPT"`,
        },
        {
            name: 'Gemini',
            command: `gemini -i "$AGENT_PROMPT"`,
        },
        {
            name: 'Codex',
            command: `codex "$AGENT_PROMPT"`,
        },
        {
            name: 'Rovodev',
            command: `acli rovodev run "$AGENT_PROMPT"`,
        }
    ],
    shiftEnterSendsOptionEnter: true,
    vimMode: false,
    INJECT_ENV_VARS: {
        AGENT_PROMPT: `First analyze the context of your task: <TASK_CONTEXT> $CONTEXT_NODE_CONTENT </TASK_CONTEXT>
            Briefly explore your directory to gather additional critical context.
            <HANDLING_AMBIGUITY> If your task has non-trivial ambiguity, stop and ask the user for clarifications. For each clarifying question include your current working assumption. Otherwise, if the task is clear, continue working on it, or developing your task plan until ambiguity does arise.</HANDLING_AMBIGUITY>
            <TASK_NODES_INSTRUCTION> After completing any task, or sub-task (such as after proposing an implementation plan), you MUST:
            1. Read $VOICETREE_APP_SUPPORT/tools/prompts/addNode.md
            2. Follow the instructions to create a progress node documenting your work.
            If using a todolist, add 'Create progress node' as the final item. Either way, you MUST create a progress node before reporting completion to the user. </TASK_NODES_INSTRUCTION>`,
    },
};

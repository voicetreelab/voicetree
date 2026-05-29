import type { VTSettings, HotkeySettings, AgentConfig, HookSettings, EnvVarValue } from './types';

// ============================================================================
// Types
// ============================================================================

export type Section = 'general' | 'shortcuts' | 'agents' | 'hooks' | 'advanced';

export interface NumberFieldConfig {
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly slider?: boolean;
}

/**
 * Schema entry for a single setting. Every VTSettings key must have one.
 * - `default`: value used in DEFAULT_SETTINGS. Omit for optional settings with no default.
 * - `section`: UI tab. Omit = 'advanced'. Ignored when `hidden` is true.
 * - `hidden`: true = not shown in settings UI.
 * - `label`: human-readable label. Auto-generated from key if omitted.
 * - `number`: constraints for number fields (min/max/step/slider).
 */
export type SettingsSchema = {
    readonly [K in keyof Required<VTSettings>]: {
        readonly default?: Required<VTSettings>[K];
        readonly section?: Section;
        readonly hidden?: true;
        readonly label?: string;
        readonly number?: NumberFieldConfig;
    };
};

export interface SettingsRuntime {
    readonly platform?: string;
    readonly homeDir?: string;
}

// ============================================================================
// Platform logic
// ============================================================================

export function platformFromBrowserText(browserPlatform: string): string {
    if (/mac|iphone|ipad|ipod/i.test(browserPlatform)) return 'darwin';
    if (/win/i.test(browserPlatform)) return 'win32';
    return '';
}

export function agentPromptVariableForPlatform(platform: string | undefined): string {
    return platform === 'win32' ? '$env:AGENT_PROMPT' : '$AGENT_PROMPT';
}

export function defaultHotkeysForPlatform(platform: string | undefined): HotkeySettings {
    return platform === 'darwin' ? MAC_HOTKEYS : NON_MAC_HOTKEYS;
}

// ============================================================================
// Hotkey defaults
// ============================================================================

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

// ============================================================================
// Schema — single source of truth for all settings metadata + defaults
// ============================================================================

export function createSettingsSchema(runtime: SettingsRuntime = {}): SettingsSchema {
    const agentPromptVar: string = agentPromptVariableForPlatform(runtime.platform);
    const defaultHotkeys: HotkeySettings = defaultHotkeysForPlatform(runtime.platform);
    const starredFolders: readonly string[] = runtime.homeDir ? [`${runtime.homeDir}/brain/workflows`] : [];

    return {
    // ── General ──────────────────────────────────────────────────────────
    darkMode:                  { default: false, section: 'general', label: 'Dark Mode' },
    vimMode:                   { default: false, section: 'general', label: 'Vim Mode' },
    shiftEnterSendsOptionEnter:{ default: true,  section: 'general', label: 'Shift+Enter \u2192 Option+Enter' },
    autoNotifyUnseenNodes:     { default: false, section: 'general', label: 'Auto-notify Unseen Nodes' },
    notifyOnAgentCompletion:   { default: true,  section: 'general', label: 'Notify on Agent Completion' },
    zoomSensitivity:           { default: 1.0,   section: 'general', label: 'Zoom Sensitivity', number: { min: 0.1, max: 5.0, step: 0.1, slider: true } },
    terminalSpawnPathRelativeToWatchedDirectory: { default: '/', section: 'general', label: 'Terminal Spawn Path' },
    terminalTmuxMouseMode:     { default: false, section: 'general', label: 'Terminal tmux Mouse Mode' },
    shell:                     { section: 'general', label: 'Shell Override' },
    emptyFolderTemplate:       { default: `# {{DATE}}\n\nHighest priority task: `, section: 'general', label: 'Empty Folder Template' },

    // ── Shortcuts ────────────────────────────────────────────────────────
    hotkeys: { default: defaultHotkeys, section: 'shortcuts' },

    // ── Agents ───────────────────────────────────────────────────────────
    agents: {
        default: [
            { name: 'Claude',        command: `CLAUDE_CODE_NO_FLICKER=1 claude --dangerously-skip-permissions "${agentPromptVar}"` },
            { name: 'Claude Sonnet', command: `CLAUDE_CODE_NO_FLICKER=1 claude --dangerously-skip-permissions --model sonnet "${agentPromptVar}"` },
            { name: 'Gemini',        command: `gemini -i "${agentPromptVar}"` },
            { name: 'Codex',         command: `codex "${agentPromptVar}"` },
            { name: 'Rovodev',       command: `acli rovodev run "${agentPromptVar}"` },
            { name: 'Opencode',      command: `opencode --prompt "${agentPromptVar}"` },
            { name: 'Fake Agent',   command: `node tools/vt-fake-agent/dist/index.js "${agentPromptVar}"` },
        ] as readonly AgentConfig[],
        section: 'agents',
    },
    INJECT_ENV_VARS: {
        default: {
            AGENT_PROMPT_LIGHTWEIGHT: `First read and analyze the context of your task, which is stored at $CONTEXT_NODE_PATH
You are being run within a graph of Markdown files that represents your project context. These markdown files are stored within $ALL_MARKDOWN_READ_PATHS
<YOUR_ENV_VARS>
VOICETREE_TERMINAL_ID = $VOICETREE_TERMINAL_ID
AGENT_NAME = $AGENT_NAME
CONTEXT_NODE_PATH = $CONTEXT_NODE_PATH
TASK_NODE_PATH = $TASK_NODE_PATH
VOICETREE_PROJECT_PATH = $VOICETREE_PROJECT_PATH
VOICETREE_HOME_PATH = $VOICETREE_HOME_PATH
VOICETREE_PROJECT_DIR = $VOICETREE_PROJECT_DIR
DEPTH_BUDGET = $DEPTH_BUDGET
</YOUR_ENV_VARS>`,
            AGENT_PROMPT_CORE: `First read and analyze the context of your task, which is stored at $CONTEXT_NODE_PATH
You are being run within a graph/mindmap of Markdown files that represents your project context. These markdown files are stored within $ALL_MARKDOWN_READ_PATHS
<VT_CLI>
Voicetree operations are exposed as the \`vt\` CLI (available on PATH). Run \`vt manual\` for the full reference or \`vt manual <verb>\` for one tool section. There is no MCP server in this environment — every voicetree action (spawning agents, listing agents, creating progress nodes, reading nearby unseen nodes, sending messages, etc.) MUST go through \`vt <verb>\`. $VOICETREE_PROJECT_PATH is already exported in your env so vt resolves against the correct vault.
</VT_CLI>
<utilising_mindmap>
This mindmap is designed to help the human parse context by being able to visualise it at a higher level of abstraction (as concepts and connections). It accomplishes this by presenting a default view which only displays key details / concepts, i.e. the most important information for the user to understand pieces of information (such as an argument, codebase, task progression trace), and less important information is hidden within the within-nodes view.
</utilising_mindmap>
<HANDLING_AMBIGUITY>
If your task has non-trivial ambiguity, stop and ask the user for clarifications. For each clarifying question include your current working assumption. Otherwise, if the task is clear, continue working on it, or developing your task plan until ambiguity does arise.
</HANDLING_AMBIGUITY>
<ORCHESTRATION>
Answer this BEFORE your first substantive action:

Does this task have 2+ independent concerns, questions, or phases? And would this task benefit from using multiple agents? If the task can be performed by a single agent within one context window, then DO NOT EVER spawn multiple agents. This is wasteful of resources and cause infinite compute loops, as you infinitely subdivide tasks. Check what current agents are running first with \`vt agent list\` so you can see where within the larger system you are working. That said, don't shy away from using agents either, if there is compute and your task is long / hard / complex AND valuable to be solved, do it!

When deciding whether to decompose, count only distinct substantive subproblems, questions, or deliverables whose separation would materially improve speed or quality. Do not count generic execution overhead that appears in most tasks.

YES_BENEFITS_FROM_MULTI_AGENT_ORCHESTRATION + DEPTH_BUDGET > 0 \u2192 You should decompose. Spawn one voicetree agent per concern (\`vt agent spawn\`) BEFORE doing substantive work. This includes research tasks: 2 key / important questions + 6 medium questions might justify 3 parallel agents, not 8 sequential searches by you, but also not 8 agents. Avoid making more than 3 tool calls before spawning. Users get visibility into subagent work this way \u2014 built-in subagents are a black box.
NO \u2192 Proceed directly. Do the task just yourself.

See decompose_subtask_dependency_graph.md for generally useful orchestration / decomposition / dependency graph patterns.
</ORCHESTRATION>
<TASK_NODES_INSTRUCTION>
For the entire duration of this session, before you report completion to the user for any query, task, sub-task, proposal, or other form of non-trivial progress, you MUST create node(s) documenting your work via \`vt graph create\` (pipe a JSON payload to stdin — see \`vt manual graph create\` for the schema).

Add to your todolist now to read $VOICETREE_PROJECT_DIR/prompts/addProgressTree.md on how and when to create node(s). You must read it.

You must create a progress node before reporting completion to the user or otherwise finishing the task fully. You must continue to do this for any follow-ups by either updating existing progress nodes, or creating new ones.
</TASK_NODES_INSTRUCTION>
<YOUR_ENV_VARS>
VOICETREE_TERMINAL_ID = $VOICETREE_TERMINAL_ID
AGENT_NAME = $AGENT_NAME
CONTEXT_NODE_PATH = $CONTEXT_NODE_PATH
TASK_NODE_PATH = $TASK_NODE_PATH
VOICETREE_PROJECT_PATH = $VOICETREE_PROJECT_PATH
VOICETREE_HOME_PATH = $VOICETREE_HOME_PATH
VOICETREE_PROJECT_DIR = $VOICETREE_PROJECT_DIR
DEPTH_BUDGET = $DEPTH_BUDGET // TOTAL available, not trigger-happy recommended spend!
</YOUR_ENV_VARS>`,
            AGENT_PROMPT: '$AGENT_PROMPT_CORE',
            DEPTH_BUDGET: '12',
        } as Record<string, EnvVarValue>,
        section: 'agents',
        label: 'Environment Variables',
    },

    // ── Hooks ────────────────────────────────────────────────────────────
    hooks: {
        default: {
            onWorktreeCreatedBlocking: './scripts/git/worktree/on-created-blocking.sh',
            postWorktreeCreatedAsync: './scripts/git/worktree/on-created-async.sh',
            onNewNode: '# node .voicetree/hooks/on-new-node.cjs',
        } as HookSettings,
        section: 'hooks',
    },

    // ── Advanced (default section — no need to specify) ──────────────────
    contextNodeMaxDistance: { default: 5,   label: 'Context Distance',   number: { min: 1, max: 58, step: 1 } },
    enableSemanticContext:  { default: false, label: 'Semantic Context' },
    contextMaxChars:       { default: 8000, label: 'Context Budget (chars)', number: { min: 2000, max: 100000, step: 2000 } },
    askModeContextDistance: { default: 3,   label: 'Ask Mode Distance',  number: { min: 1, max: 20, step: 1 } },
    defaultAllowlistPatterns: { default: [] as readonly string[], label: 'Default Allowlist Patterns' },
    starredFolders:         { default: starredFolders, label: 'Starred Folders' },
    showFps:                { default: false, label: 'Show FPS (WebGL)' },
    layoutConfig:           { default: JSON.stringify({ engine: 'cola', nodeSpacing: 120, convergenceThreshold: 0.4, unconstrIter: 15, allConstIter: 25, handleDisconnected: true, tile: true, tilingPaddingVertical: 10, tilingPaddingHorizontal: 10, edgeElasticity: 0.45, edgeLength: 350 }, null, 2), label: 'Layout Config' },
    nodeLineLimit:          { default: 80,  label: 'Node Line Limit',    number: { min: 20, max: 200, step: 10 } },

    // ── Hidden (not shown in UI — rendered inside agent-list field) ──────
    defaultAgent:              { hidden: true },

    // ── Hidden (not shown in UI) ─────────────────────────────────────────
    agentPromptCoreSyncedAppVersion: { hidden: true },
    agentPermissionModeChosen: { hidden: true },
    feedbackDialogShown:       { hidden: true },
    userEmail:                 { hidden: true },
    };
}

// ============================================================================
// Derived exports
// ============================================================================

/** Default settings derived from schema — only entries with a `default` value */
export function createDefaultSettings(runtime: SettingsRuntime = {}): VTSettings {
    return Object.fromEntries(
        Object.entries(createSettingsSchema(runtime))
            .filter(([, v]) => 'default' in v)
            .map(([k, v]) => [k, v.default])
    ) as unknown as VTSettings;
}

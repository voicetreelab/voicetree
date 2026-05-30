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

/** One choice in a dropdown-rendered setting (see `options` in the schema). */
export interface SelectOption {
    readonly value: string;
    readonly label: string;
}

/**
 * Schema entry for a single setting. Every VTSettings key must have one.
 * - `default`: value used in DEFAULT_SETTINGS. Omit for optional settings with no default.
 * - `section`: UI tab. Omit = 'advanced'. Ignored when `hidden` is true.
 * - `hidden`: true = not shown in settings UI.
 * - `label`: human-readable label. Auto-generated from key if omitted.
 * - `number`: constraints for number fields (min/max/step/slider).
 * - `options`: choices for a dropdown-rendered setting.
 */
export type SettingsSchema = {
    readonly [K in keyof Required<VTSettings>]: {
        readonly default?: Required<VTSettings>[K];
        readonly section?: Section;
        readonly hidden?: true;
        readonly label?: string;
        readonly number?: NumberFieldConfig;
        readonly options?: readonly SelectOption[];
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
    terminalScrollStrategy:    { default: 'app', section: 'general', label: 'Terminal Scroll Strategy', options: [
        { value: 'app',       label: 'App scroll (recommended) — wheel drives the TUI app itself' },
        { value: 'sgr',       label: 'SGR inject — renderer sends wheel events to the app' },
        { value: 'suppress',  label: 'Suppress — no wheel in TUIs (stops shell-history scroll)' },
        { value: 'copy-mode', label: 'tmux copy-mode (legacy) — current behaviour' },
    ] },
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
            // AGENT_PROMPT_CORE / AGENT_PROMPT_LIGHTWEIGHT now live as .md files in
            // packages/systems/voicetree-cli/prompts/ (single source of truth, symlinked
            // into each project's .voicetree/prompts/). buildTerminalEnvVars reads them
            // from there at spawn; AGENT_PROMPT points at the resolved core template.
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

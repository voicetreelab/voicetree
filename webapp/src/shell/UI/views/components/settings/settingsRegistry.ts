import type { VTSettings, AgentConfig, HotkeySettings, HookSettings, EnvVarValue } from '@/pure/settings/types';

/**
 * Field type definitions for the settings registry.
 * Each field type has a corresponding React component in fields/.
 */
export type FieldType =
    | 'toggle'      // Boolean switch
    | 'number'      // Numeric input (with optional slider)
    | 'text'        // Single-line text
    | 'textarea'    // Multi-line text
    | 'select'      // Dropdown selection
    | 'hotkey-group'      // Group of hotkey bindings
    | 'agent-list'        // List of agent configurations
    | 'string-list'       // Array of strings
    | 'key-value'         // Record<string, string>
    | 'hook-group'        // Group of hook commands
    | 'json';             // Raw JSON textarea (for complex objects)

/**
 * Number field configuration for slider/spinner constraints.
 */
export interface NumberFieldConfig {
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly slider?: boolean;
}

/**
 * Select option for dropdown fields.
 */
export interface SelectOption {
    readonly value: string;
    readonly label: string;
}

/**
 * Metadata for a single settings field.
 * This is the single source of truth for how a setting is displayed and edited.
 */
export interface FieldMetadata {
    /** Unique key in VTSettings */
    readonly key: keyof VTSettings;
    /** Human-readable label */
    readonly label: string;
    /** Optional description shown below the label */
    readonly description?: string;
    /** Which tab this field belongs to */
    readonly section: Section;
    /** How to render/edit this field */
    readonly type: FieldType;
    /** For number fields: constraints and slider config */
    readonly numberConfig?: NumberFieldConfig;
    /** For select fields: available options */
    readonly options?: readonly SelectOption[];
    /** Placeholder text for text/textarea fields */
    readonly placeholder?: string;
    /** Whether this field should be hidden from the UI (internal/debug) */
    readonly hidden?: boolean;
}

/**
 * Settings sections (tabs).
 */
export type Section = 'general' | 'shortcuts' | 'agents' | 'hooks' | 'advanced';

/**
 * Section metadata for tab rendering.
 */
export interface SectionMetadata {
    readonly id: Section;
    readonly label: string;
    readonly description?: string;
}

/**
 * Tab definitions in order.
 */
export const SECTIONS: readonly SectionMetadata[] = [
    { id: 'general', label: 'General', description: 'Core app preferences' },
    { id: 'shortcuts', label: 'Shortcuts', description: 'Keyboard shortcuts' },
    { id: 'agents', label: 'Agents', description: 'AI agent configurations' },
    { id: 'hooks', label: 'Hooks', description: 'Event-triggered scripts' },
    { id: 'advanced', label: 'Advanced', description: 'Advanced settings and JSON' },
] as const;

/**
 * Number field configurations keyed by settings key.
 */
export const NUMBER_FIELD_CONFIG: Readonly<Record<string, NumberFieldConfig>> = {
    zoomSensitivity: { min: 0.1, max: 5.0, step: 0.1, slider: true },
    contextNodeMaxDistance: { min: 1, max: 20, step: 1 },
    askModeContextDistance: { min: 1, max: 20, step: 1 },
    nodeLineLimit: { min: 10, max: 500, step: 10 },
};

/**
 * Human-readable labels for hotkey binding keys.
 */
export const HOTKEY_LABELS: Readonly<Record<string, string>> = {
    fitToLastNode: 'Fit to Last Node',
    nextTerminal: 'Next Terminal',
    prevTerminal: 'Previous Terminal',
    createNewNode: 'Create New Node',
    runTerminal: 'Run Terminal',
    deleteSelectedNodes: 'Delete Selected',
    closeWindow: 'Close Window',
    openSettings: 'Open Settings',
    openSearch: 'Search',
    openSearchAlt: 'Search (Alt)',
    recentNode1: 'Recent Node 1',
    recentNode2: 'Recent Node 2',
    recentNode3: 'Recent Node 3',
    recentNode4: 'Recent Node 4',
    recentNode5: 'Recent Node 5',
    voiceRecording: 'Voice Recording',
};

/**
 * Human-readable labels and descriptions for hook keys.
 */
export const HOOK_LABELS: Readonly<Record<string, { readonly label: string; readonly description: string }>> = {
    onWorktreeCreatedBlocking: {
        label: 'On Worktree Created (Blocking)',
        description: 'Shell command run after git worktree add. Blocks terminal spawn. Receives worktree path as $1, name as $2.',
    },
    postWorktreeCreatedAsync: {
        label: 'Post Worktree Created (Async)',
        description: 'Shell command run after git worktree add. Fire-and-forget. Receives worktree path as $1, name as $2.',
    },
    onNewNode: {
        label: 'On New Node',
        description: 'Shell command run after a new node is created. Receives node path as $1.',
    },
};

/**
 * The settings registry - single source of truth for all settings fields.
 *
 * Design principles:
 * 1. All fields are explicitly defined here (no runtime inference)
 * 2. Type safety: key must exist in VTSettings
 * 3. Non-destructive: unknown keys in user settings are preserved
 * 4. Extensible: add new fields here and they appear in the UI
 *
 * When adding a new setting:
 * 1. Add to VTSettings in types.ts
 * 2. Add default in DEFAULT_SETTINGS.ts
 * 3. Add FieldMetadata here
 */
export const SETTINGS_REGISTRY: Readonly<Record<string, FieldMetadata>> = {
    // General section
    darkMode: {
        key: 'darkMode',
        label: 'Dark Mode',
        description: 'Use dark color theme',
        section: 'general',
        type: 'toggle',
    },
    vimMode: {
        key: 'vimMode',
        label: 'Vim Mode',
        description: 'Enable Vim keybindings in markdown editors',
        section: 'general',
        type: 'toggle',
    },
    shiftEnterSendsOptionEnter: {
        key: 'shiftEnterSendsOptionEnter',
        label: 'Shift+Enter → Option+Enter',
        description: 'Convert Shift+Enter to Option+Enter in terminals',
        section: 'general',
        type: 'toggle',
    },
    autoNotifyUnseenNodes: {
        key: 'autoNotifyUnseenNodes',
        label: 'Auto-notify Unseen Nodes',
        description: 'Automatically notify idle agents about nearby nodes',
        section: 'general',
        type: 'toggle',
    },
    zoomSensitivity: {
        key: 'zoomSensitivity',
        label: 'Zoom Sensitivity',
        description: 'Scroll wheel zoom sensitivity (0.1 = slow, 3.0 = fast)',
        section: 'general',
        type: 'number',
        numberConfig: NUMBER_FIELD_CONFIG.zoomSensitivity,
    },
    terminalSpawnPathRelativeToWatchedDirectory: {
        key: 'terminalSpawnPathRelativeToWatchedDirectory',
        label: 'Terminal Spawn Path',
        description: 'Default path for new terminals (relative to project root)',
        section: 'general',
        type: 'text',
        placeholder: '/',
    },
    shell: {
        key: 'shell',
        label: 'Shell Override',
        description: 'Override the default shell (leave empty for auto-detect)',
        section: 'general',
        type: 'text',
        placeholder: 'e.g., /bin/zsh, pwsh',
    },
    emptyFolderTemplate: {
        key: 'emptyFolderTemplate',
        label: 'Empty Folder Template',
        description: 'Template for new starter nodes. Supports {{DATE}} placeholder.',
        section: 'general',
        type: 'textarea',
    },

    // Shortcuts section
    hotkeys: {
        key: 'hotkeys',
        label: 'Keyboard Shortcuts',
        section: 'shortcuts',
        type: 'hotkey-group',
    },

    // Agents section
    agents: {
        key: 'agents',
        label: 'AI Agents',
        description: 'Configure AI agent commands and names',
        section: 'agents',
        type: 'agent-list',
    },
    INJECT_ENV_VARS: {
        key: 'INJECT_ENV_VARS',
        label: 'Environment Variables',
        description: 'Environment variables injected into agent terminals',
        section: 'agents',
        type: 'key-value',
    },

    // Hooks section
    hooks: {
        key: 'hooks',
        label: 'Hook Scripts',
        description: 'Shell commands triggered by app events',
        section: 'hooks',
        type: 'hook-group',
    },

    // Advanced section
    contextNodeMaxDistance: {
        key: 'contextNodeMaxDistance',
        label: 'Context Node Max Distance',
        description: 'Maximum traversal distance when creating context nodes',
        section: 'advanced',
        type: 'number',
        numberConfig: NUMBER_FIELD_CONFIG.contextNodeMaxDistance,
    },
    askModeContextDistance: {
        key: 'askModeContextDistance',
        label: 'Ask Mode Context Distance',
        description: 'Max distance for context nodes in Ask mode',
        section: 'advanced',
        type: 'number',
        numberConfig: NUMBER_FIELD_CONFIG.askModeContextDistance,
    },
    defaultAllowlistPatterns: {
        key: 'defaultAllowlistPatterns',
        label: 'Default Allowlist Patterns',
        description: 'Folder patterns auto-allowlisted for all projects',
        section: 'advanced',
        type: 'string-list',
    },
    starredFolders: {
        key: 'starredFolders',
        label: 'Starred Folders',
        description: 'Quick-access folder paths across all projects',
        section: 'advanced',
        type: 'string-list',
    },
    nodeLineLimit: {
        key: 'nodeLineLimit',
        label: 'Node Line Limit',
        description: 'Maximum non-exempt lines per progress node',
        section: 'advanced',
        type: 'number',
        numberConfig: NUMBER_FIELD_CONFIG.nodeLineLimit,
    },
    showFps: {
        key: 'showFps',
        label: 'Show FPS (WebGL)',
        description: 'Display FPS counter overlay (requires restart)',
        section: 'advanced',
        type: 'toggle',
    },
    layoutConfig: {
        key: 'layoutConfig',
        label: 'Layout Config',
        description: 'JSON configuration for graph layout engine (cola)',
        section: 'advanced',
        type: 'textarea',
        placeholder: '{ "engine": "cola", "nodeSpacing": 120, ... }',
    },

    // Hidden/internal fields (not shown in UI)
    agentPermissionModeChosen: {
        key: 'agentPermissionModeChosen',
        label: 'Agent Permission Mode Chosen',
        section: 'general',
        type: 'toggle',
        hidden: true,
    },
    feedbackDialogShown: {
        key: 'feedbackDialogShown',
        label: 'Feedback Dialog Shown',
        section: 'general',
        type: 'toggle',
        hidden: true,
    },
    userEmail: {
        key: 'userEmail',
        label: 'User Email',
        section: 'general',
        type: 'text',
        hidden: true,
    },
} as const;

/**
 * Get all field keys for a given section.
 */
export function getSectionFields(section: Section): readonly FieldMetadata[] {
    return Object.values(SETTINGS_REGISTRY).filter(
        field => field.section === section && !field.hidden
    );
}

/**
 * Get field metadata by key.
 */
export function getFieldMetadata(key: keyof VTSettings): FieldMetadata | undefined {
    return SETTINGS_REGISTRY[key as string];
}

/**
 * Check if a key is a known setting (exists in registry).
 */
export function isKnownSetting(key: string): key is keyof VTSettings {
    return key in SETTINGS_REGISTRY;
}

/**
 * Get all known setting keys.
 */
export function getKnownSettingKeys(): readonly string[] {
    return Object.keys(SETTINGS_REGISTRY);
}

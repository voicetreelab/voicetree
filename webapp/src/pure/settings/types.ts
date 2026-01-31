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

// Round-robin agent name selection (no collisions until all 60 names used)
const agentNameState: { readonly index: number } = { index: -1 };

export function getNextAgentName(): string {
    agentNameState.index = (agentNameState.index + 1) % AGENT_NAMES.length;
    return AGENT_NAMES[agentNameState.index];
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
    readonly voiceRecording: HotkeyBinding; // Option+R toggle voice recording
}

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
    /**
     * Relative folder patterns auto-allowlisted for all projects (e.g., ["openspec"]).
     * These resolve relative to each project's projectRootWatchedDirectory.
     */
    readonly defaultAllowlistPatterns?: readonly string[];
    /** Whether the feedback dialog has been shown (persisted to avoid showing again) */
    readonly feedbackDialogShown?: boolean;
    /** Dark mode preference */
    readonly darkMode?: boolean;
}

/**
 * Per-folder vault configuration for multi-vault support.
 *
 * writePath: The main vault (read + write). Can be relative to projectRootWatchedDirectory or absolute.
 * readPaths: Additional directories that are fully loaded (all files visible immediately).
 */
export interface VaultConfig {
    /** Main vault path where new nodes are created. Can be relative or absolute. */
    readonly writePath: string;
    /** Additional paths to fully load - all files are visible immediately */
    readonly readPaths: readonly string[];
}

/**
 * Per-project configuration stored in voicetree-config.json.
 */
export interface VoiceTreeConfig {
    readonly lastDirectory?: string;
    /** Per-folder vault configuration for multi-vault support */
    readonly vaultConfig?: { readonly [folderPath: string]: VaultConfig };
}


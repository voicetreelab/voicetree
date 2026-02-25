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
// eslint-disable-next-line functional/prefer-readonly-type -- intentionally mutable counter
const agentNameState: { index: number } = { index: -1 };

export function getNextAgentName(): string {
    agentNameState.index = (agentNameState.index + 1) % AGENT_NAMES.length;
    return AGENT_NAMES[agentNameState.index];
}

/**
 * Get a unique agent name by appending _1 recursively until no collision.
 * Example: Sam → Sam_1 → Sam_1_1 → Sam_1_1_1
 */
export function getUniqueAgentName(baseName: string, existingNames: ReadonlySet<string>): string {
    if (!existingNames.has(baseName)) {
        return baseName;
    }
    return getUniqueAgentName(`${baseName}_1`, existingNames);
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

export interface HookSettings {
    /** Shell command run after git worktree add — blocking, awaited before terminal spawn (e.g. CDP config). Receives worktree path as $1, worktree name as $2 */
    readonly onWorktreeCreatedBlocking?: string;
    /** Shell command run after git worktree add — fire-and-forget, does not block terminal spawn (e.g. npm install). Receives worktree path as $1, worktree name as $2 */
    readonly postWorktreeCreatedAsync?: string;
    /** Shell command run after a new node is created (receives node path as $1) */
    readonly onNewNode?: string;
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
    /** When true, skip auto-creating a starter note when opening an empty folder */
    readonly disableStarterNodes?: boolean;
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
    /** Whether to automatically notify idle agents about unseen nearby nodes (default: false).
     * When false, users can manually inject context via the InjectBar instead. */
    readonly autoNotifyUnseenNodes?: boolean;
    /** Dark mode preference */
    readonly darkMode?: boolean;
    /** Scroll wheel zoom sensitivity (0.1 = very slow, 1.0 = default, 3.0 = very fast) */
    readonly zoomSensitivity?: number;
    /** Maximum non-exempt lines per progress node (default: 70). Keeps nodes atomic. */
    readonly nodeLineLimit?: number;
    /** Starred folder paths that appear as quick-load recommendations across all projects */
    readonly starredFolders?: readonly string[];
    /** Hook scripts triggered by app events (e.g., worktree creation) */
    readonly hooks?: HookSettings;
    /** Override the shell used for terminals. Leave unset for auto-detect ($SHELL on macOS/Linux, pwsh/powershell on Windows). */
    readonly shell?: string;
    /** Show FPS counter overlay on the Cytoscape WebGL renderer (top-left). Requires app restart. */
    readonly showFps?: boolean;
    /** Layout engine configuration as JSON. Supports 'cola' engine. Edit in Advanced settings. */
    readonly layoutConfig?: string;
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


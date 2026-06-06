export interface AgentConfig {
    readonly name: string;
    /**
     * Command to launch this agent. Omitted on pure category/folder nodes (which
     * only group `children` and are never spawned directly). A leaf inherits the
     * nearest ancestor's command unless it defines its own. See `agentTree.ts`.
     */
    readonly command?: string;
    /**
     * Extra environment variables this node contributes. Merged down the
     * root→leaf path (deeper wins) and delivered to the spawned process via the
     * spawn RPC's `envOverrides` channel — this is how a child "just adds a
     * parameter" (e.g. `{ EFFORT: "xhigh" }`) without re-spelling the command.
     */
    readonly env?: Readonly<Record<string, string>>;
    /**
     * Child agents. Present => this node is a category (renders as a hover
     * submenu, not spawnable). Absent/empty => this node is a spawnable leaf.
     */
    readonly children?: readonly AgentConfig[];
}

export const AGENT_NAMES: readonly string[] = [
    'Aki', 'Ama', 'Amit', 'Amy', 'Anna', 'Ari', 'Ayu', 'Ben', 'Bob', 'Cho',
    'Dae', 'Dan', 'Eli', 'Emi', 'Eva', 'Eve', 'Fei', 'Gia', 'Gus', 'Hana',
    'Ian', 'Iris', 'Ivan', 'Ivy', 'Jay', 'Jin', 'John', 'Jose', 'Juan', 'Jun',
    'Kai', 'Kate', 'Leo', 'Lou', 'Luis', 'Mary', 'Max', 'Meg', 'Mei', 'Mia',
    'Nia', 'Noa', 'Omar', 'Otto', 'Raj', 'Ren', 'Rex', 'Rio', 'Sai', 'Sam',
    'Siti', 'Tao', 'Tara', 'Timi', 'Uma', 'Vic', 'Wei', 'Xan', 'Yan', 'Zoe',
] as const;

// Round-robin agent name selection. The counter rotates over whichever pool is
// passed (neutral AGENT_NAMES or the Silicon Valley roster); the base name it
// yields is only the human-friendly half of an id — `getUniqueAgentName` adds the
// hash that actually makes the id unique.
// eslint-disable-next-line functional/prefer-readonly-type -- intentionally mutable counter
const agentNameState: { index: number } = { index: -1 };

export function getNextAgentName(names: readonly string[] = AGENT_NAMES): string {
    agentNameState.index = (agentNameState.index + 1) % names.length;
    return names[agentNameState.index];
}

/**
 * Agent ids are `<BaseName><AGENT_ID_SEPARATOR><hash>` — a friendly round-robin
 * base name plus a short random alphanumeric hash. The hash is what makes an id
 * unique. Base names come from a tiny pool, drawn round-robin and freed when an
 * agent exits, so without the hash a base name reused later would collide with a
 * past agent that the graph still references by id. Three chars over a 36-symbol
 * alphabet give 46,656 ids per base name; `getUniqueAgentName` still checks the
 * candidate against live ids and regenerates on the rare clash, so collisions
 * among concurrent agents are impossible and temporal ones astronomically
 * unlikely. The hash is stripped for display — see `agentBaseName`.
 */
export const AGENT_ID_SEPARATOR = '-';
export const AGENT_ID_HASH_LENGTH = 3;
export const AGENT_ID_HASH_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Compose an agent id from its base name and uniqueness hash. */
export function formatAgentId(baseName: string, hash: string): string {
    return `${baseName}${AGENT_ID_SEPARATOR}${hash}`;
}

const AGENT_ID_HASH_SUFFIX_RE: RegExp =
    new RegExp(`${AGENT_ID_SEPARATOR}[a-z0-9]{${AGENT_ID_HASH_LENGTH}}$`);

/**
 * Recover the human-friendly base name from an agent id by stripping the
 * uniqueness hash: `Ayu-k3f` → `Ayu`. Base names never contain the separator, so
 * the suffix is unambiguous; an id with no hash suffix is returned unchanged.
 */
export function agentBaseName(agentId: string): string {
    return agentId.replace(AGENT_ID_HASH_SUFFIX_RE, '');
}

/**
 * Build a unique agent id by appending a hash to the base name,
 * regenerating on the rare chance the candidate collides with a live id.
 * `generateHash` is injectable so callers and tests can supply any source.
 * For production use with a random source, use `uniqueAgentName` from `../../settings`.
 */
export function getUniqueAgentName(
    baseName: string,
    existingNames: ReadonlySet<string>,
    generateHash: () => string,
): string {
    const candidate: string = formatAgentId(baseName, generateHash());
    return existingNames.has(candidate)
        ? getUniqueAgentName(baseName, existingNames, generateHash)
        : candidate;
}

export type EnvVarValue = string | readonly string[];

/** Mouse-wheel scroll strategy for agent terminals. See `terminalScrollStrategy` in VTSettings. */
export type TerminalScrollStrategy = 'app' | 'sgr' | 'suppress' | 'copy-mode';

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

/**
 * Default subgraph-gardening thresholds. Shared by the settings schema (defaults),
 * the create_graph context fallback, and tests so there is a single source of truth.
 */
export const DEFAULT_SUBGRAPH_WARN_THRESHOLD: number = 4;
export const DEFAULT_SUBGRAPH_ERROR_THRESHOLD: number = 6;

/**
 * Default fan-out cap for the create_graph `child_count_limit` gate. A node with
 * more than this many children reads as an unstructured star rather than a tree,
 * so create_graph blocks (overridable) until the agent nests the children.
 */
export const DEFAULT_MAX_CHILDREN_PER_NODE: number = 4;

/**
 * Default per-folder direct-member cap for the create_graph `folder_child_count_limit`
 * gate. A DIFFERENT axis from `maxChildrenPerNode` (which caps a single parent's
 * incoming edges): this counts the direct filesystem members of the destination
 * folder (excluding its identity note and context nodes). Once a folder holds more
 * than this many nodes it is hard to navigate, so create_graph blocks (overridable)
 * and offers a gardening split. Slightly higher than the subgraph error threshold
 * because flat membership tolerates more than a connected component.
 */
export const DEFAULT_MAX_FOLDER_CHILDREN: number = 7;

/**
 * Default thresholds for the create_graph `graph_complexity_limit` gate, applied
 * to the L∞ complexity score (see graphComplexity.ts) of the destination-folder
 * component after the batch lands. `warn` surfaces a non-blocking nudge; `block`
 * (≈ the 'heavy' rating boundary of 1.0) blocks creation, overridable with a
 * rationale.
 */
export const DEFAULT_COMPLEXITY_WARN_SCORE: number = 0.7;
export const DEFAULT_COMPLEXITY_BLOCK_SCORE: number = 1.0;

/**
 * The five create_graph subgraph-gardening defaults as one cohesive record, so a
 * consumer that needs the whole set (e.g. the create_graph context-config
 * fallback) imports a single deep constant instead of five loose ones. The
 * individual constants remain exported for the settings schema and tests that
 * reference one threshold at a time.
 */
export const DEFAULT_SUBGRAPH_LIMITS = {
    subgraphWarnThreshold: DEFAULT_SUBGRAPH_WARN_THRESHOLD,
    subgraphErrorThreshold: DEFAULT_SUBGRAPH_ERROR_THRESHOLD,
    maxChildrenPerNode: DEFAULT_MAX_CHILDREN_PER_NODE,
    maxFolderChildren: DEFAULT_MAX_FOLDER_CHILDREN,
    complexityWarnScore: DEFAULT_COMPLEXITY_WARN_SCORE,
    complexityBlockScore: DEFAULT_COMPLEXITY_BLOCK_SCORE,
} as const;

export interface VTSettings {
    readonly terminalSpawnPathRelativeToWatchedDirectory: string;
    readonly agents: readonly AgentConfig[];
    readonly shiftEnterSendsOptionEnter: boolean;
    readonly INJECT_ENV_VARS: Record<string, EnvVarValue>;
    /** Maximum traversal distance when creating context nodes */
    readonly contextNodeMaxDistance: number;
    /** Whether context node creation augments graph-distance context with semantic vector search. */
    readonly enableSemanticContext?: boolean;
    /** Maximum total characters in context node content section (default: 30000 ≈ 7.5k tokens). Nodes are ranked by relevance and truncated to fit within budget. */
    readonly contextMaxChars: number;
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
    /** Silicon Valley mode: name agents after Silicon Valley characters and inject a matching persona into their prompt. Off by default — the user opts in. */
    readonly siliconValleyMode?: boolean;
    /** Custom hotkey bindings - falls back to DEFAULT_HOTKEYS if not set */
    readonly hotkeys?: HotkeySettings;
    /**
     * Relative folder patterns auto-allowlisted for all projects (e.g., ["openspec"]).
     * These resolve relative to each project's projectRoot.
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
    /** Maximum non-exempt lines per progress node (default: 80). Keeps nodes atomic. */
    readonly nodeLineLimit?: number;
    /**
     * Subgraph-gardening warn threshold: when a folder-bounded component reaches
     * this many nodes, create_graph returns a non-blocking warning (default: 4).
     */
    readonly subgraphWarnThreshold?: number;
    /**
     * Subgraph-gardening error threshold: when a folder-bounded component reaches
     * this many nodes, create_graph blocks (overridable with a rationale) so the
     * agent splits the cluster into a sub-folder or justifies the exception (default: 6).
     */
    readonly subgraphErrorThreshold?: number;
    /**
     * Max children a single node may have before create_graph blocks (overridable
     * with a rationale). Keeps the graph a navigable tree instead of a wide star
     * (default: 4).
     */
    readonly maxChildrenPerNode?: number;
    /**
     * Max direct members a single folder may hold before create_graph blocks
     * (overridable with a rationale). A DIFFERENT axis from `maxChildrenPerNode`:
     * this counts filesystem members of the destination folder (excluding its
     * identity note and context nodes), not a single parent's incoming edges
     * (default: 7).
     */
    readonly maxFolderChildren?: number;
    /**
     * Graph-complexity warn score: when the destination-folder component's L∞
     * complexity score reaches this, create_graph returns a non-blocking warning
     * (default: 0.7).
     */
    readonly complexityWarnScore?: number;
    /**
     * Graph-complexity block score: when the destination-folder component's L∞
     * complexity score reaches this, create_graph blocks (overridable with a
     * rationale) so the agent restructures the cluster (default: 1.0, the 'heavy'
     * rating boundary).
     */
    readonly complexityBlockScore?: number;
    /** Starred folder paths that appear as quick-load recommendations across all projects */
    readonly starredFolders?: readonly string[];
    /** Hook scripts triggered by app events (e.g., worktree creation) */
    readonly hooks?: HookSettings;
    /** Override the shell used for terminals. Leave unset for auto-detect ($SHELL on macOS/Linux, pwsh/powershell on Windows). */
    readonly shell?: string;
    /** Enable tmux mouse handling in Voicetree terminals. Off by default so browser text selection works normally. */
    readonly terminalTmuxMouseMode?: boolean;
    /**
     * How the mouse wheel scrolls an agent terminal (the alt-screen / TUI case).
     * - 'app'       : if the foreground app tracks the mouse, let xterm forward the wheel so the app scrolls its own view; otherwise tmux copy-mode. (recommended)
     * - 'sgr'       : if the app tracks the mouse, the renderer injects SGR wheel events into the PTY directly; otherwise tmux copy-mode.
     * - 'suppress'  : do nothing on the alt-screen (kills wheel-scrolls-into-shell-history; scroll the app with its own keys).
     * - 'copy-mode' : always drive tmux copy-mode (the legacy behaviour — for A/B comparison).
     */
    readonly terminalScrollStrategy?: TerminalScrollStrategy;
    /** Name of the default agent (matched against agents[].name). Falls back to first agent if unset or not found. */
    readonly defaultAgent?: string;
    /** Notify via OS notification when an agent completes or errors (only when app is unfocused) */
    readonly notifyOnAgentCompletion?: boolean;
    /** Show FPS counter overlay on the Cytoscape WebGL renderer (top-left). Requires app restart. */
    readonly showFps?: boolean;
    /** Layout engine configuration as JSON. Supports 'cola' engine. Edit in Advanced settings. */
    readonly layoutConfig?: string;
}

/**
 * Per-folder project configuration for multi-project support.
 *
 * writeFolderPath: The main project (read + write). Can be relative to projectRoot or absolute.
 */
export interface ProjectConfig {
    /** Main project path where new nodes are created. Can be relative or absolute. */
    readonly writeFolderPath: string;
    /** Compatibility read paths for older app builds; current active-view state is authoritative. */
    readonly readPaths?: readonly string[];
}

/**
 * Per-project configuration stored in voicetree-config.json.
 */
export interface VoiceTreeConfig {
    readonly lastDirectory?: string;
    /** Per-folder project configuration for multi-project support */
    readonly projectConfig?: { readonly [folderPath: string]: ProjectConfig };
}

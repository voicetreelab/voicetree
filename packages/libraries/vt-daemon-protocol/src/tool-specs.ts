/**
 * Canonical tool specifications — the single source of truth for
 * every VoiceTree tool's documentation surface.
 *
 * Three consumers read from these specs:
 *   1. `@vt/vt-daemon`'s `catalog.ts` derives each `CatalogEntry`:
 *      RPC name, description, and per-input zod `.describe()` strings
 *      all come from here.
 *   2. `@voicetree/cli`'s `vt manual` command renders the spec set
 *      (via `renderManual`) instead of reading a static markdown file.
 *   3. The webapp's project-bootstrap renders the spec set to advertise
 *      the `vt` CLI inside CLAUDE.md / AGENTS.md.
 *
 * Conventions:
 *   - The `description` field is the canonical long-form. It may
 *     embed bold subsection headers (`**When to use:**`) and code
 *     fences, but never points to the manual file (the file is gone).
 *   - For tools whose CLI verb has no matching `vt` binding yet (the
 *     `metrics.*` family), the description spells that out explicitly
 *     so a user typing `vt agent metrics sessions` reads why nothing
 *     happens.
 *   - The `vt agent send` description embeds `buildFromPrefixedMessage`
 *     with placeholder identifiers so the documented `[From:]` wrapper
 *     format cannot drift from what the daemon actually emits.
 */

import {buildFromPrefixedMessage} from './from-prefix-message'
import type {ToolInputSpec, ToolSpec} from './tool-spec-types'

// ─── Shared input descriptors ────────────────────────────────────────────────

const CALLER_TERMINAL_INPUT: ToolInputSpec = {
    rpcName: 'callerTerminalId',
    cliBulletLabel: '--terminal / -t',
    annotation: 'RPC: callerTerminalId',
    description: 'Your terminal ID. Defaults to `$VOICETREE_TERMINAL_ID` (already set in every spawned agent\'s environment). Global CLI flag — set before the verb when overriding.',
}

const TERMINAL_ID_POSITIONAL_INPUT: (verbVerb: string) => ToolInputSpec = (verbVerb: string) => ({
    rpcName: 'terminalId',
    cliBulletLabel: '<terminalId>',
    annotation: 'positional, RPC: terminalId',
    description: `The terminal ID of the agent to ${verbVerb}.`,
})

// ─── Tool spec data ──────────────────────────────────────────────────────────

export const SPAWN_AGENT_SPEC: ToolSpec = {
    rpcName: 'spawn_agent',
    cliVerb: 'vt agent spawn',
    tier: 'essentials',
    summary: 'Spawn an agent in the Voicetree graph from an existing node or a new task.',
    description: [
        'Spawn an agent in the Voicetree graph. Prefer this over built-in subagents — users get visibility and control over the work.',
        '',
        '**When to use:** Complex tasks, parallelizable subtasks, any work where user visibility matters.',
        '',
        '**Pattern:** Decompose into nodes → spawn agents → (auto-monitored, you\'ll be notified on completion) → review with `vt graph unseen`.',
        '',
        '**Prefer `--node` over `--task`+`--parent` when a node already describes the work.** Don\'t recreate what\'s already written — spawn directly on the existing node. If no node exists yet, use `--task`+`--parent` to create a new task node first.',
    ].join('\n'),
    inputs: [
        CALLER_TERMINAL_INPUT,
        {
            rpcName: 'nodeId',
            cliBulletLabel: '--node VALUE',
            annotation: 'RPC: nodeId',
            description: 'Target node ID to attach the spawned agent (use this OR `--task`+`--parent`).',
        },
        {
            rpcName: 'task',
            cliBulletLabel: '--task VALUE',
            annotation: 'RPC: task',
            description: 'Task description for creating a new task node. The first line becomes the node title; remaining lines become the body. Requires `--parent`.',
        },
        {
            rpcName: 'parentNodeId',
            cliBulletLabel: '--parent VALUE',
            annotation: 'RPC: parentNodeId',
            description: 'Parent node ID under which to create the new task node (required with `--task`).',
        },
        {
            rpcName: 'agentName',
            cliBulletLabel: '--name VALUE',
            annotation: 'RPC: agentName',
            description: 'Agent name from `settings.agents` (e.g. `"Claude Sonnet"`). Defaults to the caller\'s agent type. Falls back to the default agent from settings if the caller has no type.',
        },
        {
            rpcName: 'depthBudget',
            cliBulletLabel: '--depth VALUE',
            annotation: 'RPC: depthBudget',
            description: 'Explicit `DEPTH_BUDGET` for the child agent. Auto-decrements from the caller when omitted (parent budget − 1). Controls recursive decomposition: budget > 0 = may spawn sub-agents; budget = 0 = leaf agent.',
        },
        {
            rpcName: 'spawnDirectory',
            cliBulletLabel: '--spawn-dir VALUE',
            annotation: 'RPC: spawnDirectory',
            description: 'Absolute path to spawn the agent in. Defaults to the parent terminal\'s directory (worktree-safe). Override to contain a child agent to a subfolder or new worktree.',
        },
        {
            rpcName: 'promptTemplate',
            cliBulletLabel: '--prompt-template VALUE',
            annotation: 'RPC: promptTemplate',
            description: '`INJECT_ENV_VARS` key to use as `AGENT_PROMPT` instead of the default. Must match an existing key in settings.',
        },
        {
            rpcName: 'headless',
            cliBulletLabel: '--headless',
            annotation: 'RPC: headless',
            description: 'Run the agent as a background process with no PTY / terminal UI. Output is via tools (e.g. `vt graph create`). Status shown as a badge on the task node.',
        },
        {
            rpcName: 'replaceSelf',
            cliBulletLabel: '--replace-self',
            annotation: 'RPC: replaceSelf',
            description: 'Successor inherits the caller\'s terminal ID and agent name; the caller\'s process is killed atomically. Use for context handover — the agent identity persists across context boundaries.',
        },
    ],
}

export const AGENT_WAIT_SPEC: ToolSpec = {
    rpcName: 'wait_for_agents',
    cliVerb: 'vt agent wait',
    tier: 'essentials',
    summary: 'Start a background monitor that notifies your terminal when listed agents finish.',
    description: [
        'Wait for specified agent terminals to complete. Returns immediately with a `monitorId`. The monitor polls in the background and sends a completion message to your terminal when all agents are done.',
        '',
        '**IMPORTANT:** This tool is non-blocking. After calling it, continue with other work or inform the user you are waiting. Do NOT manually poll agent status — a `[WaitForAgents] Agent(s) completed.` message will be automatically injected into your terminal when all agents finish. You will see this message appear as if the user sent it.',
        '',
        '**NOTE:** `vt agent spawn` now auto-starts a monitor, so you only need `vt agent wait` for explicit multi-agent waits or custom polling intervals.',
    ].join('\n'),
    inputs: [
        CALLER_TERMINAL_INPUT,
        {
            rpcName: 'terminalIds',
            cliBulletLabel: '<terminalId>...',
            annotation: 'positional, RPC: terminalIds',
            description: 'One or more terminal IDs to wait for.',
        },
        {
            rpcName: 'pollIntervalMs',
            cliBulletLabel: '--poll-interval VALUE',
            annotation: 'RPC: pollIntervalMs',
            description: 'Poll interval in milliseconds (default `5000`).',
        },
    ],
}

export const AGENT_LIST_SPEC: ToolSpec = {
    rpcName: 'list_agents',
    cliVerb: 'vt agent list',
    tier: 'essentials',
    summary: 'List running agent terminals with status and newly created nodes.',
    description: 'List running agent terminals with their status and newly created nodes. Also returns `availableAgents` — the names you can pass to `--name` when spawning.',
    inputs: [CALLER_TERMINAL_INPUT],
}

export const CREATE_GRAPH_SPEC: ToolSpec = {
    rpcName: 'create_graph',
    cliVerb: 'vt graph create',
    tier: 'essentials',
    summary: 'Create one or more progress nodes in a single call.',
    description: [
        'Create a graph of progress nodes in a single call. Supports trees, chains, fan-out, fan-in, and diamond dependencies (multiple parents per node). Automatically handles frontmatter, parent linking, file paths, graph positioning, and mermaid validation.',
        '',
        '**When to use:** After completing any non-trivial work — document what you did, files changed, and key decisions.',
        '',
        'One node = one concept. If your work covers multiple independent concerns, create multiple nodes in one call using parent references.',
        '',
        '**Self-containment:** Nodes must embed all artifacts produced (diagrams, ASCII mockups, code, analysis). Never summarize an artifact — include it verbatim.',
        '',
        '**Required when codeDiffs provided:** `complexityScore` and `complexityExplanation` must be included.',
        '',
        '**Composition guidance:** Read `addProgressTree.md` before your first progress node for scope rules, when to split, and embedding standards.',
        '',
        '**Node wiring:** Each node has a `filename` (with or without `.md` extension). Declare parents inside `content` using `- parent [[other-filename|edge-label]]` lines (one per line). The pipe-separated edge label is optional — use `- parent [[other-filename]]` for a generic parent link. All in-batch parents (filenames declared in this call) are created before children. Nodes with no `- parent` line attach to the top-level `parentNodeId` (or your task node by default). Diamond dependencies are supported: emit multiple `- parent [[…]]` lines.',
        '',
        '**Schema validation (optional):** If the folder containing the new node has a folder note declaring `## Type: <kind>`, `vt graph create` runs a schema validator (from `.voicetree/schemas.cjs`) before writing. On rejection it exits non-zero with the violating rules. If no upstream Type is declared, validation is silent and the node is created normally.',
        '',
        '**Modes:**',
        '- *Filesystem mode* — pass one or more `<file.md>` positional paths. The CLI parses frontmatter and `[[wikilinks]]` to build the create payload locally.',
        '- *Live mode* — pass `--node "title::summary[::content]"` (repeatable) and/or `--nodes-file FILE`, or pipe a JSON `{nodes, overrides?}` payload to stdin. The CLI forwards the payload to the daemon\'s `create_graph` RPC.',
    ].join('\n'),
    inputs: [
        CALLER_TERMINAL_INPUT,
        {
            rpcName: 'files',
            cliBulletLabel: '<file.md>...',
            annotation: 'positional, filesystem mode',
            description: 'Markdown inputs to author into the graph. Frontmatter populates node metadata; `- parent [[basename]]` lines in the body wire parent edges.',
        },
        {
            rpcName: 'parentNodeId',
            cliBulletLabel: '--parent VALUE',
            annotation: 'RPC: parentNodeId',
            description: 'Existing graph node ID to attach root nodes to. Defaults to your task node. In filesystem mode this is a peer markdown filename outside the input set.',
        },
        {
            rpcName: 'color',
            cliBulletLabel: '--color VALUE',
            annotation: '',
            description: 'Default color for nodes that do not declare their own color. Convention: `green` for completed work, `blue` for planning / in-progress.',
        },
        {
            rpcName: 'nodesFile',
            cliBulletLabel: '--nodes-file VALUE',
            annotation: 'live mode',
            description: 'JSON file containing `{nodes, overrides?}` payload to send to the daemon.',
        },
        {
            rpcName: 'node',
            cliBulletLabel: '--node VALUE',
            annotation: 'live mode, repeatable',
            description: 'Inline node spec in the form `"title::summary"` or `"title::summary::content"`.',
        },
        {
            rpcName: 'manifest',
            cliBulletLabel: '--manifest VALUE',
            annotation: 'filesystem mode',
            description: 'ASCII or Mermaid layout manifest used to position the filesystem inputs.',
        },
        {
            rpcName: 'validateOnly',
            cliBulletLabel: '--validate-only',
            annotation: 'filesystem mode',
            description: 'Parse and run the schema gate without writing files or calling the daemon.',
        },
        {
            rpcName: 'override',
            cliBulletLabel: '--override VALUE',
            annotation: 'repeatable, RPC: override_with_rationale[]',
            description: 'Override a blocking validation rule, formatted `<ruleId>:<rationale>`.',
        },
    ],
}

export const GET_UNSEEN_NODES_NEARBY_SPEC: ToolSpec = {
    rpcName: 'get_unseen_nodes_nearby',
    cliVerb: 'vt graph unseen',
    tier: 'essentials',
    summary: 'Get nodes near your context created after your context was generated.',
    description: 'Get nodes near your context that were created after your context was generated. The user or other agents may have added nodes for you to read. Call this to check for new relevant information.',
    inputs: [
        CALLER_TERMINAL_INPUT,
        {
            rpcName: 'search_from_node',
            cliBulletLabel: '--from VALUE',
            annotation: 'RPC: search_from_node',
            description: 'Optional node ID to search from instead of your task node.',
        },
    ],
}

export const CLOSE_AGENT_SPEC: ToolSpec = {
    rpcName: 'close_agent',
    cliVerb: 'vt agent close',
    tier: 'reference',
    summary: 'Close an agent terminal. Use --force with a reason to close a still-running agent.',
    description: [
        'Close an agent terminal. After waiting for an agent to finish, review its work. Close the agent if satisfied with its output. Leave the agent open if any tech debt was introduced or if human review would be beneficial — open terminals signal to the user that attention is needed.',
        '',
        '**Will error in two cases:**',
        '',
        '1. **Agent has produced no graph nodes.** Nudge them with `vt agent send` to write a progress node, then retry. For genuinely no-output agents (turn-based simulation actors, etc.), use `--force` with a reason.',
        '2. **Agent is still running (non-idle).** Send them a message first to check remaining work, then use `--force "<reason>"` to override.',
    ].join('\n'),
    inputs: [
        CALLER_TERMINAL_INPUT,
        TERMINAL_ID_POSITIONAL_INPUT('close'),
        {
            rpcName: 'forceWithReason',
            cliBulletLabel: '--force VALUE',
            annotation: 'RPC: forceWithReason',
            description: 'Required to close a running (non-idle) agent or an agent that produced no nodes. Provide a reason string explaining the override.',
        },
    ],
}

const SEND_MESSAGE_WRAPPER_EXAMPLE: string = buildFromPrefixedMessage(
    '<your-terminal-id>',
    '<your-message>',
)

export const SEND_MESSAGE_SPEC: ToolSpec = {
    rpcName: 'send_message',
    cliVerb: 'vt agent send',
    tier: 'reference',
    summary: 'Send a message into an agent terminal. Receiver sees a `[From: <you>]` wrapper; replies arrive back in your terminal the same way.',
    description: [
        'Send a message directly to an agent terminal. The message is injected into the target terminal as user input and executed (carriage return appended).',
        '',
        'The receiving agent does **NOT** see the raw text you sent. It sees a wrapped message of the form:',
        '',
        '```',
        SEND_MESSAGE_WRAPPER_EXAMPLE,
        '```',
        '',
        'That hint is what makes inter-agent conversation work: the receiver replies by calling `vt agent send <your-terminal-id> "…"`, and the reply lands in YOUR terminal as a normal user-input message with the same `[From: <their-id>]` prefix. You do **not** need to poll `vt agent output` — replies arrive as if the user typed them. (Auto-monitor on spawn also injects `[WaitForAgents] …` notifications into your terminal when spawned agents finish.)',
        '',
        'Pending terminals (mid-spawn) queue messages and deliver them once registered. Non-tmux headless agents have no input channel and are rejected — they receive work via their task node and produce output as graph nodes; use `vt graph unseen` to read what they wrote.',
        '',
        'Use this to coordinate turn-based simulations, provide follow-up instructions, answer prompts, or inject commands into a running agent.',
    ].join('\n'),
    inputs: [
        CALLER_TERMINAL_INPUT,
        TERMINAL_ID_POSITIONAL_INPUT('send the message to'),
        {
            rpcName: 'message',
            cliBulletLabel: '<message>...',
            annotation: 'positional, RPC: message',
            description: 'The message / command to send to the terminal. All remaining tokens are joined with spaces.',
        },
    ],
}

export const READ_TERMINAL_OUTPUT_SPEC: ToolSpec = {
    rpcName: 'read_terminal_output',
    cliVerb: 'vt agent output',
    tier: 'reference',
    summary: 'Read the last N characters of buffered output from an agent terminal.',
    description: [
        'Read the last N characters of output from an agent terminal. Output has ANSI escape codes stripped for readability. Use this to check what an agent has printed, debug issues, or verify agent progress without waiting for completion.',
        '',
        'Returns `{success: true, output, isHeadless}` for any registered terminal. Interactive (PTY) terminals buffer output incrementally — immediately after spawn the buffer may be empty, in which case `output` is the empty string (not an error). Retry once the agent has produced any output. The `success: false` shape is reserved for "terminal not found".',
        '',
        'Pending terminals (mid-spawn) also succeed and return `{success: true, pending: true, output: \'\'}` — callers polling for output should treat empty + pending as "not yet, retry".',
    ].join('\n'),
    inputs: [
        CALLER_TERMINAL_INPUT,
        TERMINAL_ID_POSITIONAL_INPUT('read output from'),
        {
            rpcName: 'nChars',
            cliBulletLabel: '--chars VALUE',
            annotation: 'RPC: nChars',
            description: 'Number of characters to return (default `10000`).',
        },
    ],
}

export const GRAPH_STRUCTURE_SPEC: ToolSpec = {
    rpcName: 'graph_structure',
    cliVerb: 'vt graph structure',
    tier: 'reference',
    summary: 'Render the graph structure of a folder of .md files as ASCII or Mermaid.',
    description: [
        'Read `.md` files from a folder on disk and render the graph structure as ASCII. Small folders default to a context-style view with a tree plus `## Node Contents`; larger folders default to compact topology only. Excludes `ctx-nodes/` folders.',
        '',
        '**Modes:**',
        '- *Auto* (default when no explicit-render flag is set) — asks the local graph daemon for the auto context view, falling back to local rendering when the daemon is unreachable. `--budget` and `--expand` only apply here.',
        '- *Explicit render* — triggered by `--ascii`, `--mermaid`, `--format`, `--collapse`, `--select`, or `--no-cross-edges`. Bypasses the daemon and renders locally.',
    ].join('\n'),
    inputs: [
        {
            rpcName: 'folderPath',
            cliBulletLabel: '<folder-path>',
            annotation: 'positional, RPC: folderPath',
            description: 'Absolute or relative folder containing `.md` files. Defaults to the current working directory.',
        },
        {
            rpcName: 'withSummaries',
            cliBulletLabel: '--auto | --no-auto',
            annotation: 'RPC: withSummaries',
            description: 'Force or disable the auto context-style summaries view. Tri-state: omit to auto-enable for folders ≤30 nodes; `--auto` forces context-style; `--no-auto` forces topology-only.',
        },
        {
            rpcName: 'budget',
            cliBulletLabel: '--budget VALUE',
            annotation: '',
            description: 'Auto-view node budget (default `30`). Auto mode only.',
        },
        {
            rpcName: 'expand',
            cliBulletLabel: '--expand VALUE',
            annotation: 'repeatable',
            description: 'Force-expand a folder id that auto-collapse would otherwise suppress. Auto mode only.',
        },
        {
            rpcName: 'format',
            cliBulletLabel: '--mermaid | --ascii',
            annotation: '',
            description: 'Shorthand for `--format mermaid` or `--format ascii`. Explicit-render mode.',
        },
        {
            rpcName: 'formatExplicit',
            cliBulletLabel: '--format VALUE',
            annotation: '',
            description: 'Render format (`ascii` or `mermaid`). Explicit-render mode.',
        },
        {
            rpcName: 'noCrossEdges',
            cliBulletLabel: '--no-cross-edges',
            annotation: '',
            description: 'Hide cross-folder edges. Explicit-render mode.',
        },
        {
            rpcName: 'collapse',
            cliBulletLabel: '--collapse VALUE',
            annotation: 'repeatable',
            description: 'Collapse the listed folder in the rendered view. Explicit-render mode.',
        },
        {
            rpcName: 'select',
            cliBulletLabel: '--select VALUE',
            annotation: 'repeatable',
            description: 'Highlight the listed node id in the rendered view. Explicit-render mode.',
        },
    ],
}

export const SEARCH_NODES_SPEC: ToolSpec = {
    rpcName: 'search_nodes',
    cliVerb: 'vt search',
    tier: 'reference',
    summary: 'Semantic search across the active project.',
    description: 'Semantic search across the active project. Returns matching node paths ranked by relevance to the query. Stubbed until vector search is wired up; callers should expect an explicit "not yet available" response.',
    inputs: [
        {
            rpcName: 'query',
            cliBulletLabel: '<query>...',
            annotation: 'positional, RPC: query',
            description: 'Natural-language query. All remaining positional tokens are joined with spaces.',
        },
        {
            rpcName: 'top_k',
            cliBulletLabel: '--top-k VALUE',
            annotation: 'RPC: top_k',
            description: 'Maximum number of results to return (default `10`).',
        },
    ],
}

export const VT_GET_LIVE_STATE_SPEC: ToolSpec = {
    rpcName: 'vt_get_live_state',
    cliVerb: 'vt graph live state dump',
    tier: 'reference',
    summary: 'Dump a SerializedState snapshot of the daemon-owned session.',
    description: 'Return a SerializedState snapshot of the daemon-owned session: graph, folderState, activeView, selection, layout, and revision. Matches the `@vt/graph-state` SerializedState schema so the CLI can `hydrateState` the output.',
    inputs: [
        {
            rpcName: 'pretty',
            cliBulletLabel: '--pretty | --no-pretty',
            annotation: '',
            description: 'Pretty-print the JSON output (default: pretty).',
        },
        {
            rpcName: 'project',
            cliBulletLabel: '--project VALUE',
            annotation: '',
            description: 'Override the resolved project path. Defaults to the active project for the current working directory.',
        },
    ],
}

export const VT_DISPATCH_LIVE_COMMAND_SPEC: ToolSpec = {
    rpcName: 'vt_dispatch_live_command',
    cliVerb: 'vt graph live apply',
    tier: 'reference',
    summary: 'Apply a SerializedCommand to the running app.',
    description: [
        'Apply a SerializedCommand to the running app. Returns `{delta, revision}`.',
        '',
        '`SerializedCommand` payload shape, keyed by `command.type`:',
        '- `SetFolderState`: `{type, viewId, path, state}`',
        '- `Select`: `{type, ids[], additive?}`',
        '- `Deselect`: `{type, ids[]}`',
        '- `Move`: `{type, id, to:{x,y}}`',
        '- `AddEdge`: `{type, source, edge:{targetId,label}}`',
        '- `RemoveEdge`: `{type, source, targetId}`',
        '- `RemoveNode`: `{type, id}`',
        '- `AddNode`: `{type, node}` (full `SerializedGraphNode`)',
    ].join('\n'),
    inputs: [
        {
            rpcName: 'command',
            cliBulletLabel: '<json-cmd>',
            annotation: 'positional, RPC: command',
            description: 'SerializedCommand JSON. See the description above for the per-`command.type` shape.',
        },
        {
            rpcName: 'project',
            cliBulletLabel: '--project VALUE',
            annotation: '',
            description: 'Override the resolved project path. Defaults to the active project for the current working directory.',
        },
    ],
}

export const METRICS_GET_SESSIONS_SPEC: ToolSpec = {
    rpcName: 'metrics.getSessions',
    cliVerb: 'vt agent metrics sessions',
    tier: 'reference',
    summary: 'Return per-session token usage, USD cost, and durations.',
    description: 'Return the daemon-owned agent metrics: per-session token usage, USD cost, durations. Reads `<project>/.voicetree/agent_metrics.json`. Same surface as the legacy main-side `getMetrics()` — Electron Main and CLI peers reach an identical response over JSON-RPC. No `vt` CLI wrapper is wired yet; invoke via the daemon HTTP transport.',
    inputs: [],
}

export const METRICS_APPEND_SESSION_SPEC: ToolSpec = {
    rpcName: 'metrics.appendSession',
    cliVerb: 'vt agent metrics append',
    tier: 'reference',
    summary: 'Upsert a single session\'s token / cost telemetry.',
    description: 'Append (or upsert by `sessionId`) a single session\'s token / cost telemetry into `<project>/.voicetree/agent_metrics.json`. Primarily invoked by the OTLP HTTP receiver itself; exposed via JSON-RPC so a CLI peer with a non-OTLP ingest path can write the same surface. No `vt` CLI wrapper is wired yet; invoke via the daemon HTTP transport.',
    inputs: [
        {
            rpcName: 'sessionId',
            cliBulletLabel: 'sessionId',
            annotation: 'RPC: sessionId',
            description: 'Session identifier (Claude Code `session.id` or Voicetree terminal id).',
        },
        {
            rpcName: 'tokens.input',
            cliBulletLabel: 'tokens.input',
            annotation: 'RPC: tokens.input',
            description: 'Input tokens.',
        },
        {
            rpcName: 'tokens.output',
            cliBulletLabel: 'tokens.output',
            annotation: 'RPC: tokens.output',
            description: 'Output tokens.',
        },
        {
            rpcName: 'tokens.cacheRead',
            cliBulletLabel: 'tokens.cacheRead',
            annotation: 'RPC: tokens.cacheRead',
            description: 'Cache-read tokens (optional).',
        },
        {
            rpcName: 'costUsd',
            cliBulletLabel: 'costUsd',
            annotation: 'RPC: costUsd',
            description: 'Cost in USD.',
        },
    ],
}

/**
 * Canonical ordering — essentials first (matches the historical
 * cli-manual.md layout), then reference entries in CLI-verb category
 * order (agent control, graph, search, live state, metrics). Consumers
 * that need a different order build their own filtered/sorted view;
 * the renderer respects whatever order they pass in.
 */
export const TOOL_SPECS: readonly ToolSpec[] = [
    // Essentials
    SPAWN_AGENT_SPEC,
    AGENT_WAIT_SPEC,
    AGENT_LIST_SPEC,
    CREATE_GRAPH_SPEC,
    GET_UNSEEN_NODES_NEARBY_SPEC,
    // Reference — agent control
    CLOSE_AGENT_SPEC,
    SEND_MESSAGE_SPEC,
    READ_TERMINAL_OUTPUT_SPEC,
    // Reference — graph
    GRAPH_STRUCTURE_SPEC,
    SEARCH_NODES_SPEC,
    VT_GET_LIVE_STATE_SPEC,
    VT_DISPATCH_LIVE_COMMAND_SPEC,
    // Reference — metrics
    METRICS_GET_SESSIONS_SPEC,
    METRICS_APPEND_SESSION_SPEC,
] as const

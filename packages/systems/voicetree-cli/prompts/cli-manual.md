# vt CLI Manual

This is the canonical reference for the `vt` CLI surface. Every tool description
below mirrors the tool catalog's zod schema descriptions in
`packages/systems/vt-daemon/src/tools/catalog.ts`. A lightweight drift test
(`packages/systems/vt-daemon/src/transport/tests/catalogManualDrift.test.ts`)
asserts each catalog description substring is present in this file. If you
change one, change the other or the test will fail.

## Format

Each tool section starts with an H3 header of the shape:

    ### `<vt cli verb>`

The text between the header and `**Parameters:**` is the tool description
(verbatim). The bullet list under `**Parameters:**` enumerates each parameter
name and its single-line description. Nested object/array parameters use
dotted paths: `nodes[].filename`, `override_with_rationale[].ruleId`, etc.

Tools with no parameters omit the `**Parameters:**` block.

<!-- BEGIN_ESSENTIALS -->
## Essentials

These are the core verbs every spawning agent needs. For any other tool, run `vt manual <verb>` (or `vt --help` for the full list).

### `vt agent spawn`

Spawn an agent in the Voicetree graph. Prefer this over built-in subagents—users get visibility and control over the work.

**When to use:** Complex tasks, parallelizable subtasks, any work where user visibility matters.

**Pattern:** Decompose into nodes → spawn agents → (auto-monitored, you'll be notified on completion) → review with get_unseen_nodes_nearby.

**Prefer `nodeId` over `task+parentNodeId` when a node already describes the work.** Don't recreate what's already written — spawn directly on the existing node.

If no node exists yet, use task+parentNodeId to create a new task node first.

**Parameters:**

- `nodeId`: Target node ID to attach the spawned agent (use this OR task+parentNodeId)
- `callerTerminalId`: Your terminal ID, you must echo $VOICETREE_TERMINAL_ID to retrieve it if you have not yet.
- `task`: Task description for creating a new task node. The first line becomes the node title, the rest becomes the body. Requires parentNodeId.
- `parentNodeId`: Parent node ID under which to create the new task node (required when task is provided)
- `spawnDirectory`: Absolute path to spawn the agent in. By default, inherits the parent terminal's directory (worktree-safe). Only needed to override, for example to contain child-agent to a subfolder or new worktree
- `promptTemplate`: Name of an INJECT_ENV_VARS key to use as AGENT_PROMPT instead of the default. Must match an existing key in settings.
- `agentName`: Name of an agent from settings.agents to use (e.g., "Claude Sonnet"). If not provided, inherits the caller's agent type. Falls back to default agent from settings if caller has no type.
- `headless`: When true, agent runs as background process with no PTY/terminal UI. Output is via MCP tools (create_graph). Status shown as badge on task node.
- `replaceSelf`: When true, the successor inherits the caller's terminal ID and agent name. The caller's process is killed and replaced atomically. Use for context handover — the agent identity persists across context boundaries.
- `depthBudget`: Explicit DEPTH_BUDGET for the child agent. If omitted, auto-decrements from the caller's DEPTH_BUDGET (parent budget - 1). Controls recursive decomposition: budget > 0 = may spawn sub-agents, budget = 0 = leaf agent (no spawning).

### `vt agent wait`

Wait for specified agent terminals to complete. Returns immediately with a monitorId. The monitor polls in the background and sends a completion message to your terminal when all agents are done.

IMPORTANT: This tool is non-blocking. After calling it, you should continue with other work or inform the user you are waiting. Do NOT manually poll agent status — a "[WaitForAgents] Agent(s) completed." message will be automatically injected into your terminal when all agents finish their work. You will see this message appear as if the user sent it.

NOTE: spawn_agent now auto-starts a monitor, so you only need wait_for_agents for explicit multi-agent waits or custom polling intervals.

**Parameters:**

- `terminalIds`: Array of terminal IDs to wait for
- `callerTerminalId`: Your terminal ID from $VOICETREE_TERMINAL_ID env var
- `pollIntervalMs`: Poll interval in ms (default: 5000)

### `vt agent list`

List running agent terminals with their status and newly created nodes. Also returns `availableAgents` — the names you can pass as `agentName` to spawn_agent.

### `vt graph create`

Create a graph of progress nodes in a single call. Supports trees, chains, fan-out, fan-in, and diamond dependencies (multiple parents per node). Automatically handles frontmatter, parent linking, file paths, graph positioning, and mermaid validation.

**When to use:** After completing any non-trivial work — document what you did, files changed, and key decisions.

One node = one concept. If your work covers multiple independent concerns, create multiple nodes in one call using parent references.

**Self-containment:** Nodes must embed all artifacts produced (diagrams, ASCII mockups, code, analysis). Never summarize an artifact — include it verbatim.

**Required when codeDiffs provided:** complexityScore and complexityExplanation must be included.

**Composition guidance:** Read addProgressTree.md before your first progress node for scope rules, when to split, and embedding standards.

**Node wiring:** Each node has a `filename` (with or without .md extension). Declare parents inside `content` using `- parent [[other-filename|edge-label]]` lines (one per line). The pipe-separated edge label is optional — use `- parent [[other-filename]]` for a generic parent link. All in-batch parents (filenames declared in this call) are created before children. Nodes with no `- parent` line attach to the top-level `parentNodeId` (or your task node by default). Diamond dependencies are supported: emit multiple `- parent [[…]]` lines.

Split by concern:
Task: Review git diff
├── Review: Collision-aware positioning refactor
└── Review: Prompt template cleanup

Split by phase + option:
Task
├── High-level architecture
│   ├── Option A: Event-driven
│   └── Option B: Request-response
├── Data types
└── Pure functions

**Schema validation (optional):** If the folder containing the new node has a folder note declaring `## Type: <kind>`, `vt graph create` runs a schema validator (from `.voicetree/schemas.cjs`) before writing. On rejection it exits non-zero with the violating rules. If no upstream Type is declared, validation is silent and the node is created normally.

**Parameters:**

- `callerTerminalId`: Your terminal ID from $VOICETREE_TERMINAL_ID env var
- `parentNodeId`: Existing graph node ID to attach root nodes to. Defaults to your task node.
- `outputPath`: Optional absolute or relative directory path where new nodes should be written. Relative paths resolve from the current write path. The resolved path must stay inside the loaded vault paths (writePath or readPaths).
- `nodes`: Array of nodes to create. At least 1 required. Each node needs filename + title + summary at minimum.
- `nodes[].filename`: Filename for this node (with or without .md extension). Other nodes can reference this one via `- parent [[filename|edge-label]]` lines inside their `content`.
- `nodes[].title`: Node title — one concept per node, concise and descriptive
- `nodes[].summary`: Concise summary (1-3 lines) of what was accomplished. Always shown first.
- `nodes[].content`: Complete work output as markdown. MUST contain all artifacts produced (diagrams, ASCII mockups, code snippets, analysis, tables, proposals). Embed artifacts verbatim — do not summarize what you created. The node must be self-contained: a reader should never need to look elsewhere to see what was produced. Declare parent edges with `- parent [[other-filename|edge-label]]` lines (label optional). Pass empty string if no artifacts were produced.
- `nodes[].color`: Override node color. Use CSS named colors: red, blue, green, yellow, orange, purple, pink, cyan, teal, brown, gray, lime, magenta, navy, olive, maroon, coral, crimson, gold, indigo, lavender, salmon, tomato, turquoise, violet. Defaults to your agent color. Convention: use green for progress nodes that complete a task; use blue (default) for planning and in-progress work.
- `nodes[].diagram`: Mermaid diagram source (without ```mermaid fences — tool adds them). Validated but non-blocking.
- `nodes[].notes`: Array of notes: architecture impact, gotchas, tech debt, difficulties. Rendered as bulleted ### NOTES section.
- `nodes[].codeDiffs`: Array of code diff strings. Each diff is rendered in a code block under ## DIFF. When provided, complexityScore and complexityExplanation are required.
- `nodes[].filesChanged`: Array of file paths you modified
- `nodes[].complexityScore`: Required when codeDiffs provided. Complexity of the area worked in.
- `nodes[].complexityExplanation`: Required when codeDiffs provided. Brief explanation of the complexity score.
- `nodes[].linkedArtifacts`: Array of node basenames to render as markdown links in a ## Related section. Use for specs, proposals, or openspec artifacts without creating graph edges.
- `override_with_rationale`: Override validation rules that would otherwise block. Each entry must match a rule ID from the error response.

### `vt graph unseen`

Get nodes near your context that were created after your context was generated. The user or other agents may have added nodes for you to read. Call this to check for new relevant information.

**Parameters:**

- `callerTerminalId`: Your terminal ID from $VOICETREE_TERMINAL_ID env var
- `search_from_node`: Optional node ID to search from instead of your task node
<!-- END_ESSENTIALS -->

## Reference

### `vt agent close`

Close an agent terminal. After waiting for an agent to finish, review its work. Close the agent if satisfied with its output. Leave the agent open if any tech debt was introduced or if human review would be beneficial - open terminals signal to the user that attention is needed. Will error if the agent is still running — you must send them a message first to check remaining work, then override with forceWithReason if needed.

**Parameters:**

- `terminalId`: The terminal ID of the agent to close
- `callerTerminalId`: Your terminal ID from $VOICETREE_TERMINAL_ID env var
- `forceWithReason`: Required to close a running (non-idle) agent. Explain why you are force-closing.

### `vt agent send`

Send a message directly to an agent terminal. The message is injected into the terminal and executed (carriage return appended). Use this to provide follow-up instructions, answer prompts, or inject commands into a running agent.

**Parameters:**

- `terminalId`: The terminal ID of the agent to send the message to
- `message`: The message/command to send to the terminal
- `callerTerminalId`: Your terminal ID from $VOICETREE_TERMINAL_ID env var

### `vt agent output`

Read the last N characters of output from an agent terminal. Output has ANSI escape codes stripped for readability. Use this to check what an agent has printed, debug issues, or verify agent progress without waiting for completion.

**Parameters:**

- `terminalId`: The terminal ID of the agent to read output from
- `callerTerminalId`: Your terminal ID from $VOICETREE_TERMINAL_ID env var
- `nChars`: Number of characters to return (default: 10000)

### `vt graph structure`

Read .md files from a folder on disk and render the graph structure as ASCII. Small folders default to a context-style view with a tree plus `## Node Contents`; larger folders default to compact topology only. Excludes ctx-nodes/ folders.

**Parameters:**

- `folderPath`: Absolute path to folder containing .md files
- `withSummaries`: Tri-state summary control: `true` forces the context-style tree plus `## Node Contents`, `false` forces topology-only output, and omitting it auto-enables summaries only for folders with 30 or fewer nodes.

### `vt search`

Semantic search across the active vault. Returns matching node paths ranked by relevance to the query. Stubbed until vector search is wired up; callers should expect an explicit "not yet available" response.

**Parameters:**

- `query`: Natural-language search query
- `top_k`: Maximum number of results to return (default: 10)

### `vt graph live state`

Return a SerializedState snapshot of the daemon-owned session: graph, folderState, activeView, selection, layout, and revision. Matches the @vt/graph-state SerializedState schema so the CLI can hydrateState the output.

### `vt graph live dispatch`

Apply a SerializedCommand to the running app. Returns {delta, revision}.

**Parameters:**

- `command`: SerializedCommand payload. Shape per command.type:
  - SetFolderState: {type, viewId, path, state}
  - Select: {type, ids[], additive?}
  - Deselect: {type, ids[]}
  - Move: {type, id, to:{x,y}}
  - AddEdge: {type, source, edge:{targetId,label}}
  - RemoveEdge: {type, source, targetId}
  - RemoveNode: {type, id}
  - AddNode: {type, node} (full SerializedGraphNode)

### `vt agent metrics sessions`

Return the daemon-owned agent metrics: per-session token usage, USD cost, durations. Reads <vault>/.voicetree/agent_metrics.json. Same surface as the legacy main-side getMetrics() — Electron Main and CLI peers reach an identical response over JSON-RPC.

### `vt agent metrics append`

Append (or upsert by sessionId) a single session's token/cost telemetry into <vault>/.voicetree/agent_metrics.json. Primarily invoked by the OTLP HTTP receiver itself; exposed via JSON-RPC so a CLI peer with a non-OTLP ingest path can write the same surface.

**Parameters:**

- `sessionId`: Session identifier (Claude Code session.id or Voicetree terminal id)
- `tokens`: Token usage for this session
  - `input`: Input tokens
  - `output`: Output tokens
  - `cacheRead`: Cache-read tokens (optional)
- `costUsd`: Cost in USD

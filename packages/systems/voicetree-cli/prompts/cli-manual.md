# vt CLI Manual

This is the canonical reference for the `vt` CLI surface. Each tool section's
opening description sentence mirrors the matching entry in
`packages/systems/vt-daemon/src/tools/catalog.ts`. A lightweight drift test
(`packages/systems/vt-daemon/src/transport/tests/catalogManualDrift.test.ts`)
asserts that each catalog description leader is present in this file. If you
change one, change the other or the test will fail.

## Format

Each tool section starts with an H3 header of the shape:

    ### `<vt cli verb>`

The text between the header and `**Parameters:**` is the tool description.
The bullet list under `**Parameters:**` enumerates each CLI flag (or
positional argument) and — where it dispatches to a daemon tool — the JSON
RPC parameter name it maps to in the form `(RPC: rpcParam)`. Tools with no
parameters omit the `**Parameters:**` block.

<!-- BEGIN_ESSENTIALS -->
## Essentials

These are the core verbs every spawning agent needs. For any other tool, run `vt manual <verb>` (or `vt --help` for the full list).

### `vt agent spawn`

Spawn an agent in the Voicetree graph. Prefer this over built-in subagents—users get visibility and control over the work.

**When to use:** Complex tasks, parallelizable subtasks, any work where user visibility matters.

**Pattern:** Decompose into nodes → spawn agents → (auto-monitored, you'll be notified on completion) → review with `vt graph unseen`.

**Prefer `--node` over `--task`+`--parent` when a node already describes the work.** Don't recreate what's already written — spawn directly on the existing node.

If no node exists yet, use `--task`+`--parent` to create a new task node first.

**Parameters:**

- `--terminal / -t` (RPC: callerTerminalId): Caller terminal ID; defaults to $VOICETREE_TERMINAL_ID. Global flag — set before the verb.
- `--node VALUE` (RPC: nodeId): Target node ID to attach the spawned agent (use this OR --task+--parent).
- `--task VALUE` (RPC: task): Task description for creating a new task node. First line becomes the title; remaining lines become the body.
- `--parent VALUE` (RPC: parentNodeId): Parent node ID under which to create the new task node (required with --task).
- `--name VALUE` (RPC: agentName): Agent name from settings.agents (e.g. "Claude Sonnet"). Defaults to caller's agent.
- `--depth VALUE` (RPC: depthBudget): Explicit depth budget for the child. Auto-decrements from caller when omitted. Controls recursive decomposition: budget > 0 = may spawn sub-agents, budget = 0 = leaf agent.
- `--spawn-dir VALUE` (RPC: spawnDirectory): Absolute path to spawn the agent in. Defaults to parent terminal's directory (worktree-safe).
- `--prompt-template VALUE` (RPC: promptTemplate): INJECT_ENV_VARS key to use as AGENT_PROMPT instead of the default.
- `--headless` (RPC: headless): Run the agent as a background process with no PTY/terminal UI. Status shown as a badge on the task node.
- `--replace-self` (RPC: replaceSelf): Successor inherits the caller's terminal ID and agent name; caller is killed atomically. Use for context handover.

### `vt agent wait`

Wait for specified agent terminals to complete. Returns immediately with a monitorId. The monitor polls in the background and sends a completion message to your terminal when all agents are done.

IMPORTANT: This tool is non-blocking. After calling it, you should continue with other work or inform the user you are waiting. Do NOT manually poll agent status — a "[WaitForAgents] Agent(s) completed." message will be automatically injected into your terminal when all agents finish their work. You will see this message appear as if the user sent it.

NOTE: `vt agent spawn` now auto-starts a monitor, so you only need `vt agent wait` for explicit multi-agent waits or custom polling intervals.

**Parameters:**

- `<terminalId>...` (positional, RPC: terminalIds): One or more terminal IDs to wait for.
- `--terminal / -t` (RPC: callerTerminalId): Caller terminal ID; defaults to $VOICETREE_TERMINAL_ID. Global flag — set before the verb.
- `--poll-interval VALUE` (RPC: pollIntervalMs): Poll interval in milliseconds (default 5000).

### `vt agent list`

List running agent terminals with their status and newly created nodes. Also returns `availableAgents` — the names you can pass to `--name` when spawning.

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

**Modes:**

- *Filesystem mode* — pass one or more `<file.md>` positional paths. The CLI parses frontmatter and `[[wikilinks]]` to build the create payload locally.
- *Live mode* — pass `--node "title::summary[::content]"` (repeatable) and/or `--nodes-file FILE`, or pipe a JSON `{nodes, overrides?}` payload to stdin. The CLI forwards the payload to the daemon's `create_graph` RPC.

**Parameters:**

- `<file.md>...` (positional, filesystem mode): Markdown inputs to author into the graph. Frontmatter populates node metadata; `- parent [[basename]]` lines in the body wire parent edges.
- `--terminal / -t` (RPC: callerTerminalId): Caller terminal ID; defaults to $VOICETREE_TERMINAL_ID. Global flag — set before the verb. Required in live mode.
- `--parent VALUE` (RPC: parentNodeId): Existing graph node ID to attach root nodes to. Defaults to your task node. In filesystem mode this is a peer markdown filename outside the input set.
- `--color VALUE`: Default color for nodes that do not declare their own color. Convention: `green` for completed work, `blue` for planning/in-progress.
- `--nodes-file VALUE` (live mode): JSON file containing `{nodes, overrides?}` payload to send to the daemon.
- `--node VALUE` (live mode, repeatable): Inline node spec in the form `"title::summary"` or `"title::summary::content"`.
- `--manifest VALUE` (filesystem mode): ASCII or Mermaid layout manifest used to position the filesystem inputs.
- `--validate-only` (filesystem mode): Parse and run the schema gate without writing files or calling the daemon.
- `--override VALUE` (repeatable, RPC: override_with_rationale[]): Override a blocking validation rule, formatted `<ruleId>:<rationale>`.

### `vt graph unseen`

Get nodes near your context that were created after your context was generated. The user or other agents may have added nodes for you to read. Call this to check for new relevant information.

**Parameters:**

- `--terminal / -t` (RPC: callerTerminalId): Caller terminal ID; defaults to $VOICETREE_TERMINAL_ID. Global flag — set before the verb.
- `--from VALUE` (RPC: search_from_node): Optional node ID to search from instead of your task node.
<!-- END_ESSENTIALS -->

## Reference

### `vt agent close`

Close an agent terminal. After waiting for an agent to finish, review its work. Close the agent if satisfied with its output. Leave the agent open if any tech debt was introduced or if human review would be beneficial - open terminals signal to the user that attention is needed. Will error if the agent is still running — you must send them a message first to check remaining work, then override with forceWithReason if needed.

**Parameters:**

- `<terminalId>` (positional, RPC: terminalId): The terminal ID of the agent to close.
- `--terminal / -t` (RPC: callerTerminalId): Caller terminal ID; defaults to $VOICETREE_TERMINAL_ID. Global flag — set before the verb.
- `--force VALUE` (RPC: forceWithReason): Required to close a running (non-idle) agent. Provide a reason string.

### `vt agent send`

Send a message directly to an agent terminal. The message is injected into the terminal and executed (carriage return appended). Use this to provide follow-up instructions, answer prompts, or inject commands into a running agent.

**Parameters:**

- `<terminalId>` (positional, RPC: terminalId): The terminal ID of the agent to send the message to.
- `<message>...` (positional, RPC: message): The message/command to send to the terminal. All remaining tokens are joined with spaces.
- `--terminal / -t` (RPC: callerTerminalId): Caller terminal ID; defaults to $VOICETREE_TERMINAL_ID. Global flag — set before the verb.

### `vt agent output`

Read the last N characters of output from an agent terminal. Output has ANSI escape codes stripped for readability. Use this to check what an agent has printed, debug issues, or verify agent progress without waiting for completion.

**Parameters:**

- `<terminalId>` (positional, RPC: terminalId): The terminal ID of the agent to read output from.
- `--terminal / -t` (RPC: callerTerminalId): Caller terminal ID; defaults to $VOICETREE_TERMINAL_ID. Global flag — set before the verb.
- `--chars VALUE` (RPC: nChars): Number of characters to return (default 10000).

### `vt graph structure`

Read .md files from a folder on disk and render the graph structure as ASCII. Small folders default to a context-style view with a tree plus `## Node Contents`; larger folders default to compact topology only. Excludes ctx-nodes/ folders.

**Modes:**

- *Auto* (default when no explicit-render flag is set) — asks the local graph daemon for the auto context view, falling back to local rendering when the daemon is unreachable. `--budget` and `--expand` only apply here.
- *Explicit render* — triggered by `--ascii`, `--mermaid`, `--format`, `--collapse`, `--select`, or `--no-cross-edges`. Bypasses the daemon and renders locally.

**Parameters:**

- `<folder-path>` (positional): Absolute or relative folder containing .md files. Defaults to the current working directory.
- `--auto | --no-auto`: Force or disable the auto context-style summaries view.
- `--budget VALUE`: Auto-view node budget (default 30). Auto mode only.
- `--expand VALUE` (repeatable): Force-expand a folder id that auto-collapse would otherwise suppress. Auto mode only.
- `--mermaid | --ascii`: Shorthand for `--format mermaid` or `--format ascii`. Explicit-render mode.
- `--format VALUE`: Render format (`ascii` or `mermaid`). Explicit-render mode.
- `--no-cross-edges`: Hide cross-folder edges. Explicit-render mode.
- `--collapse VALUE` (repeatable): Collapse the listed folder in the rendered view. Explicit-render mode.
- `--select VALUE` (repeatable): Highlight the listed node id in the rendered view. Explicit-render mode.

### `vt search`

Semantic search across the active vault. Returns matching node paths ranked by relevance to the query. Stubbed until vector search is wired up; callers should expect an explicit "not yet available" response.

**Parameters:**

- `<query>...` (positional, RPC: query): Natural-language query. All remaining positional tokens are joined with spaces.
- `--top-k VALUE` (RPC: top_k): Maximum number of results to return (default 10).

### `vt graph live state dump`

Return a SerializedState snapshot of the daemon-owned session: graph, folderState, activeView, selection, layout, and revision. Matches the @vt/graph-state SerializedState schema so the CLI can hydrateState the output.

Implemented locally by the CLI; the same surface is exposed over JSON-RPC as the `vt_get_live_state` daemon tool.

**Parameters:**

- `--pretty | --no-pretty`: Pretty-print the JSON output (default: pretty).
- `--vault VALUE`: Override the resolved vault path. Defaults to the active vault for the current working directory.

### `vt graph live apply`

Apply a SerializedCommand to the running app. Returns {delta, revision}.

Implemented locally by the CLI; the same surface is exposed over JSON-RPC as the `vt_dispatch_live_command` daemon tool.

**Parameters:**

- `<json-cmd>` (positional): SerializedCommand JSON. Shape per `command.type`:
  - `SetFolderState`: `{type, viewId, path, state}`
  - `Select`: `{type, ids[], additive?}`
  - `Deselect`: `{type, ids[]}`
  - `Move`: `{type, id, to:{x,y}}`
  - `AddEdge`: `{type, source, edge:{targetId,label}}`
  - `RemoveEdge`: `{type, source, targetId}`
  - `RemoveNode`: `{type, id}`
  - `AddNode`: `{type, node}` (full SerializedGraphNode)
- `--vault VALUE`: Override the resolved vault path. Defaults to the active vault for the current working directory.

### `vt agent metrics sessions`

Return the daemon-owned agent metrics: per-session token usage, USD cost, durations. Reads <vault>/.voicetree/agent_metrics.json. Same surface as the legacy main-side getMetrics() — Electron Main and CLI peers reach an identical response over JSON-RPC.

Exposed over JSON-RPC as the `metrics.getSessions` daemon tool; no `vt` CLI wrapper is wired yet. Invoke via the daemon HTTP transport.

### `vt agent metrics append`

Append (or upsert by sessionId) a single session's token/cost telemetry into <vault>/.voicetree/agent_metrics.json. Primarily invoked by the OTLP HTTP receiver itself; exposed via JSON-RPC so a CLI peer with a non-OTLP ingest path can write the same surface.

Exposed over JSON-RPC as the `metrics.appendSession` daemon tool; no `vt` CLI wrapper is wired yet. Invoke via the daemon HTTP transport.

**Parameters:**

- `sessionId` (RPC: sessionId): Session identifier (Claude Code session.id or Voicetree terminal id).
- `tokens.input` (RPC: tokens.input): Input tokens.
- `tokens.output` (RPC: tokens.output): Output tokens.
- `tokens.cacheRead` (RPC: tokens.cacheRead): Cache-read tokens (optional).
- `costUsd` (RPC: costUsd): Cost in USD.

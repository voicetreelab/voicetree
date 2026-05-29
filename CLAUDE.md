THIS PROJECT AIMS TO FOLLOW FUNCTIONAL DESIGN. NOT OOP.
EVERYTHING SHOULD BE MODELLED AS FUNCTIONS & types. PUSH IMPURITY TO EDGE / SHELL.

We favor "deep functions", a single function to provide a minimal public API hiding internal complexity.

Deep and narrow. These can themselves be composition of functions.

Test the function as a black box. Call it with inputs, assert on outputs. Do not
mock internal dependencies. Do not use toHaveBeenCalledWith. If the function has side effects (writes to disk, sends a message),
assert on the observable result of that side effect, not on whether an internal function was called. (since we are following
functional programming philosophy)

Peer agents are likely working concurrently in this tree, so commit each useful atomic unit of work, do not wait to be asked, the human wants you to always do this no matter what. 

Use global `~/brain/mem` for OpenSpecs.
Do not duplicate OpenSpecs under worktree-local `brain/mem`.

Do not ask the human user too many questions if you can answer them yourself, or when you have have a work-around that is not reward hacking. If there is a way you can avoid asking the question, whilst introducing no additional complexity or tech debt, you must do so. Save the human's limited & valuable attention for high level architectural concerns only. If you ask the user architectural questions, include a simple ascii diagram that demonstrates the main code/function flow or architecture. 

The user is EXTREMELY concerned about code quality, much more so than immediate results.

The user appreciates honestly and they WILL be glad and thankful if you respond a request with "I couldn't complete your request because the repository lacked support for X". They will be even happier if you go ahead and update the repo to provide the necessary support in a well designed, robust way. But they will be VERY ANGRY if, while attempting to implement a feature, you introduce a workaround that will potentially break things later.

NEVER introduce hacks in the codebase.

Also assume that none of the code you're working in is in production, so backward compatibility, or keeping legacy paths, is NOT DESIRED. If you find something that is poorly designed and fixing it would require breaking existing APIs or behavior, DO SO. Do it properly rather than preserving a flawed design. Prioritize clarity, correctness, and maintainability over compatibility with existing code.

Whilst a bug fix doesn't *always* need surrounding cleanup, if you can substantially improve code quality with refactors please raise this to the user or your parent agent, so that we can continuously improve the codebase health.

Core values:
- ABSOLUTE code quality over speed of delivery.
- Correctness over convenience.
- Clarity over cleverness.
- Maintainability over short-term productivity.
- Robust design over quick fixes.
- Simplicity over complexity.
- Doing it right over doing it now.
- Honesty above everything.

Never reward hack or verification hack. Think about what the underlying measurement is trying to achieve, and work towards that, with the verifier as your feedback loop.

After every change you make, provide a clear, honest report on ANY change that you are not confident about and that could be considered a fragile hack, or could be considered reward hacking, or verification hacking.

Code search & navigation tools (use over grep when applicable):
- `ast-grep` — AST-precise search/rewrite. Use over grep when matching by syntactic shape (type of a parameter, call pattern, read vs write) — eliminates substring false positives that grep produces on TS.
- `ck --sem` — semantic search for when you can't guess any keyword (e.g. "graceful shutdown" → `cleanupOwnedDaemon`). Run `ck --index .` to completion once per repo (10-30min) before relying on it; otherwise indexing is hidden in query latency.
- `cgcli` (`@vt/code-graph-cli`) — symbol-resolved call graph (`callers` / `callees` / `reachable` / `hotspots`). Use over grep when navigating by structure (grep can't follow barrel re-exports) and to surface the codebase's worst-coupled functions.

<!-- VOICETREE_AGENT_DISCOVERY_START -->
## VoiceTree `vt` CLI (auto-generated — do not edit between sentinels)

# vt CLI Manual

This is the canonical reference for the `vt` CLI surface. Generated from
`@vt/vt-daemon-protocol` (TOOL_SPECS + CLI-local specs) — do not edit by
hand. Run `vt manual` to print the full document or `vt manual <verb>` for
a single section.

## Format

Each tool section starts with an H3 header of the shape:

    ### `<vt cli verb>`

The text between the header and `**Parameters:**` is the tool description.
The bullet list under `**Parameters:**` enumerates each CLI flag or
positional argument and — where it dispatches to a daemon tool — the JSON
RPC parameter name it maps to in the form `(RPC: rpcParam)`. Tools with
no parameters omit the `**Parameters:**` block.

## Essentials

These are the core verbs every spawning agent needs. For any other tool, run `vt manual <verb>` (or `vt --help` for the full list).

### `vt agent spawn`

Spawn an agent in the Voicetree graph. Prefer this over built-in subagents — users get visibility and control over the work.

**When to use:** Complex tasks, parallelizable subtasks, any work where user visibility matters.

**Pattern:** Decompose into nodes → spawn agents → (auto-monitored, you'll be notified on completion) → review with `vt graph unseen`.

**Prefer `--node` over `--task`+`--parent` when a node already describes the work.** Don't recreate what's already written — spawn directly on the existing node. If no node exists yet, use `--task`+`--parent` to create a new task node first.

**Parameters:**

- `--terminal / -t` (RPC: callerTerminalId): Your terminal ID. Defaults to `$VOICETREE_TERMINAL_ID` (already set in every spawned agent's environment). Global CLI flag — set before the verb when overriding.
- `--node VALUE` (RPC: nodeId): Target node ID to attach the spawned agent (use this OR `--task`+`--parent`).
- `--task VALUE` (RPC: task): Task description for creating a new task node. The first line becomes the node title; remaining lines become the body. Requires `--parent`.
- `--parent VALUE` (RPC: parentNodeId): Parent node ID under which to create the new task node (required with `--task`).
- `--name VALUE` (RPC: agentName): Agent name from `settings.agents` (e.g. `"Claude Sonnet"`). Defaults to the caller's agent type. Falls back to the default agent from settings if the caller has no type.
- `--depth VALUE` (RPC: depthBudget): Explicit `DEPTH_BUDGET` for the child agent. Auto-decrements from the caller when omitted (parent budget − 1). Controls recursive decomposition: budget > 0 = may spawn sub-agents; budget = 0 = leaf agent.
- `--spawn-dir VALUE` (RPC: spawnDirectory): Absolute path to spawn the agent in. Defaults to the parent terminal's directory (worktree-safe). Override to contain a child agent to a subfolder or new worktree.
- `--prompt-template VALUE` (RPC: promptTemplate): `INJECT_ENV_VARS` key to use as `AGENT_PROMPT` instead of the default. Must match an existing key in settings.
- `--headless` (RPC: headless): Run the agent as a background process with no PTY / terminal UI. Output is via tools (e.g. `vt graph create`). Status shown as a badge on the task node.
- `--replace-self` (RPC: replaceSelf): Successor inherits the caller's terminal ID and agent name; the caller's process is killed atomically. Use for context handover — the agent identity persists across context boundaries.

### `vt agent wait`

Wait for specified agent terminals to complete. Returns immediately with a `monitorId`. The monitor polls in the background and sends a completion message to your terminal when all agents are done.

**IMPORTANT:** This tool is non-blocking. After calling it, continue with other work or inform the user you are waiting. Do NOT manually poll agent status — a `[WaitForAgents] Agent(s) completed.` message will be automatically injected into your terminal when all agents finish. You will see this message appear as if the user sent it.

**NOTE:** `vt agent spawn` now auto-starts a monitor, so you only need `vt agent wait` for explicit multi-agent waits or custom polling intervals.

**Parameters:**

- `--terminal / -t` (RPC: callerTerminalId): Your terminal ID. Defaults to `$VOICETREE_TERMINAL_ID` (already set in every spawned agent's environment). Global CLI flag — set before the verb when overriding.
- `<terminalId>...` (positional, RPC: terminalIds): One or more terminal IDs to wait for.
- `--poll-interval VALUE` (RPC: pollIntervalMs): Poll interval in milliseconds (default `5000`).

### `vt agent list`

List running agent terminals with their status and newly created nodes. Also returns `availableAgents` — the names you can pass to `--name` when spawning.

**Parameters:**

- `--terminal / -t` (RPC: callerTerminalId): Your terminal ID. Defaults to `$VOICETREE_TERMINAL_ID` (already set in every spawned agent's environment). Global CLI flag — set before the verb when overriding.

### `vt graph create`

Create a graph of progress nodes in a single call. Supports trees, chains, fan-out, fan-in, and diamond dependencies (multiple parents per node). Automatically handles frontmatter, parent linking, file paths, graph positioning, and mermaid validation.

**When to use:** After completing any non-trivial work — document what you did, files changed, and key decisions.

One node = one concept. If your work covers multiple independent concerns, create multiple nodes in one call using parent references.

**Self-containment:** Nodes must embed all artifacts produced (diagrams, ASCII mockups, code, analysis). Never summarize an artifact — include it verbatim.

**Required when codeDiffs provided:** `complexityScore` and `complexityExplanation` must be included.

**Composition guidance:** Read `addProgressTree.md` before your first progress node for scope rules, when to split, and embedding standards.

**Node wiring:** Each node has a `filename` (with or without `.md` extension). Declare parents inside `content` using `- parent [[other-filename|edge-label]]` lines (one per line). The pipe-separated edge label is optional — use `- parent [[other-filename]]` for a generic parent link. All in-batch parents (filenames declared in this call) are created before children. Nodes with no `- parent` line attach to the top-level `parentNodeId` (or your task node by default). Diamond dependencies are supported: emit multiple `- parent [[…]]` lines.

**Schema validation (optional):** If the folder containing the new node has a folder note declaring `## Type: <kind>`, `vt graph create` runs a schema validator (from `.voicetree/schemas.cjs`) before writing. On rejection it exits non-zero with the violating rules. If no upstream Type is declared, validation is silent and the node is created normally.

**Modes:**
- *Filesystem mode* — pass one or more `<file.md>` positional paths. The CLI parses frontmatter and `[[wikilinks]]` to build the create payload locally.
- *Live mode* — pass `--node "title::summary[::content]"` (repeatable) and/or `--nodes-file FILE`, or pipe a JSON `{nodes, overrides?}` payload to stdin. The CLI forwards the payload to the daemon's `create_graph` RPC.

**Parameters:**

- `--terminal / -t` (RPC: callerTerminalId): Your terminal ID. Defaults to `$VOICETREE_TERMINAL_ID` (already set in every spawned agent's environment). Global CLI flag — set before the verb when overriding.
- `<file.md>...` (positional, filesystem mode): Markdown inputs to author into the graph. Frontmatter populates node metadata; `- parent [[basename]]` lines in the body wire parent edges.
- `--parent VALUE` (RPC: parentNodeId): Existing graph node ID to attach root nodes to. Defaults to your task node. In filesystem mode this is a peer markdown filename outside the input set.
- `--color VALUE`: Default color for nodes that do not declare their own color. Convention: `green` for completed work, `blue` for planning / in-progress.
- `--nodes-file VALUE` (live mode): JSON file containing `{nodes, overrides?}` payload to send to the daemon.
- `--node VALUE` (live mode, repeatable): Inline node spec in the form `"title::summary"` or `"title::summary::content"`.
- `--manifest VALUE` (filesystem mode): ASCII or Mermaid layout manifest used to position the filesystem inputs.
- `--validate-only` (filesystem mode): Parse and run the schema gate without writing files or calling the daemon.
- `--override VALUE` (repeatable, RPC: override_with_rationale[]): Override a blocking validation rule, formatted `<ruleId>:<rationale>`.

### `vt graph unseen`

Get nodes near your context that were created after your context was generated. The user or other agents may have added nodes for you to read. Call this to check for new relevant information.

**Parameters:**

- `--terminal / -t` (RPC: callerTerminalId): Your terminal ID. Defaults to `$VOICETREE_TERMINAL_ID` (already set in every spawned agent's environment). Global CLI flag — set before the verb when overriding.
- `--from VALUE` (RPC: search_from_node): Optional node ID to search from instead of your task node.

## Reference

### `vt agent close`

Close an agent terminal. After waiting for an agent to finish, review its work. Close the agent if satisfied with its output. Leave the agent open if any tech debt was introduced or if human review would be beneficial — open terminals signal to the user that attention is needed.

**Will error in two cases:**

1. **Agent has produced no graph nodes.** Nudge them with `vt agent send` to write a progress node, then retry. For genuinely no-output agents (turn-based simulation actors, etc.), use `--force` with a reason.
2. **Agent is still running (non-idle).** Send them a message first to check remaining work, then use `--force "<reason>"` to override.

**Parameters:**

- `--terminal / -t` (RPC: callerTerminalId): Your terminal ID. Defaults to `$VOICETREE_TERMINAL_ID` (already set in every spawned agent's environment). Global CLI flag — set before the verb when overriding.
- `<terminalId>` (positional, RPC: terminalId): The terminal ID of the agent to close.
- `--force VALUE` (RPC: forceWithReason): Required to close a running (non-idle) agent or an agent that produced no nodes. Provide a reason string explaining the override.

### `vt agent send`

Send a message directly to an agent terminal. The message is injected into the target terminal as user input and executed (carriage return appended).

The receiving agent does **NOT** see the raw text you sent. It sees a wrapped message of the form:

```
[From: <your-terminal-id>] <your-message>

If you need to reply use the cli tool 'vt agent send' to <your-terminal-id>. (DO NOT USE SendMessage or other messaging tools you may have, they won't work)
```

That hint is what makes inter-agent conversation work: the receiver replies by calling `vt agent send <your-terminal-id> "…"`, and the reply lands in YOUR terminal as a normal user-input message with the same `[From: <their-id>]` prefix. You do **not** need to poll `vt agent output` — replies arrive as if the user typed them. (Auto-monitor on spawn also injects `[WaitForAgents] …` notifications into your terminal when spawned agents finish.)

Pending terminals (mid-spawn) queue messages and deliver them once registered. Non-tmux headless agents have no input channel and are rejected — they receive work via their task node and produce output as graph nodes; use `vt graph unseen` to read what they wrote.

Use this to coordinate turn-based simulations, provide follow-up instructions, answer prompts, or inject commands into a running agent.

**Parameters:**

- `--terminal / -t` (RPC: callerTerminalId): Your terminal ID. Defaults to `$VOICETREE_TERMINAL_ID` (already set in every spawned agent's environment). Global CLI flag — set before the verb when overriding.
- `<terminalId>` (positional, RPC: terminalId): The terminal ID of the agent to send the message to.
- `<message>...` (positional, RPC: message): The message / command to send to the terminal. All remaining tokens are joined with spaces.

### `vt agent output`

Read the last N characters of output from an agent terminal. Output has ANSI escape codes stripped for readability. Use this to check what an agent has printed, debug issues, or verify agent progress without waiting for completion.

Returns `{success: true, output, isHeadless}` for any registered terminal. Interactive (PTY) terminals buffer output incrementally — immediately after spawn the buffer may be empty, in which case `output` is the empty string (not an error). Retry once the agent has produced any output. The `success: false` shape is reserved for "terminal not found".

Pending terminals (mid-spawn) also succeed and return `{success: true, pending: true, output: ''}` — callers polling for output should treat empty + pending as "not yet, retry".

**Parameters:**

- `--terminal / -t` (RPC: callerTerminalId): Your terminal ID. Defaults to `$VOICETREE_TERMINAL_ID` (already set in every spawned agent's environment). Global CLI flag — set before the verb when overriding.
- `<terminalId>` (positional, RPC: terminalId): The terminal ID of the agent to read output from.
- `--chars VALUE` (RPC: nChars): Number of characters to return (default `10000`).

### `vt graph structure`

Read `.md` files from a folder on disk and render the graph structure as ASCII. Small folders default to a context-style view with a tree plus `## Node Contents`; larger folders default to compact topology only. Excludes `ctx-nodes/` folders.

**Modes:**
- *Auto* (default when no explicit-render flag is set) — asks the local graph daemon for the auto context view, falling back to local rendering when the daemon is unreachable. `--budget` and `--expand` only apply here.
- *Explicit render* — triggered by `--ascii`, `--mermaid`, `--format`, `--collapse`, `--select`, or `--no-cross-edges`. Bypasses the daemon and renders locally.

**Parameters:**

- `<folder-path>` (positional, RPC: folderPath): Absolute or relative folder containing `.md` files. Defaults to the current working directory.
- `--auto | --no-auto` (RPC: withSummaries): Force or disable the auto context-style summaries view. Tri-state: omit to auto-enable for folders ≤30 nodes; `--auto` forces context-style; `--no-auto` forces topology-only.
- `--budget VALUE`: Auto-view node budget (default `30`). Auto mode only.
- `--expand VALUE` (repeatable): Force-expand a folder id that auto-collapse would otherwise suppress. Auto mode only.
- `--mermaid | --ascii`: Shorthand for `--format mermaid` or `--format ascii`. Explicit-render mode.
- `--format VALUE`: Render format (`ascii` or `mermaid`). Explicit-render mode.
- `--no-cross-edges`: Hide cross-folder edges. Explicit-render mode.
- `--collapse VALUE` (repeatable): Collapse the listed folder in the rendered view. Explicit-render mode.
- `--select VALUE` (repeatable): Highlight the listed node id in the rendered view. Explicit-render mode.

### `vt search`

Semantic search across the active project. Returns matching node paths ranked by relevance to the query. Stubbed until vector search is wired up; callers should expect an explicit "not yet available" response.

**Parameters:**

- `<query>...` (positional, RPC: query): Natural-language query. All remaining positional tokens are joined with spaces.
- `--top-k VALUE` (RPC: top_k): Maximum number of results to return (default `10`).

### `vt graph live state dump`

Return a SerializedState snapshot of the daemon-owned session: graph, folderState, activeView, selection, layout, and revision. Matches the `@vt/graph-state` SerializedState schema so the CLI can `hydrateState` the output.

**Parameters:**

- `--pretty | --no-pretty`: Pretty-print the JSON output (default: pretty).
- `--project VALUE`: Override the resolved project path. Defaults to the active project for the current working directory.

### `vt graph live apply`

Apply a SerializedCommand to the running app. Returns `{delta, revision}`.

`SerializedCommand` payload shape, keyed by `command.type`:
- `SetFolderState`: `{type, viewId, path, state}`
- `Select`: `{type, ids[], additive?}`
- `Deselect`: `{type, ids[]}`
- `Move`: `{type, id, to:{x,y}}`
- `AddEdge`: `{type, source, edge:{targetId,label}}`
- `RemoveEdge`: `{type, source, targetId}`
- `RemoveNode`: `{type, id}`
- `AddNode`: `{type, node}` (full `SerializedGraphNode`)

**Parameters:**

- `<json-cmd>` (positional, RPC: command): SerializedCommand JSON. See the description above for the per-`command.type` shape.
- `--project VALUE`: Override the resolved project path. Defaults to the active project for the current working directory.

### `vt agent metrics sessions`

Return the daemon-owned agent metrics: per-session token usage, USD cost, durations. Reads `<project>/.voicetree/agent_metrics.json`. Same surface as the legacy main-side `getMetrics()` — Electron Main and CLI peers reach an identical response over JSON-RPC. No `vt` CLI wrapper is wired yet; invoke via the daemon HTTP transport.

### `vt agent metrics append`

Append (or upsert by `sessionId`) a single session's token / cost telemetry into `<project>/.voicetree/agent_metrics.json`. Primarily invoked by the OTLP HTTP receiver itself; exposed via JSON-RPC so a CLI peer with a non-OTLP ingest path can write the same surface. No `vt` CLI wrapper is wired yet; invoke via the daemon HTTP transport.

**Parameters:**

- `sessionId` (RPC: sessionId): Session identifier (Claude Code `session.id` or Voicetree terminal id).
- `tokens.input` (RPC: tokens.input): Input tokens.
- `tokens.output` (RPC: tokens.output): Output tokens.
- `tokens.cacheRead` (RPC: tokens.cacheRead): Cache-read tokens (optional).
- `costUsd` (RPC: costUsd): Cost in USD.

### `vt project show`

Show the active project's resolved paths: project root, read paths, and write folder path.

Resolves the project (via `--project <path>` or by walking up from the current working directory for a `.voicetree/` marker), ensures its graph daemon is running (`ensureDaemon` auto-launches the daemon and discovers its port), and fetches the daemon’s `ProjectState` over `GET /project`.

**Output (human):** three lines — `Project Path: <projectRoot>`, a `Read Paths:` block (one `  - <path>` per read path, or `  (none)` when empty), and `Write Path: <writeFolderPath>`.

**Output (`--json`):** the raw `ProjectState` object `{projectRoot, readPaths, writeFolderPath}`, pretty-printed.

This verb is CLI-local: it is implemented by the CLI against `@vt/graph-db-client` and does NOT dispatch through the daemon tool catalog, so there is no JSON-RPC `vt`-tool wrapper for it (the corresponding daemon surface is the HTTP route `GET /project`).

**Parameters:**

- `--project VALUE`: Override the resolved project path. Accepts `--project <path>` or `--project=<path>`; the path must contain a `.voicetree/` directory. Defaults to the project detected by walking up from the current working directory.
- `--session VALUE`: Accepted (as `--session <id>` or `--session=<id>`) and validated to require a non-empty value, but currently a no-op: the project verbs resolve the daemon by project path only and never thread a session id into any request.
- `--json`: Emit the raw `ProjectState` object (`{projectRoot, readPaths, writeFolderPath}`) as pretty-printed JSON instead of the human-readable lines.
- `--help / -h`: Print the `vt project` usage and exit.

### `vt project set-write-path`

Set the project's write folder path — the folder where newly created nodes are written.

The `<path>` positional is resolved to an absolute path and must live inside the resolved project root. The containment check runs CLI-side and fails fast with a clear message before any daemon call, so an out-of-project write path (e.g. `/tmp`) is rejected and never reaches the daemon. On success the CLI ensures the project’s graph daemon is running, issues `PUT /project/write-path`, and re-reads the resulting state.

**Output (human):** a single line — `Write Path: <writeFolderPath>`.

**Output (`--json`):** `{"writeFolderPath": <path>}` — the write path only, NOT the full `ProjectState` that `vt project show --json` emits.

This verb is CLI-local: it is implemented by the CLI against `@vt/graph-db-client` and does NOT dispatch through the daemon tool catalog, so there is no JSON-RPC `vt`-tool wrapper for it (the corresponding daemon surface is the HTTP route `PUT /project/write-path`).

**Parameters:**

- `<path>` (positional): The new write folder path. Resolved to an absolute path and required to live inside the project root — containment is enforced CLI-side and fails fast before any daemon call.
- `--project VALUE`: Override the resolved project path. Accepts `--project <path>` or `--project=<path>`; the path must contain a `.voicetree/` directory. Defaults to the project detected by walking up from the current working directory.
- `--session VALUE`: Accepted (as `--session <id>` or `--session=<id>`) and validated to require a non-empty value, but currently a no-op: the project verbs resolve the daemon by project path only and never thread a session id into any request.
- `--json`: Emit `{"writeFolderPath": <path>}` as pretty-printed JSON instead of the human-readable `Write Path:` line.
- `--help / -h`: Print the `vt project` usage and exit.

### `vt session create`

Create a new graph session and print its id. Resolves the active project (from `--project` or by searching upward from the current directory for a `.voicetree/` marker), auto-ensures a graph-db daemon for that project, and issues `POST /sessions` to the daemon's REST surface. The daemon's session registry mints a fresh UUID and returns `{ sessionId }` with HTTP 201. By default prints `Session ID: <uuid>`; with `--json` (or when stdout is not a TTY) prints the raw `{ "sessionId": "<uuid>" }` JSON.

This verb is implemented entirely CLI-side over the graph-db-server HTTP REST API (`createSession` in graph-db-client). It is NOT a vt-daemon JSON-RPC tool and has no entry in the daemon tool catalog, so there are no `(RPC: …)` parameter mappings.

**Parameters:**

- `--project VALUE`: Override the resolved project root. Accepts `--project <path>` or `--project=<path>`; the path is resolved relative to the current directory and must contain a `.voicetree/` directory. When omitted, the CLI searches upward from the current directory for a `.voicetree/` marker.
- `--json`: Emit the raw `{ sessionId }` JSON instead of the `Session ID: <uuid>` human line. JSON output is also triggered automatically when stdout is not a TTY.

### `vt session delete`

Delete a graph session by id. Resolves the active project (from `--project` or upward `.voicetree/` discovery), auto-ensures the graph-db daemon, and issues `DELETE /sessions/<id>` to the daemon. The session registry removes the session and the daemon returns HTTP 204; a missing session returns 404 (surfaced as a CLI error). The `<id>` positional is required and exactly one id is accepted. On success prints `Deleted Session: <id>`; with `--json` (or non-TTY stdout) prints `{ "deleted": true, "sessionId": "<id>" }`.

Implemented CLI-side over the graph-db-server HTTP REST API (`deleteSession` in graph-db-client); not a vt-daemon JSON-RPC tool, so there are no `(RPC: …)` mappings.

**Parameters:**

- `<id>` (positional): Required. The session id (UUID) to delete. Exactly one positional id is accepted.
- `--project VALUE`: Override the resolved project root. Accepts `--project <path>` or `--project=<path>`; the path is resolved relative to the current directory and must contain a `.voicetree/` directory. When omitted, the CLI searches upward from the current directory for a `.voicetree/` marker.
- `--json`: Emit `{ deleted: true, sessionId }` JSON instead of the `Deleted Session: <id>` human line. Also triggered when stdout is not a TTY.

### `vt session show`

Show metadata for a graph session. Resolves the session id from the optional `[id]` positional, falling back to the `VT_SESSION` environment variable when no positional is supplied; if neither is set the command errors with guidance to pass `<id>` or set `VT_SESSION`. Resolves the active project (from `--project` or upward `.voicetree/` discovery), auto-ensures the graph-db daemon, and issues `GET /sessions/<id>`. Returns a SessionInfo record with four fields: `id` (UUID), `lastAccessedAt` (integer epoch timestamp), `folderStateSize` (number of folder-state entries for the active view; 0 when no project root is resolved), and `selectionSize` (count of selected node ids in the session). Note the field is `selectionSize` — there is no `collapseSetSize` field. Human output lists `Session ID`, `Last Accessed At`, `Folder State Size`, and `Selection Size`, one per line; `--json` (or non-TTY stdout) prints the raw SessionInfo JSON.

Implemented CLI-side over the graph-db-server HTTP REST API (`getSession` in graph-db-client); not a vt-daemon JSON-RPC tool, so there are no `(RPC: …)` mappings.

**Parameters:**

- `[id]` (positional): Optional session id (UUID) to show. When omitted, the id is read from the `VT_SESSION` environment variable. If neither the positional nor `VT_SESSION` is set, the command errors.
- `VT_SESSION` (env): Fallback source for the session id when no `[id]` positional is given. A non-empty `VT_SESSION` value is used as the session id for `show`.
- `--project VALUE`: Override the resolved project root. Accepts `--project <path>` or `--project=<path>`; the path is resolved relative to the current directory and must contain a `.voicetree/` directory. When omitted, the CLI searches upward from the current directory for a `.voicetree/` marker.
- `--json`: Emit the raw SessionInfo JSON (`{ id, lastAccessedAt, folderStateSize, selectionSize }`) instead of the four human-readable lines. Also triggered when stdout is not a TTY.

### `vt view list`

List all saved views for the project, marking the active one. Implemented locally in the CLI: it ensures a graph-db daemon for the resolved project and calls `client.views.list()`. Human output prints a `Views:` block where each entry shows `name (viewId)` prefixed with `*` for the active view and `-` otherwise (or `(none)` when there are no views); `--json` emits the full list of view records. Takes no positional arguments. This verb is CLI-local and does not dispatch to a vt-daemon JSON-RPC.

**Parameters:**

- `--project VALUE`: Override the resolved project path (also accepts `--project=VALUE`). Defaults to the active project for the current working directory; used to ensure and locate the graph-db daemon.
- `--json`: Emit the list of view records as JSON instead of the human-readable `Views:` list.

### `vt view show`

Show the active session's live view state and rendered graph. Implemented locally in the CLI: it ensures a graph-db daemon for the resolved project, resolves a session id (`--session`, then `$VT_SESSION`, otherwise auto-creates a session), and fetches the session live-state snapshot with node content omitted. In human mode it then renders the active view by title and prints the rendered graph output; with `--json` (or when JSON mode is active) it instead emits the full LiveStateSnapshot — graph node count, folder roots, active view, folder state, selection, pan, zoom, positions, and revision. Takes no positional arguments. This verb is CLI-local and does not dispatch to a vt-daemon JSON-RPC.

**Parameters:**

- `--project VALUE`: Override the resolved project path (also accepts `--project=VALUE`). Defaults to the active project for the current working directory; used to ensure and locate the graph-db daemon.
- `--session VALUE`: Session id to operate on. Must be a non-empty value not starting with `-`. Falls back to `$VT_SESSION`, and if neither is set a new session is auto-created.
- `--json`: Emit the LiveStateSnapshot as JSON instead of the rendered graph output.

### `vt view switch`

Activate a saved view by its id or name. Takes a single `<id-or-name>`; the CLI lists the views and resolves the target by matching `viewId` first, then `name`, erroring with `Unknown view: <target>` if neither matches. Implemented locally: ensure a graph-db daemon for the resolved project, resolve the view, then call `client.views.activate(viewId)`. Human output prints `Active View: <name> (<viewId>)`; `--json` emits the activated view record. This verb is CLI-local and does not dispatch to a vt-daemon JSON-RPC.

**Parameters:**

- `<id-or-name>` (positional): View to activate, matched against `viewId` first and then `name`. Required; an unmatched value is a validation error.
- `--project VALUE`: Override the resolved project path (also accepts `--project=VALUE`). Defaults to the active project for the current working directory; used to ensure and locate the graph-db daemon.
- `--json`: Emit the activated view record as JSON instead of the `Active View:` line.

### `vt view clone`

Clone an existing view under a new name. Takes exactly two positionals: `<src-id-or-name>` (resolved by matching `viewId` first, then `name`) and `<dst-name>` for the new view; fewer or more than two positionals is a validation error. Implemented locally: ensure a graph-db daemon for the resolved project, resolve the source view, then call `client.views.clone(sourceViewId, dstName)`. Human output prints `Cloned View: <name> (<viewId>)` for the new view; `--json` emits the cloned view record. This verb is CLI-local and does not dispatch to a vt-daemon JSON-RPC.

**Parameters:**

- `<src-id-or-name>` (positional): Source view to clone, matched against `viewId` first and then `name`. An unmatched value is a validation error.
- `<dst-name>` (positional): Name for the newly cloned view.
- `--project VALUE`: Override the resolved project path (also accepts `--project=VALUE`). Defaults to the active project for the current working directory; used to ensure and locate the graph-db daemon.
- `--json`: Emit the cloned view record as JSON instead of the `Cloned View:` line.

### `vt view delete`

Delete a saved view by its id or name. Takes a single `<id-or-name>`, resolved by matching `viewId` first and then `name` (an unmatched value errors with `Unknown view: <target>`). Implemented locally: ensure a graph-db daemon for the resolved project, resolve the view, then call `client.views.delete(viewId)`. Human output prints `Deleted View: <name> (<viewId>)` for the removed view; `--json` emits the deleted view record. This verb is CLI-local and does not dispatch to a vt-daemon JSON-RPC.

**Parameters:**

- `<id-or-name>` (positional): View to delete, matched against `viewId` first and then `name`. Required; an unmatched value is a validation error.
- `--project VALUE`: Override the resolved project path (also accepts `--project=VALUE`). Defaults to the active project for the current working directory; used to ensure and locate the graph-db daemon.
- `--json`: Emit the deleted view record as JSON instead of the `Deleted View:` line.

### `vt view set-folder`

Set the expand/collapse/hide state of a folder in the active session's live view. Takes a folder `<path>` (resolved to an absolute path before sending) and one of `expanded`, `collapsed`, or `hidden`. Implemented locally in the CLI: it ensures a graph-db daemon for the resolved project, resolves a session id (`--session`, then `$VT_SESSION`, otherwise auto-creates a session), then PATCHes `/sessions/:sessionId/folder-state/:path`. Human output prints `Folder State: <path> -> <state>`; `--json` echoes the request row. This verb is CLI-local and does not dispatch to a vt-daemon JSON-RPC.

**Parameters:**

- `<path>` (positional): Folder path whose view state to set. Resolved to an absolute path before sending.
- `<expanded|collapsed|hidden>` (positional): The folder view state to apply. Any other value is a validation error.
- `--project VALUE`: Override the resolved project path (also accepts `--project=VALUE`). Defaults to the active project for the current working directory; used to ensure and locate the graph-db daemon.
- `--session VALUE`: Session id to operate on. Must be a non-empty value not starting with `-`. Falls back to `$VT_SESSION`, and if neither is set a new session is auto-created.
- `--json`: Emit the result row as JSON instead of the human-readable `Folder State:` line.

### `vt view selection set`

Replace the active session's node selection with the given node ids. Takes one or more `<nodeIds...>` (at least one is required). On the wire `set` maps to selection mode `replace`. Implemented locally: ensure a graph-db daemon for the resolved project, resolve the session id (`--session`, then `$VT_SESSION`, otherwise auto-created), then POST `{mode: "replace", nodeIds}` to `/sessions/:sessionId/selection`. Human output prints the resulting `Selection:` list (or `(none)`); `--json` emits the full SelectionResponse. This verb is CLI-local and does not dispatch to a vt-daemon JSON-RPC.

**Parameters:**

- `<nodeIds...>` (positional, variadic): One or more node ids that become the new selection (mode `replace`). At least one is required.
- `--project VALUE`: Override the resolved project path (also accepts `--project=VALUE`). Defaults to the active project for the current working directory; used to ensure and locate the graph-db daemon.
- `--session VALUE`: Session id to operate on. Must be a non-empty value not starting with `-`. Falls back to `$VT_SESSION`, and if neither is set a new session is auto-created.
- `--json`: Emit the SelectionResponse as JSON instead of the human-readable `Selection:` list.

### `vt view selection add`

Add the given node ids to the active session's current selection. Takes one or more `<nodeIds...>` (at least one required) and sends selection mode `add`. Same local dispatch as `selection set`: ensure a graph-db daemon, resolve the session id, then POST `{mode: "add", nodeIds}` to `/sessions/:sessionId/selection`. Human output prints the updated `Selection:` list; `--json` emits the SelectionResponse. This verb is CLI-local and does not dispatch to a vt-daemon JSON-RPC.

**Parameters:**

- `<nodeIds...>` (positional, variadic): One or more node ids to add to the current selection (mode `add`). At least one is required.
- `--project VALUE`: Override the resolved project path (also accepts `--project=VALUE`). Defaults to the active project for the current working directory; used to ensure and locate the graph-db daemon.
- `--session VALUE`: Session id to operate on. Must be a non-empty value not starting with `-`. Falls back to `$VT_SESSION`, and if neither is set a new session is auto-created.
- `--json`: Emit the SelectionResponse as JSON instead of the human-readable `Selection:` list.

### `vt view selection remove`

Remove the given node ids from the active session's current selection. Takes one or more `<nodeIds...>` (at least one required) and sends selection mode `remove`. Same local dispatch as the other selection verbs: ensure a graph-db daemon, resolve the session id, then POST `{mode: "remove", nodeIds}` to `/sessions/:sessionId/selection`. Human output prints the updated `Selection:` list; `--json` emits the SelectionResponse. This verb is CLI-local and does not dispatch to a vt-daemon JSON-RPC.

**Parameters:**

- `<nodeIds...>` (positional, variadic): One or more node ids to remove from the current selection (mode `remove`). At least one is required.
- `--project VALUE`: Override the resolved project path (also accepts `--project=VALUE`). Defaults to the active project for the current working directory; used to ensure and locate the graph-db daemon.
- `--session VALUE`: Session id to operate on. Must be a non-empty value not starting with `-`. Falls back to `$VT_SESSION`, and if neither is set a new session is auto-created.
- `--json`: Emit the SelectionResponse as JSON instead of the human-readable `Selection:` list.

### `vt view layout set-pan`

Set the camera pan offset of the active session's live view. Takes `<x>` and `<y>`, each of which must parse to a finite number (rejected otherwise). Implemented locally: ensure a graph-db daemon for the resolved project, resolve the session id, then PUT `{pan: {x, y}}` to `/sessions/:sessionId/layout`. Human output prints the full layout (`Pan`, `Zoom`, and any saved `Positions`); `--json` emits the LayoutResponse. This verb is CLI-local and does not dispatch to a vt-daemon JSON-RPC.

**Parameters:**

- `<x>` (positional): Pan x offset. Must parse to a finite number.
- `<y>` (positional): Pan y offset. Must parse to a finite number.
- `--project VALUE`: Override the resolved project path (also accepts `--project=VALUE`). Defaults to the active project for the current working directory; used to ensure and locate the graph-db daemon.
- `--session VALUE`: Session id to operate on. Must be a non-empty value not starting with `-`. Falls back to `$VT_SESSION`, and if neither is set a new session is auto-created.
- `--json`: Emit the LayoutResponse as JSON instead of the human-readable layout.

### `vt view layout set-zoom`

Set the camera zoom level of the active session's live view. Takes a single `<zoom>` value that must parse to a finite number. Implemented locally: ensure a graph-db daemon, resolve the session id, then PUT `{zoom}` to `/sessions/:sessionId/layout`. Human output prints the full layout (`Pan`, `Zoom`, `Positions`); `--json` emits the LayoutResponse. This verb is CLI-local and does not dispatch to a vt-daemon JSON-RPC.

**Parameters:**

- `<zoom>` (positional): Zoom level. Must parse to a finite number.
- `--project VALUE`: Override the resolved project path (also accepts `--project=VALUE`). Defaults to the active project for the current working directory; used to ensure and locate the graph-db daemon.
- `--session VALUE`: Session id to operate on. Must be a non-empty value not starting with `-`. Falls back to `$VT_SESSION`, and if neither is set a new session is auto-created.
- `--json`: Emit the LayoutResponse as JSON instead of the human-readable layout.

### `vt view layout set-positions`

Set explicit node positions in the active session's live view from a JSON file. Takes a single `<positions-json-file>` path (resolved to absolute) whose contents must be a JSON object mapping each node id to `{x, y}`, where both coordinates are finite numbers; malformed JSON, a non-object payload, or an invalid coordinate fails with a validation error naming the offending node. Implemented locally: read and validate the file, ensure the graph-db daemon, resolve the session id, then PUT `{positions}` to `/sessions/:sessionId/layout`. Human output prints the full layout including the applied `Positions`; `--json` emits the LayoutResponse. This verb is CLI-local and does not dispatch to a vt-daemon JSON-RPC.

**Parameters:**

- `<positions-json-file>` (positional): Path (resolved to absolute) to a JSON file mapping each node id to `{x, y}` with finite coordinates. Invalid JSON, a non-object payload, or a bad coordinate is rejected with a validation error naming the node.
- `--project VALUE`: Override the resolved project path (also accepts `--project=VALUE`). Defaults to the active project for the current working directory; used to ensure and locate the graph-db daemon.
- `--session VALUE`: Session id to operate on. Must be a non-empty value not starting with `-`. Falls back to `$VT_SESSION`, and if neither is set a new session is auto-created.
- `--json`: Emit the LayoutResponse as JSON instead of the human-readable layout.

### `vt graph live view`

Render the running app's live graph to the terminal as ASCII (default) or Mermaid. Reads the daemon-owned SerializedState over JSON-RPC (`vt_get_live_state`) and renders the projected view locally via `renderProjectedLiveView`.

Before rendering, any `--collapse <folder>` flags are dispatched as `SetFolderState` (state `collapsed`) commands and any `--select <id>` flags as a single `Select` command — these mutate the live session's view state and are best-effort (a failed collapse/select logs to stderr but does not block rendering). When no roots are loaded in the live state, prints `(no loaded roots in live state)`.

In ASCII format only, a trailing summary line is appended: `<N> nodes — <F> folder nodes, <V> virtual folders, <C> files`. Mermaid format omits the summary.

This verb is CLI-local and does not dispatch to a dedicated daemon RPC; it reads live state via `vt_get_live_state` (plus best-effort `vt_dispatch_live_command` for `--collapse`/`--select`). Requires a running daemon. Endpoint resolution is via the live transport: `$VOICETREE_DAEMON_URL` (per-process override) → cwd up-walk to the enclosing project → `$VOICETREE_PROJECT_PATH`; surfaces `DaemonUnreachable` / `DaemonAuthRequired` when none is reachable.

**Parameters:**

- `--mermaid | --ascii`: Render format. `--ascii` (default) emits a tree plus a node-count summary line; `--mermaid` emits Mermaid source with no summary.
- `--collapse VALUE`: Collapse the named folder in the live view before rendering (repeatable). Dispatched as a `SetFolderState` (collapsed) command on viewId `main`; best-effort — a failure logs to stderr and does not block rendering.
- `--select VALUE`: Select the named node id in the live view before rendering (repeatable). All ids are dispatched together as a single `Select` command; best-effort.
- `--project VALUE`: Override the target project path. Defaults to the live-transport-resolved project (`$VOICETREE_DAEMON_URL` → cwd up-walk → `$VOICETREE_PROJECT_PATH`). Accepts either `--project <path>` or `--project=<path>`.

### `vt graph live add-node`

Add a node to the live graph by file path. Returns the resulting Delta as JSON.

Builds an `AddNode` SerializedCommand from `--file` (resolved to an absolute path and used as the node id) and dispatches it via the `vt graph live apply` path (`vt_dispatch_live_command`). The node body defaults to a `# <basename>` heading (basename of `--file` with any `.md` extension stripped) unless `--label` is given. Position is optional via `--x`/`--y`, which must be supplied together — supplying only one fails; when both are omitted the node has no fixed position.

After dispatch, the CLI persists the change to disk (reads the live graph node set before and after, then writes the corresponding markdown) so the on-disk graph and the live session stay in sync.

This verb is CLI-local and does not dispatch to a dedicated daemon RPC of its own — it builds the SerializedCommand for you and routes it through `vt_dispatch_live_command`. A relative `--file` is resolved against the caller's working directory. Requires a running daemon.

**Parameters:**

- `--file VALUE`: Required. File path for the new node; resolved to an absolute path and used as the node id.
- `--label VALUE`: Optional node body text. Defaults to a `# <basename>` heading derived from `--file` (with any `.md` extension stripped).
- `--x VALUE`: Optional x coordinate (number). Must be supplied together with `--y`; supplying only one fails.
- `--y VALUE`: Optional y coordinate (number). Must be supplied together with `--x`.
- `--project VALUE`: Override the target project path. Defaults to the live-transport-resolved project (`$VOICETREE_DAEMON_URL` → cwd up-walk → `$VOICETREE_PROJECT_PATH`).

### `vt graph live rm-node`

Remove a node from the live graph by file path. Returns the resulting Delta as JSON.

Builds a `RemoveNode` SerializedCommand whose `id` is the resolved absolute path of `--file`, dispatches it via the `vt graph live apply` path (`vt_dispatch_live_command`), then persists the change to disk so the on-disk graph matches the live session.

This verb is CLI-local and does not dispatch to a dedicated daemon RPC of its own — it builds the SerializedCommand for you and routes it through `vt_dispatch_live_command`. A relative `--file` is resolved against the caller's working directory. Requires a running daemon.

**Parameters:**

- `--file VALUE`: Required. File path of the node to remove; resolved to an absolute path and used as the `RemoveNode` id.
- `--project VALUE`: Override the target project path. Defaults to the live-transport-resolved project (`$VOICETREE_DAEMON_URL` → cwd up-walk → `$VOICETREE_PROJECT_PATH`).

### `vt graph live add-edge`

Add an edge to the live graph between two nodes. Returns the resulting Delta as JSON.

Builds an `AddEdge` SerializedCommand from `--src-file` (the edge `source`, resolved to an absolute path) to `--tgt-file` (the edge `targetId`, resolved to an absolute path), with an optional `--label` (defaults to the empty string). Dispatches via the `vt graph live apply` path (`vt_dispatch_live_command`), then persists the change to disk.

This verb is CLI-local and does not dispatch to a dedicated daemon RPC of its own — it builds the SerializedCommand for you and routes it through `vt_dispatch_live_command`. Relative `--src-file` / `--tgt-file` are resolved against the caller's working directory. Requires a running daemon.

**Parameters:**

- `--src-file VALUE`: Required. Source node file path; resolved to an absolute path (the edge `source`).
- `--tgt-file VALUE`: Required. Target node file path; resolved to an absolute path (the edge `targetId`).
- `--label VALUE`: Optional edge label. Defaults to the empty string.
- `--project VALUE`: Override the target project path. Defaults to the live-transport-resolved project (`$VOICETREE_DAEMON_URL` → cwd up-walk → `$VOICETREE_PROJECT_PATH`).

### `vt graph live rm-edge`

Remove an edge from the live graph between two nodes. Returns the resulting Delta as JSON.

Builds a `RemoveEdge` SerializedCommand from `--src-file` (the edge `source`) to `--tgt-file` (the `targetId`), both resolved to absolute paths, dispatches via the `vt graph live apply` path (`vt_dispatch_live_command`), then persists the change to disk.

This verb is CLI-local and does not dispatch to a dedicated daemon RPC of its own — it builds the SerializedCommand for you and routes it through `vt_dispatch_live_command`. Relative `--src-file` / `--tgt-file` are resolved against the caller's working directory. Requires a running daemon.

**Parameters:**

- `--src-file VALUE`: Required. Source node file path; resolved to an absolute path (the edge `source`).
- `--tgt-file VALUE`: Required. Target node file path; resolved to an absolute path (the edge `targetId`).
- `--project VALUE`: Override the target project path. Defaults to the live-transport-resolved project (`$VOICETREE_DAEMON_URL` → cwd up-walk → `$VOICETREE_PROJECT_PATH`).

### `vt graph live mv-node`

Move a node to a new position in the live graph. Returns the resulting Delta as JSON.

Builds a `Move` SerializedCommand whose `id` is the resolved absolute path of `--file` and whose target is `{x, y}`. Both `--x` and `--y` are required and parsed as numbers. Dispatches via the `vt graph live apply` path (`vt_dispatch_live_command`), then persists the new position to disk.

This verb is CLI-local and does not dispatch to a dedicated daemon RPC of its own — it builds the SerializedCommand for you and routes it through `vt_dispatch_live_command`. A relative `--file` is resolved against the caller's working directory. Requires a running daemon.

**Parameters:**

- `--file VALUE`: Required. File path of the node to move; resolved to an absolute path and used as the `Move` id.
- `--x VALUE`: Required. New x coordinate (parsed as a number).
- `--y VALUE`: Required. New y coordinate (parsed as a number).
- `--project VALUE`: Override the target project path. Defaults to the live-transport-resolved project (`$VOICETREE_DAEMON_URL` → cwd up-walk → `$VOICETREE_PROJECT_PATH`).

### `vt graph live focus`

Render the N-hop ego graph centered on a node in the live graph.

Fetches the live SerializedState (`vt_get_live_state`), then renders the ego subgraph within `--hops` of the center node (default 1 hop) using undirected adjacency (a node's outgoing edges plus its incoming edges). Output leads with a `Focus: <node> (<hops>-hop ego graph, <N> nodes)` header, then groups the center's direct `Incoming:` and `Outgoing:` edges, then lists any further `Also reachable:` nodes within the hop budget. Node ids are shown as basenames.

**Exit-code semantics.** A valid query (center node exists) renders to stdout and exits 0. An unknown / typo'd center node id writes `node not found: <id>` to stderr and exits non-zero (code 3, `EGO_NOT_FOUND_EXIT_CODE`), distinguishing a caller typo from a valid empty result.

This verb is CLI-local and does not dispatch to a dedicated daemon RPC; it only reads live state via `vt_get_live_state`. Requires a running daemon. Endpoint resolution is via the live transport: `$VOICETREE_DAEMON_URL` (per-process override) → cwd up-walk to the enclosing project → `$VOICETREE_PROJECT_PATH`.

**Parameters:**

- `<node>` (positional): Center node id of the ego graph. An unknown / typo'd id writes `node not found: <id>` to stderr and exits non-zero (code 3).
- `--hops VALUE`: Ego-graph radius in undirected hops (default 1). Accepts either `--hops N` or `--hops=N`.
- `--project VALUE`: Override the target project path. Defaults to the live-transport-resolved project (`$VOICETREE_DAEMON_URL` → cwd up-walk → `$VOICETREE_PROJECT_PATH`). Accepts either `--project <path>` or `--project=<path>`.

### `vt graph live neighbors`

Render the N-hop neighborhood of a node in the live graph, excluding the center.

Fetches the live SerializedState (`vt_get_live_state`), then lists every node within `--hops` of the target (default 1 hop) over undirected adjacency, omitting the target itself. Output is a header (`Neighbors of <node> (<hops>-hop): <count> found`) followed by the neighbor basenames.

**Exit-code semantics.** A valid query (target node exists) renders to stdout and exits 0. An unknown / typo'd node id writes `node not found: <id>` to stderr and exits non-zero (code 3, `EGO_NOT_FOUND_EXIT_CODE`).

This verb is CLI-local and does not dispatch to a dedicated daemon RPC; it only reads live state via `vt_get_live_state`. Requires a running daemon. Endpoint resolution is via the live transport (`$VOICETREE_DAEMON_URL` → cwd up-walk → `$VOICETREE_PROJECT_PATH`).

**Parameters:**

- `<node>` (positional): Target node id whose neighborhood is rendered. An unknown / typo'd id writes `node not found: <id>` to stderr and exits non-zero (code 3).
- `--hops VALUE`: Neighborhood radius in undirected hops (default 1). Accepts either `--hops N` or `--hops=N`.
- `--project VALUE`: Override the target project path. Defaults to the live-transport-resolved project (`$VOICETREE_DAEMON_URL` → cwd up-walk → `$VOICETREE_PROJECT_PATH`). Accepts either `--project <path>` or `--project=<path>`.

### `vt graph live path`

Render the shortest undirected path between two nodes in the live graph.

Fetches the live SerializedState (`vt_get_live_state`), then runs BFS for the shortest undirected path from `<a>` to `<b>`. On success prints the path as `a → … → b` (basenames) and exits 0. When both endpoints exist but are not connected, prints `no path from <a> to <b>` to stdout and exits 0 — a genuine no-path is a valid result, not an error.

**Exit-code semantics.** If either endpoint is an unknown / typo'd node id, writes `node not found: <ids>` to stderr and exits non-zero (code 3, `EGO_NOT_FOUND_EXIT_CODE`). This deliberately distinguishes a typo (caller error) from a real disconnected pair (valid no-path); the underlying BFS returns null for both cases, so `renderPath` checks endpoint membership before running BFS.

This verb is CLI-local and does not dispatch to a dedicated daemon RPC; it only reads live state via `vt_get_live_state`. It takes no `--hops` flag (BFS always finds the shortest path). Requires a running daemon. Endpoint resolution is via the live transport (`$VOICETREE_DAEMON_URL` → cwd up-walk → `$VOICETREE_PROJECT_PATH`).

**Parameters:**

- `<a>` (positional): Start node id of the path query.
- `<b>` (positional): End node id of the path query. If either `<a>` or `<b>` is an unknown / typo'd id, writes `node not found: <ids>` to stderr and exits non-zero (code 3); a real disconnected pair prints `no path` and exits 0.
- `--project VALUE`: Override the target project path. Defaults to the live-transport-resolved project (`$VOICETREE_DAEMON_URL` → cwd up-walk → `$VOICETREE_PROJECT_PATH`). Accepts either `--project <path>` or `--project=<path>`.

### `vt graph index`

Build a local semantic search index for a project — not yet available.

This is an honest stub. The backing semantic-search index is unimplemented: the backend `buildIndex` only logs a TODO and writes no index to disk. Rather than reporting a fake success or printing a non-existent index path, the CLI parses and validates its argument for early failure, then exits non-zero with an explicit "not yet available" message — so an agent can tell "unimplemented" apart from "no matches".

This verb is CLI-local and does not dispatch to a daemon RPC. When the semantic index lands this stub will be replaced; until then, use the top-level `vt search` command for the daemon-backed (also currently stubbed) search surface.

**Parameters:**

- `<project-root>` (positional): Absolute or relative path to the project whose graph would be indexed. Exactly one positional is required (no flags are accepted). Validated for early failure but currently unused — the command always exits non-zero with a "not yet available" error and builds no index.

### `vt graph search`

Query a local semantic search index for a project — not yet available.

This is an honest stub. The backing semantic-search index is unimplemented: the backend `search` returns an empty array for every query regardless of project contents, so emitting `hits: []` would be indistinguishable from a genuine no-match result. Instead the CLI parses and validates its arguments for early failure, then exits non-zero with an explicit "not yet available" message.

This verb is CLI-local and does not dispatch to a daemon RPC. For the daemon-backed search surface use the top-level `vt search` command (itself stubbed until vector search is wired up). Note that `vt graph search` is a distinct local-index stub — it is not the same verb as `vt search`.

**Parameters:**

- `<project-root>` (positional): Absolute or relative path to the project to search (the first positional). Validated but currently unused.
- `<query>...` (positional): Natural-language query. All remaining positional tokens after the project root are joined with spaces. At least one query token is required (the command needs two or more positionals total). Validated but currently unused.
- `--top-k VALUE`: Maximum number of results to return (default `10`). Must be a positive integer. Parsed but currently unused — the command always fails with a "not yet available" error.

### `vt graph group`

Group existing node files into a folder and rewrite every reference to them.

Creates the target folder if it does not exist (recursively), moves each named node file into it (preserving basenames), then scans every `.md` file under the project root and rewrites the `[[wikilink]]`, `~/brain/...`, absolute-path, and bare relative-path references that point at the moved files so no link breaks.

This verb is CLI-local and does not dispatch to a daemon RPC — it edits files directly on disk. The `.voicetree/` and `node_modules/` subtrees are skipped during the reference scan. It fails before moving anything if a source is missing, is not a file, or a destination basename already exists in the target folder. Use `--dry-run` to preview the folder creation, moves, and reference rewrites without touching disk.

**Parameters:**

- `<folder-path>` (positional): Target folder to group the node files into; created recursively if absent. Accepts `~/brain/<rel>`, `~/<home-rel>`, an absolute path, or a path relative to the resolved project root.
- `<node...>` (positional): One or more node files to move into the folder. At least one node is required (the folder plus one or more nodes — i.e. two or more positionals total). Each must resolve to an existing file.
- `--dry-run`: Preview the folder creation, file moves, and reference rewrites without writing to disk.
- `--project VALUE`: Project root used to resolve relative inputs and to scope the reference-rewrite scan. Defaults to `~/brain`.

### `vt graph lint`

Lint a graph folder for structural complexity violations and warnings.

Takes a consistent snapshot of the named folder's nodes from the running graph daemon (so unsaved in-memory edits are reflected), materializes it to a temporary directory, and runs the structural rules in `@vt/graph-tools`: node arity / attention-item caps, high-coupling detection, and wide cross-reference detection, plus orphan and depth metrics.

Prints a human-readable report by default; with the global `--json` flag it emits the machine-readable lint report instead. This verb is CLI-local and does not dispatch to a daemon RPC; the daemon connection used for the snapshot is established automatically from the folder's resolved project, so there is deliberately NO `--project` or `--port` flag on this verb.

**Parameters:**

- `<folder-path>` (positional): Absolute or relative folder whose graph is linted (required). Resolved to an absolute path before the daemon snapshot is materialized.
- `--max-arity VALUE`: Maximum allowed node arity. Sets BOTH the arity cap and the max-attention-items cap to this value (they share one knob on the CLI).
- `--coupling-threshold VALUE`: Degree at or above which a node is flagged as highly coupled.
- `--cross-ref-threshold VALUE`: Cross-reference count at or above which a node is flagged as a wide cross-reference hub.

### `vt graph rename`

Rename a single node file and update every reference to it.

Renames one file from its old path to a new path, then scans every `.md` file under the project root and rewrites `[[wikilink]]`, `~/brain/...`, absolute-path, and bare relative-path references so links stay intact. Files only — passing a folder is rejected.

This verb is CLI-local and does not dispatch to a daemon RPC. The `.voicetree/` and `node_modules/` subtrees are skipped during the reference scan. It fails before renaming if the source is missing, the destination already exists, the target directory does not exist, or source and destination are the same path. Use `--dry-run` to preview.

**Parameters:**

- `<old-path>` (positional): Existing node file to rename. Must be a file (folders are rejected). Accepts `~/brain/<rel>`, `~/<home-rel>`, an absolute path, or a path relative to the resolved project root.
- `<new-path>` (positional): New path/name for the file. Its parent directory must already exist and the destination must not already exist.
- `--dry-run`: Preview the rename and reference rewrites without writing to disk.
- `--project VALUE`: Project root used to resolve relative inputs and to scope the reference-rewrite scan. Defaults to `~/brain`.

### `vt graph mv`

Move a node file or an entire folder and update every reference to it.

For a file it moves the single file; for a folder it moves all contained `.md` files (preserving their relative layout) and rewrites every `[[wikilink]]`, `~/brain/...`, absolute-path, and bare relative-path reference across the project so links stay intact. Non-Markdown files inside a moved folder are relocated too but are reported as a warning, since their references are not rewritten.

This verb is CLI-local and does not dispatch to a daemon RPC. The `.voicetree/` and `node_modules/` subtrees are skipped during the reference scan. It fails before moving if the source is missing, the destination already exists, the target directory does not exist, source equals destination, or the destination is inside the source folder. Use `--dry-run` to preview.

**Parameters:**

- `<source-path>` (positional): Existing file or folder to move. Accepts `~/brain/<rel>`, `~/<home-rel>`, an absolute path, or a path relative to the resolved project root.
- `<dest-path>` (positional): Destination path. Its parent directory must already exist and the destination must not already exist; a folder destination may not be a descendant of the source.
- `--dry-run`: Preview the move(s) and reference rewrites without writing to disk.
- `--project VALUE`: Project root used to resolve relative inputs and to scope the reference-rewrite scan. Defaults to `~/brain`.

### `vt debug`

Headful/CDP debugger for a running Voicetree dev (Electron) session — inspect, drive, and snapshot the live UI from the CLI.

This verb is CLI-local: it does not dispatch to a daemon RPC. `vt debug <command> [args]` shells out to the `vt-debug` bin (`packages/libraries/graph-tools/bin/vt-debug.ts`) via `runDebugCommand`; every argument is passed through unchanged with a 60s subprocess timeout. Each subcommand lives in `src/commands/<area>/*.ts` and self-registers into `commandRegistry` via `registerCommand`. These are NOT daemon-tool-catalog verbs — they connect over the Chrome DevTools Protocol (CDP) to a live, unpackaged Electron dev session, so they have no JSON-RPC binding and are not exposed through the daemon. Functional verification of CDP behavior is deferred (headful-only); this documentation is authored from the bin help text and the command handlers.

**Two-token aliases.** `vt debug folder aspect`, `vt debug folder materialize`, `vt debug node click`, `vt debug page ax`, and `vt debug why blank` are collapsed to their hyphenated registry keys by `resolveCommand` (it tries `<first>-<second>` against the registry first), so either spelling works.

**Instance selection** (shared across all CDP-backed commands): a session is chosen by `resolveDebugInstance` from the registered dev instances (instance JSON files under the Application Support `VoiceTree/instances` dir, filtered to live PIDs). Filter precedence is `--port` > `--pid` > `--project` > single-live > ambiguous. When an explicit selector is given the target's CDP `/json/version` endpoint must be live or the command fails with exit 2.

**Auto-launch.** With NO selector and an existing dev session, `vt-debug` does not guess — it returns exit 2 and asks you to pass `--port <N>` to reuse it or `--new` to launch fresh. With no session at all it allocates a free localhost port and auto-launches `npm --prefix webapp run electron:debug` (env `ENABLE_PLAYWRIGHT_DEBUG=1`, `PLAYWRIGHT_MCP_CDP_ENDPOINT=http://127.0.0.1:<port>`, `VT_DEBUG_AUTOLAUNCHED=1`), waits up to 30s for the session to register a live CDP endpoint, and prints the chosen port to stderr (`re-run with --port <N> for future commands`). Only unpackaged dev sessions with a live `/json/version` endpoint are considered; packaged production builds are ignored.

**Help.** `vt debug` / `vt debug --help` / `vt debug -h` / `vt debug help` print the top-level usage (shared selector flags, auto-launch notes, and the sorted command list) and exit 0. `vt debug <command> --help` (or `-h`) short-circuits BEFORE dispatch — it prints that command's usage and the shared selector flags and exits 0 WITHOUT invoking the handler, so help never triggers `resolveDebugInstance` and therefore never auto-launches Electron.

**Output.** Results are emitted as a single JSON `Response` object on stdout (`{ok, command, ...}`); errors print `{ok:false, command, error, hint?}` on stderr. Exit codes: 0 ok, 1 command failure, 2 instance discovery/selection, 3 CDP connect/eval failure.

**Parameters:**

- `--port / --cdpPort VALUE`: Shared selector. Target a specific registered dev session by its CDP port, matched against the instance's `cdpPort`. `--cdpPort` is a backward-compatible alias for `--port`. Also accepts the `--port=N` / `--cdpPort=N` form.
- `--pid VALUE`: Shared selector. Target a specific registered dev process by pid. Also accepts the `--pid=N` form.
- `--project VALUE`: Shared selector. Target a registered dev session whose resolved `projectRoot` matches the given path (prefix match). Also accepts the `--project=PATH` form.
- `--new`: Shared selector. Launch a fresh dev session even if one already exists (preferred when testing new code). Accepted by attach, capture, drift, eval, keyboard, node, page-ax, screenshot, and why-blank; NOT accepted by ls, log, folder-aspect, folder-materialize, node-click, or run.
- `--help / -h`: On the bare `vt debug` prints top-level usage and exits 0. After a subcommand (`vt debug <command> --help`) prints that command's usage plus the shared selector flags and exits 0 WITHOUT dispatching the handler, so it never auto-launches Electron.

### `vt debug attach`

Attach to a running dev session over CDP and report its primary page title, URL, tab count, pid, and CDP port.

CLI-local; does not dispatch to a daemon RPC. Resolves a dev instance (shared selector flags), opens a Playwright CDP session, reads the first page, and returns `{pageTitle, url, tabs, pid, cdpPort}`. This is the connectivity smoke test for the debugger: if CDP connect fails it hints `Is ENABLE_PLAYWRIGHT_DEBUG=1 set and Voicetree running in dev mode?` and exits 3. Takes no positional arguments.

**Parameters:**

- `--port / --cdpPort VALUE`: Shared selector. Target a specific registered dev session by its CDP port, matched against the instance's `cdpPort`. `--cdpPort` is a backward-compatible alias for `--port`. Also accepts the `--port=N` / `--cdpPort=N` form.
- `--pid VALUE`: Shared selector. Target a specific registered dev process by pid. Also accepts the `--pid=N` form.
- `--project VALUE`: Shared selector. Target a registered dev session whose resolved `projectRoot` matches the given path (prefix match). Also accepts the `--project=PATH` form.
- `--new`: Shared selector. Launch a fresh dev session even if one already exists (preferred when testing new code). Accepted by attach, capture, drift, eval, keyboard, node, page-ax, screenshot, and why-blank; NOT accepted by ls, log, folder-aspect, folder-materialize, node-click, or run.

### `vt debug capture`

Capture a full live-state snapshot (serialized daemon state + Cytoscape dump + focused element) of a dev session to a JSON file.

CLI-local; does not dispatch to a daemon RPC. Connects over CDP and concurrently reads the daemon live state (via the project's live transport), the renderer's `window.__vtDebug__.cy()` Cytoscape dump, and the focused DOM element. Writes a `Snapshot` (`{state, cyDump, focused, selection, zoom, pan, timestamp}`) as pretty JSON and returns `{path, timestamp}`. Output path precedence: `--out PATH` (absolute-resolved) wins; else `--tag NAME` writes `/tmp/vt-debug/captures/<sanitized-tag>.json`; else a timestamped file under `/tmp/vt-debug/captures/`. Pairs with `vt debug diff`.

**Parameters:**

- `--tag VALUE`: Write the snapshot to `/tmp/vt-debug/captures/<sanitized-tag>.json` (non-`[a-zA-Z0-9._-]` runs collapsed to `-`). Ignored when `--out` is given. Also accepts `--tag=NAME`.
- `-o / --out VALUE`: Absolute-resolved output path for the snapshot JSON. Overrides `--tag` and the default timestamped path. Also accepts `--out=PATH`.
- `--port / --cdpPort VALUE`: Shared selector. Target a specific registered dev session by its CDP port, matched against the instance's `cdpPort`. `--cdpPort` is a backward-compatible alias for `--port`. Also accepts the `--port=N` / `--cdpPort=N` form.
- `--pid VALUE`: Shared selector. Target a specific registered dev process by pid. Also accepts the `--pid=N` form.
- `--project VALUE`: Shared selector. Target a registered dev session whose resolved `projectRoot` matches the given path (prefix match). Also accepts the `--project=PATH` form.
- `--new`: Shared selector. Launch a fresh dev session even if one already exists (preferred when testing new code). Accepted by attach, capture, drift, eval, keyboard, node, page-ax, screenshot, and why-blank; NOT accepted by ls, log, folder-aspect, folder-materialize, node-click, or run.

### `vt debug diff`

Diff two previously captured snapshots and report what changed between them (no live app required).

CLI-local; does not dispatch to a daemon RPC. This is the only debug verb that never touches CDP — it is a pure file operation, so it runs without a live dev session and accepts no selector flags. Reads two snapshots and returns `diffCaptures(a, b)`. Each positional resolves first as a direct path, then as a tagged capture under `/tmp/vt-debug/captures/<name>.json` (the `.json` suffix is optional). Requires exactly two positionals; with fewer it errors `usage: diff <snapshot-a> <snapshot-b>`. A missing snapshot errors `snapshot not found: <input>`.

**Parameters:**

- `<snapshot-a>` (positional): First snapshot: a direct path, or a tag resolved under `/tmp/vt-debug/captures/<name>.json` (`.json` optional). Required.
- `<snapshot-b>` (positional): Second snapshot, resolved the same way. Required. No CDP connection or selector flags — pure file diff.

### `vt debug drift`

Detect drift between the daemon's live state, the projected Cytoscape dump, and what Cytoscape actually rendered in the dev session.

CLI-local; does not dispatch to a daemon RPC. Connects over CDP, fetches the daemon live state and the rendered `window.__vtDebug__.cy()` dump, projects the live state to a Cytoscape dump, and computes drift across the three. `--deep` additionally snapshots each node's on-disk file content (read from the node id, which is its absolute file path) so the diff can compare filesystem vs. state. Accepts the shared selector flags including `--new`; any unrecognized argument errors `unknown arg: <arg>`.

**Parameters:**

- `--deep`: Also snapshot each node's on-disk file content so the diff compares filesystem vs. live state, not just projected vs. rendered.
- `--port / --cdpPort VALUE`: Shared selector. Target a specific registered dev session by its CDP port, matched against the instance's `cdpPort`. `--cdpPort` is a backward-compatible alias for `--port`. Also accepts the `--port=N` / `--cdpPort=N` form.
- `--pid VALUE`: Shared selector. Target a specific registered dev process by pid. Also accepts the `--pid=N` form.
- `--project VALUE`: Shared selector. Target a registered dev session whose resolved `projectRoot` matches the given path (prefix match). Also accepts the `--project=PATH` form.
- `--new`: Shared selector. Launch a fresh dev session even if one already exists (preferred when testing new code). Accepted by attach, capture, drift, eval, keyboard, node, page-ax, screenshot, and why-blank; NOT accepted by ls, log, folder-aspect, folder-materialize, node-click, or run.

### `vt debug eval`

Evaluate an arbitrary JavaScript expression in the dev session's renderer and return a deeply-serialized result.

CLI-local; does not dispatch to a daemon RPC. Connects over CDP and runs the given JS in the first page (awaited, so async expressions resolve). The result is walked by an injected serializer that handles circular refs (`[Circular]`), DOM nodes (`<tag#id.class>`), Date/RegExp/Error/Map/Set, and class instances. The expression is all trailing positional tokens joined by spaces; use a leading `--` to pass an expression that itself starts with `--`. Accepts the shared selector flags including `--new`. A missing expression errors with a usage hint; an unknown flag before `--` errors `unknown argument: <arg>` (hint: `use -- before expressions that start with --`).

**Parameters:**

- `<js>...` (positional): JavaScript expression evaluated in the renderer; all trailing positional tokens are joined with spaces and awaited. Required.
- `--`: Marks the end of flags; everything after is treated as the expression. Use when the expression itself starts with `--`.
- `--port / --cdpPort VALUE`: Shared selector. Target a specific registered dev session by its CDP port, matched against the instance's `cdpPort`. `--cdpPort` is a backward-compatible alias for `--port`. Also accepts the `--port=N` / `--cdpPort=N` form.
- `--pid VALUE`: Shared selector. Target a specific registered dev process by pid. Also accepts the `--pid=N` form.
- `--project VALUE`: Shared selector. Target a registered dev session whose resolved `projectRoot` matches the given path (prefix match). Also accepts the `--project=PATH` form.
- `--new`: Shared selector. Launch a fresh dev session even if one already exists (preferred when testing new code). Accepted by attach, capture, drift, eval, keyboard, node, page-ax, screenshot, and why-blank; NOT accepted by ls, log, folder-aspect, folder-materialize, node-click, or run.

### `vt debug folder-aspect`

Compute folder-aspect-ratio diagnostics from the dev session's rendered Cytoscape dump (which folders are too cramped or sprawling).

CLI-local; does not dispatch to a daemon RPC. Connects over CDP, reads the rendered `window.__vtDebug__.cy()` dump, and runs `computeFolderAspects`. `--threshold N` (default 3, accepts a float) sets the aspect-ratio threshold; `--min-children N` (default 3, integer) sets the minimum child count for a folder to be considered. Accepts `--port`/`--cdpPort`/`--pid`/`--project` but NOT `--new` (it resolves an existing instance without forcing a fresh launch). Also reachable as the two-token form `vt debug folder aspect`. Unknown args error with the supported-flags hint.

**Parameters:**

- `--threshold VALUE`: Aspect-ratio threshold (float, default 3). Also accepts `--threshold=N`.
- `--min-children VALUE`: Minimum child count for a folder to be considered (integer, default 3). Also accepts `--min-children=N`.
- `--port / --cdpPort VALUE`: Shared selector. Target a specific registered dev session by its CDP port, matched against the instance's `cdpPort`. `--cdpPort` is a backward-compatible alias for `--port`. Also accepts the `--port=N` / `--cdpPort=N` form.
- `--pid VALUE`: Shared selector. Target a specific registered dev process by pid. Also accepts the `--pid=N` form.
- `--project VALUE`: Shared selector. Target a registered dev session whose resolved `projectRoot` matches the given path (prefix match). Also accepts the `--project=PATH` form.

### `vt debug folder-materialize`

Drive the dev session to materialize a folder's editor — seed a scratch fixture, tap the folder, type a marker, and probe the resulting DOM/editor state.

CLI-local; does not dispatch to a daemon RPC. An end-to-end interaction harness: connects over CDP, waits for the graph to be ready, creates a scratch fixture (or targets `--folder <absolute-folder-id>`), taps the folder node, types `--marker <text>`, and probes Cytoscape node count plus floating-editor rects before/after the tap and after typing. Returns a rich result including saved content preview, editor selector/window id, fixture and cleanup status, pid, cdpPort, and projectRoot. `--timeout-ms N` (must be > 0; defaults to the implementation's DEFAULT_TIMEOUT_MS) bounds the graph-ready wait; `--keep-fixture` skips fixture cleanup. Accepts `--port`/`--cdpPort`/`--pid`/`--project` but NOT `--new`. Also reachable as the two-token form `vt debug folder materialize`.

**Parameters:**

- `--folder VALUE`: Target an existing folder by absolute id (path-resolved, trailing-slash normalized) instead of seeding a scratch fixture. Also accepts `--folder=PATH`.
- `--marker VALUE`: Text typed into the materialized editor and used to assert saved content. Also accepts `--marker=TEXT`.
- `--timeout-ms VALUE`: Graph-ready wait bound in ms (must be > 0; defaults to the implementation's DEFAULT_TIMEOUT_MS). Also accepts `--timeout-ms=N`.
- `--keep-fixture`: Skip cleanup of the seeded scratch fixture.
- `--port / --cdpPort VALUE`: Shared selector. Target a specific registered dev session by its CDP port, matched against the instance's `cdpPort`. `--cdpPort` is a backward-compatible alias for `--port`. Also accepts the `--port=N` / `--cdpPort=N` form.
- `--pid VALUE`: Shared selector. Target a specific registered dev process by pid. Also accepts the `--pid=N` form.
- `--project VALUE`: Shared selector. Target a registered dev session whose resolved `projectRoot` matches the given path (prefix match). Also accepts the `--project=PATH` form.

### `vt debug keyboard`

Send keyboard input (typed text or a normalized key chord) to the dev session's renderer, optionally focusing a selector first.

CLI-local; does not dispatch to a daemon RPC. Requires an operation positional: `type <text>` or `press <chord>`.

`type`: types the joined positional text into the page; `--selector <css>` focuses that element first; `--delay-ms N` (>= 0) adds per-keystroke delay. Returns the active element after typing.

`press`: presses exactly one chord (e.g. `Mod+Enter`), normalized via `normalizeChord`; `--selector <css>` focuses first. Returns the active element and the normalized chord.

Both ops accept the shared selector flags including `--new`. A missing/invalid operation, missing text, or a non-single press chord all return the usage error.

**Parameters:**

- `<type|press>` (positional): Required operation. `type` types text; `press` presses one key chord.
- `<text>... | <chord>` (positional): For `type`: the text to type (all positionals joined with spaces). For `press`: exactly one key chord (e.g. `Mod+Enter`), normalized before dispatch. Required.
- `--selector VALUE`: Focus this CSS-selected element before typing/pressing. Also accepts `--selector=CSS`.
- `--delay-ms VALUE`: `type` only: per-keystroke delay in ms (must be >= 0). Also accepts `--delay-ms=N`.
- `--port / --cdpPort VALUE`: Shared selector. Target a specific registered dev session by its CDP port, matched against the instance's `cdpPort`. `--cdpPort` is a backward-compatible alias for `--port`. Also accepts the `--port=N` / `--cdpPort=N` form.
- `--pid VALUE`: Shared selector. Target a specific registered dev process by pid. Also accepts the `--pid=N` form.
- `--project VALUE`: Shared selector. Target a registered dev session whose resolved `projectRoot` matches the given path (prefix match). Also accepts the `--project=PATH` form.
- `--new`: Shared selector. Launch a fresh dev session even if one already exists (preferred when testing new code). Accepted by attach, capture, drift, eval, keyboard, node, page-ax, screenshot, and why-blank; NOT accepted by ls, log, folder-aspect, folder-materialize, node-click, or run.

### `vt debug ls`

List the live registered Voicetree dev instances (pid, projectRoot, cdpPort, startedAt), optionally filtered by selector.

CLI-local; does not dispatch to a daemon RPC. Reads the instance JSON files from the Application Support `VoiceTree/instances` dir, keeps only those whose PID is still alive, and applies `--port`/`--cdpPort`, `--pid`, or `--project` (resolved-prefix match) filters. Returns the array as-is — it neither attaches over CDP nor auto-launches, making it the safe first call to discover what to target with `--port`. Does not accept `--new`.

**Parameters:**

- `--port / --cdpPort VALUE`: Shared selector. Target a specific registered dev session by its CDP port, matched against the instance's `cdpPort`. `--cdpPort` is a backward-compatible alias for `--port`. Also accepts the `--port=N` / `--cdpPort=N` form.
- `--pid VALUE`: Shared selector. Target a specific registered dev process by pid. Also accepts the `--pid=N` form.
- `--project VALUE`: Shared selector. Target a registered dev session whose resolved `projectRoot` matches the given path (prefix match). Also accepts the `--project=PATH` form.

### `vt debug log`

Collect a diagnostic report from the dev session: page title/URL, loaded roots, recent console errors, uncaught exceptions, and the focused element's accessibility info.

CLI-local; does not dispatch to a daemon RPC. Connects over CDP and combines the page title, the daemon live state's loaded roots, and a renderer snapshot from `window.__vtDebug__` (console messages + exceptions + active element). Returns recent console ERRORS (last 20) and uncaught exceptions (count plus last 10 sample), enriched with the focused element's accessibility role/name. `--since-ms N` filters console/exception entries to the last N milliseconds (entries with unparseable timestamps are kept). Accepts `--port`/`--cdpPort`/`--pid`/`--project` but NOT `--new`.

**Parameters:**

- `--since-ms VALUE`: Filter console errors and uncaught exceptions to the last N milliseconds (entries with unparseable timestamps are kept). Also accepts `--since-ms=N`.
- `--port / --cdpPort VALUE`: Shared selector. Target a specific registered dev session by its CDP port, matched against the instance's `cdpPort`. `--cdpPort` is a backward-compatible alias for `--port`. Also accepts the `--port=N` / `--cdpPort=N` form.
- `--pid VALUE`: Shared selector. Target a specific registered dev process by pid. Also accepts the `--pid=N` form.
- `--project VALUE`: Shared selector. Target a registered dev session whose resolved `projectRoot` matches the given path (prefix match). Also accepts the `--project=PATH` form.

### `vt debug node`

Inspect one graph node in the dev session — its on-disk content plus how it is rendered (Cytoscape presence, bbox, classes, focus) and its actionable buttons.

CLI-local; does not dispatch to a daemon RPC. Resolves the instance, fetches the daemon live state, and looks up the node by id (its absolute file path). Errors `node not found: <id>` (exit 1) if absent. Then connects over CDP and takes a renderer snapshot: Cytoscape rendered/hidden/removed state, rendered bbox, classes, focus, and the node's editor floating window. Merges accessibility-tree buttons with the `window.__vtDebug__.buttons()` registry into a deduped button list. Requires a single `<id>` positional; accepts the shared selector flags including `--new`. Any other `--flag` errors `unknown flag: <flag>`.

**Parameters:**

- `<id>` (positional): Node id (its absolute file path) to inspect. Required; errors `node not found` if absent from live state.
- `--port / --cdpPort VALUE`: Shared selector. Target a specific registered dev session by its CDP port, matched against the instance's `cdpPort`. `--cdpPort` is a backward-compatible alias for `--port`. Also accepts the `--port=N` / `--cdpPort=N` form.
- `--pid VALUE`: Shared selector. Target a specific registered dev process by pid. Also accepts the `--pid=N` form.
- `--project VALUE`: Shared selector. Target a registered dev session whose resolved `projectRoot` matches the given path (prefix match). Also accepts the `--project=PATH` form.
- `--new`: Shared selector. Launch a fresh dev session even if one already exists (preferred when testing new code). Accepted by attach, capture, drift, eval, keyboard, node, page-ax, screenshot, and why-blank; NOT accepted by ls, log, folder-aspect, folder-materialize, node-click, or run.

### `vt debug node-click`

Click a button on a node in the dev session by label or zero-based index, then report dispatched events, console output, and a screenshot.

CLI-local; does not dispatch to a daemon RPC. Requires two positionals: `<id>` and `<label|index>`. Collects the node's buttons (accessibility tree + `__vtDebug__.buttons()` registry, merged), then selects by index (zero-based, range-checked) or by exact normalized label (ambiguous/missing label errors with the available-button list). Refuses a disabled button. Begins an event/console capture, clicks the real DOM element, waits a fixed settle interval, writes a full-page PNG to `/tmp/vt-debug/node-click/<ts>.png`, and ends capture. Returns `{nodeId, button, matchedBy, dispatchedEvents, consoleAfter, screenshotPath, pid, cdpPort}`. Accepts `--port`/`--cdpPort`/`--pid`/`--project` but NOT `--new`. Also reachable as the two-token form `vt debug node click`.

**Parameters:**

- `<id>` (positional): Node id whose button to click. Required.
- `<label|index>` (positional): Button reference: a zero-based integer index (range-checked) or an exact normalized button label (ambiguous/missing label errors with the available list). Required.
- `--port / --cdpPort VALUE`: Shared selector. Target a specific registered dev session by its CDP port, matched against the instance's `cdpPort`. `--cdpPort` is a backward-compatible alias for `--port`. Also accepts the `--port=N` / `--cdpPort=N` form.
- `--pid VALUE`: Shared selector. Target a specific registered dev process by pid. Also accepts the `--pid=N` form.
- `--project VALUE`: Shared selector. Target a registered dev session whose resolved `projectRoot` matches the given path (prefix match). Also accepts the `--project=PATH` form.

### `vt debug page-ax`

Dump the dev session's accessibility (AX) tree, optionally rooted at a CSS selector.

CLI-local; does not dispatch to a daemon RPC. Connects over CDP and returns the Playwright accessibility snapshot of the first page with `interestingOnly: false` (the full tree). `--selector <css>` roots the snapshot at a specific element; an unmatched selector errors `selector not found: <selector>`, and an empty resulting tree errors with a hint to try `--selector` on a specific app root. Accepts the shared selector flags including `--new`. Also reachable as the two-token form `vt debug page ax`.

**Parameters:**

- `--selector VALUE`: Root the accessibility snapshot at this CSS-selected element; an unmatched selector errors `selector not found`. Also accepts `--selector=CSS`.
- `--port / --cdpPort VALUE`: Shared selector. Target a specific registered dev session by its CDP port, matched against the instance's `cdpPort`. `--cdpPort` is a backward-compatible alias for `--port`. Also accepts the `--port=N` / `--cdpPort=N` form.
- `--pid VALUE`: Shared selector. Target a specific registered dev process by pid. Also accepts the `--pid=N` form.
- `--project VALUE`: Shared selector. Target a registered dev session whose resolved `projectRoot` matches the given path (prefix match). Also accepts the `--project=PATH` form.
- `--new`: Shared selector. Launch a fresh dev session even if one already exists (preferred when testing new code). Accepted by attach, capture, drift, eval, keyboard, node, page-ax, screenshot, and why-blank; NOT accepted by ls, log, folder-aspect, folder-materialize, node-click, or run.

### `vt debug run`

Replay a scripted sequence of UI steps against the dev session and bundle per-step observations (screenshots, console, drift, state).

CLI-local; does not dispatch to a daemon RPC. Takes a `<spec-file|inline-json>` positional: a JSON array of `StepSpec`s (or `{steps:[...]}`), or a file path to one (a leading `[` or `{` is treated as inline JSON, otherwise as a path). Each validated step is one of `dispatch` (a live command sent through the daemon transport), `click <css>`, `tapNode <id>` (mouse-clicks the rendered node when on-screen, else emits a `tap`), `type` (+ optional `selector` focus), `press` (normalized chord, + optional `selector` focus), `wait <ms>`, `waitFor <css>` (+ `timeoutMs`), or `navigate <url>`. Per-step observation flags: `--screenshot-each`, `--console-each`, `--drift-each`, `--state-each`. `--stop-on-error[=true|false]` (default true) halts on the first failing step. `--out <dir>` sets the bundle dir (default a timestamped dir under `/tmp/vt-debug/run`). Returns `{source, bundle:{dir, stepCount, outputs}}`. An empty step list short-circuits successfully without attaching over CDP. Accepts `--port`/`--cdpPort`/`--pid`/`--project` but NOT `--new`.

**Parameters:**

- `<spec-file|inline-json>` (positional): A StepSpec JSON array / `{steps:[...]}` object passed inline, or a path to such a file. Required.
- `--screenshot-each`: Capture a screenshot after each step into the bundle dir.
- `--console-each`: Capture renderer console output after each step.
- `--drift-each`: Capture state/render drift after each step.
- `--state-each`: Capture the serialized live state (delta-applied overlay) after each step.
- `--stop-on-error VALUE`: Halt on the first failing step. Accepts `--stop-on-error` followed by `true`/`false`, or `--stop-on-error=true|false`. Default true.
- `--out VALUE`: Bundle output directory (absolute-resolved; default a timestamped dir under `/tmp/vt-debug/run`). Also accepts `--out=DIR`.
- `--port / --cdpPort VALUE`: Shared selector. Target a specific registered dev session by its CDP port, matched against the instance's `cdpPort`. `--cdpPort` is a backward-compatible alias for `--port`. Also accepts the `--port=N` / `--cdpPort=N` form.
- `--pid VALUE`: Shared selector. Target a specific registered dev process by pid. Also accepts the `--pid=N` form.
- `--project VALUE`: Shared selector. Target a registered dev session whose resolved `projectRoot` matches the given path (prefix match). Also accepts the `--project=PATH` form.

### `vt debug screenshot`

Take a PNG screenshot of the dev session — the full page, or a single element by CSS selector — to a file and/or as base64.

CLI-local; does not dispatch to a daemon RPC. Connects over CDP, waits up to 10s for the first page, and screenshots. `--selector <css>` screenshots just that element (and implicitly disables full-page); an unmatched selector errors `no element matches selector: <selector>`. `--full-page` forces full-page (the default when no selector is given). `--base64` returns the PNG inline as base64 (a file is still written too if `--out` is given). `-o`/`--out`/`--output PATH` sets the output path (absolute-resolved; default `/tmp/vt-debug/screenshots/<ts>.png`). Returns `{path?, base64?, selector?, fullPage, pid, cdpPort}`. Accepts the shared selector flags including `--new`.

**Parameters:**

- `--selector VALUE`: Screenshot just this CSS-selected element (implicitly disables full-page). An unmatched selector errors. Also accepts `--selector=CSS`.
- `--full-page`: Force a full-page screenshot (the default when no `--selector` is given).
- `--base64`: Return the PNG inline as base64 (a file is still written if `--out` is also given).
- `-o / --out / --output VALUE`: Output path (absolute-resolved; default `/tmp/vt-debug/screenshots/<ts>.png`). Also accepts `--out=PATH`, `--output=PATH`, `-o=PATH`.
- `--port / --cdpPort VALUE`: Shared selector. Target a specific registered dev session by its CDP port, matched against the instance's `cdpPort`. `--cdpPort` is a backward-compatible alias for `--port`. Also accepts the `--port=N` / `--cdpPort=N` form.
- `--pid VALUE`: Shared selector. Target a specific registered dev process by pid. Also accepts the `--pid=N` form.
- `--project VALUE`: Shared selector. Target a registered dev session whose resolved `projectRoot` matches the given path (prefix match). Also accepts the `--project=PATH` form.
- `--new`: Shared selector. Launch a fresh dev session even if one already exists (preferred when testing new code). Accepted by attach, capture, drift, eval, keyboard, node, page-ax, screenshot, and why-blank; NOT accepted by ls, log, folder-aspect, folder-materialize, node-click, or run.

### `vt debug why-blank`

Diagnose why the dev session's UI is (or might be) blank, combining a screenshot byte-size probe, console/exceptions, live state counts, and root-DOM geometry.

CLI-local; does not dispatch to a daemon RPC. Connects over CDP and gathers a screenshot byte sample, renderer console/exceptions (`window.__vtDebug__`), a live-state summary (loaded roots, graph node count, projected node count), and `#root` DOM geometry (size, child count, display/visibility), then runs `diagnose` to classify the likely blank-screen cause. `--seed <scenario>` injects a synthetic failure sample for testing the diagnostics — valid scenarios: `throw-in-init`, `zero-height-root`, `empty-graph-no-roots`, `css-hidden-root`, `projected-empty`; an unknown seed errors with the valid list. Accepts the shared selector flags including `--new`. Also reachable as the two-token form `vt debug why blank`.

**Parameters:**

- `--seed VALUE`: Inject a synthetic failure sample to exercise the diagnostics. Valid: `throw-in-init`, `zero-height-root`, `empty-graph-no-roots`, `css-hidden-root`, `projected-empty`. An unknown value errors with the valid list. Also accepts `--seed=SCENARIO`.
- `--port / --cdpPort VALUE`: Shared selector. Target a specific registered dev session by its CDP port, matched against the instance's `cdpPort`. `--cdpPort` is a backward-compatible alias for `--port`. Also accepts the `--port=N` / `--cdpPort=N` form.
- `--pid VALUE`: Shared selector. Target a specific registered dev process by pid. Also accepts the `--pid=N` form.
- `--project VALUE`: Shared selector. Target a registered dev session whose resolved `projectRoot` matches the given path (prefix match). Also accepts the `--project=PATH` form.
- `--new`: Shared selector. Launch a fresh dev session even if one already exists (preferred when testing new code). Accepted by attach, capture, drift, eval, keyboard, node, page-ax, screenshot, and why-blank; NOT accepted by ls, log, folder-aspect, folder-materialize, node-click, or run.

### `vt serve`

Start the per-project daemons (graph-db + vt-daemon) in the foreground and idle until interrupted. A convenience launcher that ensures both cross-process owner daemons for a project are running, prints where each landed, then parks the process so the operator’s terminal stays attached.

**Ensure ordering:** graph-db is ensured first via `ensureGraphDaemonForProject` (honouring `$VT_GRAPHD_BIN`), then vt-daemon via the high-level `ensureNodeVtDaemonForProject` entry (honouring `$VT_DAEMON_BIN`). Each ensure either launches a fresh owner or reuses an existing one; the success line reports `launched` vs `reused` for each, with the graph-db URL/pid, the vt-daemon base URL/pid, and the resolved project path.

**Ownership:** neither daemon is owned by `vt serve` — both are cross-process resources spawned (or reused) under the spawn-lock single-flight ensure protocol, and `vt serve` is a transient peer of both. On `SIGINT`/`SIGTERM` it clears its idle timer and exits `0` WITHOUT tearing down either daemon: other CLI peers and the Electron Main may still be using them, and each daemon’s own watchdog handles eventual shutdown. Stop a daemon explicitly via its `/shutdown` endpoint or by terminating its recorded owner pid.

**Failure teardown:** if the graph-db ensure succeeds and the subsequent vt-daemon ensure then fails, the graph-db daemon this invocation just launched has no other peer, so it is torn down via its `/shutdown` endpoint (best-effort; a `/shutdown` that itself fails does not mask the original error) before exiting non-zero. A graph-db owner that was merely reused belongs to other peers and is left running.

This verb is CLI-local: it drives the ensure clients (`@vt/graph-db-client`, `@vt/vt-daemon-client`) directly and does NOT dispatch through the daemon tool catalog, so there are no `(RPC: …)` parameter mappings.

**Parameters:**

- `--project VALUE`: Required. The project root to serve. Accepts `--project <path>` or `--project=<path>`; the path is resolved to an absolute path. Missing or empty `--project` is a fatal usage error.
- `--exclusive`: Require this invocation to be the one that launches each daemon — refuse to reuse an existing owner. If a graph-db or vt-daemon owner already exists for the project, the command errors with the existing owner’s pid and port and asks you to stop it first. A vt-daemon refusal still tears down any graph-db daemon this invocation freshly launched, so the refusal does not orphan it.
- `--help / -h`: Print the `vt serve` usage line (`Usage: vt serve --project <path> [--exclusive]`) and exit `0`.
- `VT_GRAPHD_BIN` (env): Optional override for the graph-db daemon binary passed to `ensureGraphDaemonForProject`. When unset the ensure client resolves its default binary.
- `VT_DAEMON_BIN` (env): Optional override for the vt-daemon binary passed to `ensureNodeVtDaemonForProject`. When unset the ensure client resolves its default binary.

### `vt manual`

Print the canonical CLI manual, or a single tool section when given a verb selector. With no arguments it prints the whole document; with a selector it prints just the matching tool’s section — so `vt manual <cli-local-verb>` resolves even for verbs that never dispatch to a daemon RPC.

**Selector forms:** the verb may be given multi-token exactly as it appears on the command line (`vt manual agent spawn`, `vt manual graph create`) or single-token, joined with spaces and optionally `vt`-prefixed (`vt manual "vt agent spawn"`, `vt manual "agent spawn"`). Lookup is normalized: case-folded, leading `vt` stripped, and `.`/`_`/`-` folded to spaces, so `agent.spawn` and `agent spawn` resolve to the same section. The daemon-side RPC tool name (e.g. `spawn_agent`) is intentionally NOT a valid selector — the CLI surface is canonical; to discover the RPC parameter shape, run `vt <verb> --help` and read each flag’s `(RPC: <param>)` annotation.

**Whole-manual triggers:** an empty argument list, or a first argument of `--help`, `-h`, or `help`, prints the full manual.

**Not found:** an unrecognized selector errors with up to three "did you mean" candidates (ranked by edit distance over the normalized verbs) followed by the full list of available verbs.

This verb is CLI-local and performs no filesystem I/O: the manual is rendered at runtime from the in-process `MANUAL_SPECS` data (daemon-dispatched `TOOL_SPECS` plus the CLI-local doc-only specs). It does NOT dispatch to a daemon RPC, so there are no `(RPC: …)` parameter mappings.

**Parameters:**

- `[selector]` (positional): Optional CLI verb to render a single section for. May be multi-token (`agent spawn`), single-token quoted (`"agent spawn"`), and optionally `vt`-prefixed; separators `.`/`_`/`-` are folded to spaces. Omit to print the whole manual.
- `--help / -h`: As the first argument, prints the full manual (treated identically to passing no selector or the literal `help`).

### `vt help`

Print the top-level `vt` usage banner: commands, global flags, and where to go for subcommand detail. The same banner is printed by `vt help`, `vt --help`, `vt -h`, and by running `vt` with no arguments.

**Lists the command families** — `agent`, `graph`, `serve`, `search`, `project`, `session`, `view`, `debug`, `manual`, and `help` — with a one-line gloss for each (`serve` is described as "Start headless daemon (graph-db + vt-daemon) for a project"). It also documents the global flags `--terminal` / `-t` (caller terminal id, defaulting to `$VOICETREE_TERMINAL_ID`) and `--json` (force JSON output), and points to `vt <command> --help` for per-subcommand detail.

This is the human-oriented top-level overview. For the full, machine-generated tool reference (every verb, flag, and RPC mapping) use `vt manual` instead.

This verb is CLI-local: it writes a static usage string to stdout and does NOT dispatch to a daemon RPC, so there are no `(RPC: …)` parameter mappings.

**Parameters:**

- `--help / -h`: At the top level (`vt --help` / `vt -h`) prints this same usage banner. Running `vt` with no command, or the literal `vt help`, produces identical output.
<!-- VOICETREE_AGENT_DISCOVERY_END -->

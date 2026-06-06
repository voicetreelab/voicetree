⛔ This is a NORMAL, WRITABLE checkout of THIS machine's own branch `$VT_DEV_BRANCH` (machine-local, set in `~/.env` — e.g. `dev-mac` / `dev-remote`; never a literal in-repo; safe default `dev-new`). Edit & commit directly here (worktrees optional: `vt-worktree <name>`). `vt-sync` to pull `dev` into your branch (never `git pull`); `vt-pr "msg"` to integrate (PR → `dev`). More: `scripts/dev-setup/distributed-architecture.md`.

🗺️ Read `architecture.md` (repo root) first — fastest way to find where any component lives.
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

**Concept → path map** — to find where a concept's code actually lives (daemon, transport, rpc, hooks, agent-runtime, create_graph, cli, graph-db, measures, webapp shell/layout, …) without grep-discovery rounds, read `docs/agent-concept-path-map.md`.

<!-- VOICETREE_AGENT_DISCOVERY_START -->
Run `vt manual` for the VoiceTree `vt` CLI reference (`vt manual <verb>` for one tool).
<!-- VOICETREE_AGENT_DISCOVERY_END -->

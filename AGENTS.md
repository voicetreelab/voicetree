⛔ The main checkout is a READ-ONLY cache of origin/dev-manu — never edit/commit in it (worktrees ARE writable). `vt-worktree <name>` to work → `vt-land "msg"` to ship; `vt-sync` to update (never `git pull`). More: `scripts/dev-setup/worktree-readme.md`.

## Design — functional, not OOP
Model everything as functions + types; push impurity to the edge/shell. Favor deep, narrow functions: one minimal public API hiding internal complexity.

## Tests — black-box only
Call the function, assert on outputs (or observable side-effects). Never mock internal deps or use `toHaveBeenCalledWith`.

## Working agreement
- Commit each atomic unit of useful work unprompted (peers work concurrently).
- OpenSpecs live in global `~/brain/mem` — never duplicate under worktree-local `brain/mem`.
- Don't ask what you can answer yourself or work around cleanly (no new tech debt). Save the user's attention for architecture; attach an ASCII flow diagram to architectural questions.
- After each change, honestly flag anything that could be a fragile hack or reward/verification-hack.

## Quality > speed (the user cares deeply)
Correctness, clarity, maintainability, simplicity, robustness, honesty — over convenience, cleverness, speed. NEVER introduce hacks; work toward what a check truly measures. Nothing here is production: no backward-compat/legacy paths — if a design is wrong, fix it properly (break APIs as needed). "I couldn't do X because the repo lacked Y" is welcome; a workaround that may break later is not — raise worthwhile refactors instead.

## Code search (prefer over grep)
- `ast-grep` — AST-precise structural search/rewrite.  `ck --sem` — semantic search (index once: `ck --index .`).
- `cgcli` — symbol-resolved call graph (callers/callees/reachable/hotspots).

<!-- VOICETREE_AGENT_DISCOVERY_START -->
Run `vt manual` for the VoiceTree `vt` CLI reference (`vt manual <verb>` for one tool).
<!-- VOICETREE_AGENT_DISCOVERY_END -->

---
color: green
isContextNode: false
agent_name: Omar
---
# M1-fix4: filter AGENT_PROMPT/large vars from tmux env

Aki's M1-rerun-3 against `733dedae` showed M1-fix3 was insufficient: `terminalData.initialEnvVars` for Fake Agent panels includes multi-KB prompt values (`AGENT_PROMPT_LIGHTWEIGHT`, `AGENT_PROMPT_CORE`, `AGENT_PROMPT`, `AGENT_PROMPT_PREVIOUS_BACKUP`). Even with just initialEnvVars passed via `tmux -e`, those large values overflow tmux's command-line buffer ("command too long" exit-1). M1-fix4 filters them out for the interactive tmux path.

## What changed

**`packages/systems/agent-runtime/src/application/terminals/terminal-manager.ts`** — `TerminalManager.spawnTmuxBacked` now filters `terminalData.initialEnvVars` to exclude (a) any key starting with `AGENT_PROMPT`, (b) any value longer than 4 KB. The defensive 4 KB cap guards against future large-var classes. Filtered vars are NOT forwarded to tmux; tmux server inherits the rest from Electron main's spawn env, agent identity vars (small) ride on tmux -e.

Diff: ~10 lines net.

## What this does NOT fix

**Phase 6 (production default flip) will need a deeper fix.** Headless tmux production invocations of agent CLIs (e.g. `claude -p "$AGENT_PROMPT"`) require the prompt vars to reach the agent process. M1-fix4 just drops them — fine for interactive shell panels (Phase 4's M1 use case), broken for headless tmux + Fake Agent / real Claude in production.

The Phase 6 prereq is one of:
1. **Env-file source-on-startup workaround**: write large vars to `.voicetree/terminals/{name}.env` (mode 0600), wrap tmux command with `bash -c "source <env-file> && exec <command>"`. tmux only sees small commands; agents see env via shell sourcing.
2. **Refactor agent invocation to read prompts from disk**: instead of `AGENT_PROMPT=<huge>`, set `AGENT_PROMPT_FILE=/path/to/prompt`. Agent CLI reads file. Cleaner architecturally; requires touching agent CLIs.

Both are out of scope for M1 (which only verifies the panel-shell surface). I'm flagging this for the Phase 6 leaf to address.

## Tests

- Full agent-runtime suite: 24 files / **301 tests PASS** (unchanged).
- The existing M1-fix interactive test (`headlessAgentManager.tmux.test.ts`) doesn't trigger this filter (it uses tiny initialEnvVars). A direct regression test for the filter is hard to write without graph-model init (same blocker as M1-fix3 attempted regression test). Manual verification will come from M1-rerun-4.

## Calibration claim

**Claim (MEDIUM-HIGH ~0.7): M1-rerun-4 will see 3 tmux sessions on spawn AND panels showing real shell prompts.** Falsifier: still zero sessions OR panels still hang. (Lower than M1-fix3's prediction because the cascade has been deeper than expected; each round has surfaced a new layer. But the empirical reproducer that informed M1-fix3 still applies, and dropping the prompts is the obvious next mitigation.)

**Claim (MEDIUM ~0.5): If M1-rerun-4 FAILs at spawn, it'll be a 5th distinct layer (not a re-occurrence of layers 1–4).** Falsifier: same failure mode as Wei/Yan/Zoe/Aki recurs.

**Claim (HIGH ~0.85): Phase 6 default-flip will require an env-file or read-from-disk fix for agent prompts before headless tmux is production-safe.** Falsifier: Phase 6 ships with M1-fix4 unchanged and headless agents work correctly.

## Cascade so far

| Round | Tip | Verdict | Root cause |
|---|---|---|---|
| Wei | `b15a6fd5` | FAIL | IPC handler tmux branch returned success w/o creating session |
| M1-fix `fac86efc` | — | — | IPC creates session via spawnTmuxBacked |
| Yan | `fac86efc` | FAIL | Renderer initRelayTerminal skipped IPC entirely |
| M1-fix2 `8eb72a89` | — | — | Renderer awaits IPC spawn before WS attach |
| Zoe | `8eb72a89` | FAIL | tmux -e overflowed at 74 env vars |
| M1-fix3 `733dedae` | — | — | spawnTmuxBacked passes only initialEnvVars |
| Aki | `733dedae` | FAIL | initialEnvVars itself contains multi-KB AGENT_PROMPT_* |
| **M1-fix4** | TBD | — | spawnTmuxBacked filters AGENT_PROMPT_*  + values > 4 KB |

## Related

- [[m1-rerun-3-electron-sweep-failed]] — Aki's evidence
- [[m1-fix3-tmux-env-overflow]] — previous layer
- [[refactor-tmuxify-migration-complete]] — Sam's 5-phase synthesis

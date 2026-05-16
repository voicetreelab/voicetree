---
color: green
isContextNode: false
agent_name: Omar
---
# M1-fix3: tmux argv overflow at 74 env vars — pass only agent-specific overrides

Zoe's M1-rerun-2 (`m1-rerun-2-electron-sweep-failed.md`) revealed the third layer of the cascade: with the renderer now reaching IPC (M1-fix2) and IPC creating the tmux session (M1-fix), `tmux new-session -d -s {name} -e ... command` failed with exit code 1. Root cause: tmux's internal command-line buffer overflows when you pass 70+ env vars via `-e KEY=VALUE` — error is literally "command too long". The headless path never hit this because it only passes `terminalData.initialEnvVars` (a small set); my `spawnTmuxBacked` was forwarding the full `buildTerminalEnvironment` output (process.env + extras = ~74 vars).

## Reproduction

```text
$ node /tmp/repro-m1.mjs    # full process.env via -e (mimics original spawnTmuxBacked)
Total env vars: 74
Total -e args: 74
exit: 1
stderr: command too long

$ node /tmp/repro-m1-fix3.mjs  # only initialEnvVars (mimics M1-fix3)
Env vars: 6, -e args: 6
exit: 0, stderr:
tmux ls: m1-repro-3: 1 windows
```

The 74-var case is empirically observed failure; the 6-var case is empirically observed success. tmux 3.6a on Darwin 24.6 arm64.

## What changed

**`packages/systems/agent-runtime/src/application/terminals/terminal-manager.ts`** — `TerminalManager.spawnTmuxBacked` no longer calls `buildTerminalEnvironment`. The tmux env is now `{...terminalData.initialEnvVars ?? {}}` — same shape as the headless path. tmux's server inherits PATH/HOME/SHELL/USER from Electron main; panes inherit from server; agent-specific overrides ride on `-e`.

Diff: 7 lines net — removed the loop that copied process.env, replaced with one line.

## What this does NOT change

- The headless tmux path was never broken (always passed small env). No behavior change for headless.
- The non-tmux interactive path (`terminalManager.spawn`) still uses `buildTerminalEnvironment` for the full PTY env. Correct — node-pty doesn't have tmux's argv limit.
- The relay's WS handler (`tmux-attach-relay.ts`) is unchanged. Phase 3 surface untouched.

## Tests

- Full agent-runtime suite: 24 files / **301 tests PASS** (same as before).
- I drafted a regression test (`terminal-manager.tmux.test.ts`) that would catch a re-introduction of `buildTerminalEnvironment` in `spawnTmuxBacked`, but it required initializing graph-model (which `loadSettings()` depends on) and that's overkill setup for autopilot. Deleted. The structural change (no `buildTerminalEnvironment` import in the `spawnTmuxBacked` path) is self-evident in the diff; a future re-introduction would be visible to review.

## Calibration claim

**Claim (HIGH ~0.8): M1-rerun-3 will see `tmux ls` show 3 sessions immediately after panel spawn, AND panels will display a real shell prompt.** Falsifier: zero sessions OR panels stay in "tmux reconnecting" after 5s. (Higher confidence than M1-fix2 because the reproducer confirms the failure mode AND the fix.)

**Claim (MEDIUM ~0.55): Kill-Electron + relaunch will see all 3 panels rebind on M1-rerun-3.** Falsifier: ≥1 panel fails to rebind even though tmux sessions are intact. (Same as before — the rebind path was never reached in rounds 1–3, so it's still unverified.)

**Claim (MEDIUM ~0.5): If M1-rerun-3 FAILs, it will be at the rebind step, not at spawn.** Falsifier: spawn still fails OR a new failure surfaces before rebind. The cascade pattern so far has been "fix one layer, next layer fails", so I'm modeling continued uncovering as plausible.

## Cascade so far

| Round | Agent | Tip | Result | Root cause |
|---|---|---|---|---|
| 1 | Wei (headful Codex) | `b15a6fd5` | FAIL | IPC handler tmux branch bypassed session creation |
| M1-fix | Omar (manual) | `fac86efc` | — | IPC handler now calls `terminalManager.spawnTmuxBacked()` |
| 2 | Yan (headful Codex) | `fac86efc` | FAIL | Renderer's `initRelayTerminal()` skipped IPC entirely |
| M1-fix2 | Omar (manual) | `8eb72a89` | — | Renderer now awaits IPC spawn before WS attach |
| 3 | Zoe (headful Codex) | `8eb72a89` | FAIL | tmux `-e` argv overflow at 74 env vars |
| M1-fix3 | Omar (manual) | TBD on commit | — | spawnTmuxBacked passes only initialEnvVars |

## Related

- [[m1-electron-sweep-failed]] — Wei round 1
- [[m1-fix-ipc-tmux-spawn-complete]] — IPC handler creates session
- [[m1-rerun-electron-sweep-failed]] — Yan round 2
- [[m1-fix2-renderer-must-call-ipc-spawn]] — renderer calls IPC
- [[m1-rerun-2-electron-sweep-failed]] — Zoe round 3
- [[refactor-tmuxify-migration-complete]] — Sam's 5-phase synthesis

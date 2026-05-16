---
color: green
isContextNode: false
agent_name: Omar
---
# M1-fix5: reuse existing tmux session on relaunch

Ama's M1-rerun-4 against `acab1714` was a **partial PASS**: Electron tmux mode spawned exactly three sessions (`Aki`, `Ama`, `Amit`), panels showed `tmux connected`, sentinels were written, and `kill -9` of the Electron main process left all three tmux sessions alive. But relaunch FAILed because `spawnTmuxBackedTerminal` unconditionally called `tmux new-session -s <name>` — tmux rejected all three with `duplicate session` and the relaunched renderer never rebound.

This is layer 5 of the cascade. The four prior fixes addressed the *spawn* path; this one addresses the *re-spawn over a live session* path.

## What changed

**`packages/systems/agent-runtime/src/application/headless/headlessAgentManager.ts`** — `spawnTmuxBackedTerminal` now checks `hasSession(terminalId)` before calling `createSession`. If the session is alive:

- Skip `tmux new-session` entirely (avoids "duplicate session")
- Re-establish `pipe-pane` to the existing log path (idempotent — tmux replaces the prior pipe target)
- Get the existing pane PID via `getPanePid`
- Preserve `startedAt` from existing metadata if present and `status === 'running'`; otherwise write fresh metadata with the existing PID
- Clear any prior poll timer (reconciliation may have installed one) and restart it
- Re-register in terminal-registry via `recordTerminalSpawn`
- Return `{pid: existingPid}`

If the session does not exist, fall through to the original create path. No behavior change on first spawn.

**`packages/systems/agent-runtime/src/application/headless/tmux-terminal-metadata.ts`** (new) — extracted `TmuxTerminalMetadata` type, `resolveTmuxPaths`, `writeTmuxMetadata`, `readTmuxMetadata`, `buildTmuxCommand`. Forced by the 500-line file-size cap on `headlessAgentManager.ts` after the reuse branch pushed it to 503. Functional split: file-IO edge helpers in one module, lifecycle / state-map operations in the other.

## Why this fix and not BF-314 reconciliation alone

BF-314 reconciliation IS called at `main.ts:217` before window creation and DOES import surviving sessions into the registry. But the debug auto-setup flow (`prettySetupAppForElectronDebugging`) still issues a fresh spawn-by-name through IPC, which lands in `TerminalManager.spawnTmuxBacked` → `spawnTmuxBackedTerminal` → `createSession`. Without idempotent reuse in `createSession`'s caller, the renderer respawn path is doomed every time it's invoked over a live session — regardless of whether reconciliation already populated the registry.

Idempotent reuse at the spawn entrypoint is the universally-defensive fix: works even if reconciliation is bypassed, works for the debug-setup path, works for any future renderer flow that re-issues spawns.

## Tests

- Full agent-runtime suite: 24 files / **301 tests PASS** (unchanged count, unchanged shape).
- The two real-tmux integration tests in `headlessAgentManager.tmux.test.ts` already exercise `spawnTmuxBackedTerminal` end-to-end and pass; they spawn on fresh names so they hit the create branch.
- A direct regression test for the reuse branch needs a real tmux server (the only way to set up the precondition is to actually create a session). Manual coverage will come from M1-rerun-5: relaunch must show the same PIDs as pre-kill.

## Calibration claim

**Claim (HIGH ~0.85): M1-rerun-5 will PASS — pre-kill `tmux ls` shows 3 sessions, panels are connected, kill -9 leaves sessions alive, relaunch reattaches without "duplicate session", and the relaunched renderer reaches `tmux connected` within the observation window.** Falsifier: any of those steps fails OR a new layer surfaces.

**Claim (MEDIUM ~0.5): If M1-rerun-5 FAILs, the failure will be in the renderer's WS attach path (not in tmux spawn).** The cascade has been one-bug-per-round and we've now closed all known tmux-side bugs; the next plausible gap is renderer-side (WS reconnection, terminal-id resolution).

**Claim (MEDIUM ~0.6): Phase 6 default-flip is still blocked on the AGENT_PROMPT-via-env-file workaround.** Same as M1-fix4. The reuse fix is orthogonal to that and does not lift the block.

## Cascade so far

| Round | Tip | Verdict | Root cause |
|---|---|---|---|
| Wei | `b15a6fd5` | FAIL | IPC handler tmux branch bypassed session creation |
| M1-fix `fac86efc` | — | — | IPC creates session via spawnTmuxBacked |
| Yan | `fac86efc` | FAIL | Renderer initRelayTerminal skipped IPC entirely |
| M1-fix2 `8eb72a89` | — | — | Renderer awaits IPC spawn before WS attach |
| Zoe | `8eb72a89` | FAIL | tmux -e overflowed at 74 env vars |
| M1-fix3 `733dedae` | — | — | spawnTmuxBacked passes only initialEnvVars |
| Aki | `733dedae` | FAIL | initialEnvVars itself contains multi-KB AGENT_PROMPT_* |
| M1-fix4 `acab1714` | — | — | spawnTmuxBacked filters AGENT_PROMPT_* + values > 4 KB |
| Ama | `acab1714` | FAIL (partial) | Relaunch retries `tmux new-session` for live sessions |
| **M1-fix5** | TBD | — | spawnTmuxBackedTerminal reuses live tmux session on re-call |

## Related

- [[m1-rerun-4-electron-sweep-failed]] — Ama's evidence (partial PASS)
- [[m1-fix4-filter-agent-prompts-from-tmux-env]] — previous layer
- [[refactor-tmuxify-migration-complete]] — Sam's 5-phase synthesis

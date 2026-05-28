## Context

VoiceTree currently has two related recovery mechanisms:

- Running tmux-backed terminals persist metadata under `.voicetree/terminals/<terminalId>.json`.
- The terminal tree sidebar shows "surviving agents" by scanning live tmux sessions that match VoiceTree's namespace but are not currently represented in the in-memory terminal registry.

That covers Electron/MCP registry loss while the tmux pane is still alive. It does not cover the next failure mode: the `.voicetree/terminals` metadata still says the agent was running, but the tmux pane no longer exists. For Claude and Codex, the underlying CLI session can usually be resumed from the same working directory with a CLI-native resume command. The feature should treat that as a different recovery action from attaching a live pane.

## Goals / Non-Goals

**Goals:**
- Discover resumable agent records from the current project's `.voicetree/terminals` directory.
- Keep attach-to-live-tmux and resume-from-CLI as distinct recovery states.
- Resolve exact Claude/Codex native session ids from provider-global stores and save them into the project-local per-agent metadata record before offering Resume.
- Resume only supported Claude/Codex agents whose persisted metadata indicates they were not explicitly exited and includes a deterministic native session handle.
- Preserve terminal identity and graph relationships when the resumed process is rehydrated into the registry.
- Present recovery actions in the existing terminal tree sidebar without polluting normal `TerminalStore` membership.

**Non-Goals:**
- Resuming arbitrary custom CLIs or Gemini in this change.
- Guessing a missing command from an agent name when `terminalData.initialCommand` is absent.
- Resuming sessions from another vault namespace.
- Rewriting Claude/Codex local session stores. VoiceTree only reads those stores and persists the resolved native id into its own project metadata.
- Treating every old metadata file as recoverable; exited/manual/invalid records stay non-actionable.

## Decisions

### D1. Use `.voicetree/terminals` metadata as the source for dead-pane resume candidates

**Choice:** Add a pure classifier that reads terminal metadata records and live tmux state, then returns recovery candidates. A record is resumable when it belongs to the current vault, has `status: "running"`, is not in the registry, its tmux session is absent, its `terminalData.initialCommand` detects as Claude or Codex, and its metadata contains `recovery.native.sessionId`.

**Rationale:**
- The metadata already contains the terminal id, context/task attachment, parent terminal, initial spawn directory, initial env vars, initial command, agent name, and display metadata needed to rebuild the VoiceTree terminal record.
- The metadata becomes VoiceTree's durable source for the provider-native session handle after that handle has been resolved from Claude/Codex global state.
- The current live-tmux scan cannot see dead panes, so metadata must participate.
- A pure classifier keeps the impure filesystem/tmux work at the shell and makes the important recovery rules testable as black-box input/output.

**Alternatives considered:**
- Scan Claude/Codex native session directories directly. Rejected because VoiceTree would lose its graph/task relationship metadata and would couple to external CLI storage layouts.
- Infer resumability only from tmux session names. Rejected because the missing case is specifically "metadata survives, tmux session is gone".

### D2. Represent recovery rows as a discriminated union, not a widened `UnclaimedTmuxSession`

**Choice:** Introduce a runtime/UI type such as:

```ts
type RecoverableAgentSession =
  | { kind: 'attachable-tmux'; session: UnclaimedTmuxSession }
  | { kind: 'resumable-cli'; terminalId: TerminalId; agentName: string; cliType: 'claude' | 'codex'; metadataPath: string; terminalData: TerminalData; reason: 'missing-tmux-session' }
```

Non-actionable records can be returned only for diagnostics/tests, or omitted from the UI result after being counted/logged.

**Rationale:**
- Attaching a live pane and launching a new resume command have different preconditions, failure modes, and labels.
- Keeping the union explicit prevents "Attach" accidentally invoking a resume path or a dead-pane record being killed as if it were a live tmux session.
- This matches the project's preference for functions and types over object-oriented state.

**Alternatives considered:**
- Add optional fields to `UnclaimedTmuxSession`. Rejected because it would make impossible states representable, such as `attachable: true` on a dead tmux pane.

### D3. Resume by spawning a new tmux-backed terminal with the original terminal identity

**Choice:** Add `resumePersistedAgentSession(terminalId)` in `@vt/agent-runtime` that:

1. Re-runs discovery and finds the current resumable candidate by terminal id.
2. Builds a CLI-native resume command from the detected CLI type.
3. Spawns a new tmux-backed terminal using the persisted `terminalData`, `initialEnvVars`, and `initialSpawnDirectory`.
4. Re-registers the terminal under the original terminal id and writes fresh running metadata.

**Rationale:**
- Re-running discovery at action time prevents stale UI rows from resuming files that were meanwhile exited, claimed, or deleted.
- Reusing the original terminal id preserves sidebar identity, parent/child relationships, progress-node ownership context, pending wait semantics, and graph anchoring.
- Spawning under tmux keeps the resumed agent compatible with the existing output, input, close, and attach-relay paths.

**Alternatives considered:**
- Spawn a new terminal id. Rejected because it breaks graph/sidebar continuity and leaves the old metadata ambiguous.
- Send a resume command into a new plain shell. Rejected because it bypasses the tmux-backed runtime that the rest of agent control assumes.

### D4. Resolve native provider ids from global stores and persist them project-locally

**Choice:** Add provider-specific resolver functions that read Claude/Codex global state shortly after spawn and write the resolved native id into the existing per-agent terminal metadata file:

- Claude: scan recently modified `~/.claude/projects/**/*.jsonl` transcript files. Match user records whose string `message.content` contains `VOICETREE_TERMINAL_ID`, `VOICETREE_VAULT_PATH`, and `TASK_NODE_PATH`; persist the record's `sessionId`, transcript path, cwd, timestamp, and source `claude-project-transcript`.
- Codex: query `~/.codex/state_5.sqlite` table `threads`. Match `first_user_message` on `VOICETREE_TERMINAL_ID`, `VOICETREE_VAULT_PATH`, and `TASK_NODE_PATH`, constrained by recent `created_at_ms` / `updated_at_ms`; persist `id`, `rollout_path`, cwd, timestamp, and source `codex-state-index`.

Write the result under the existing project-local record:

```json
{
  "recovery": {
    "native": {
      "cli": "claude",
      "mode": "interactive",
      "sessionId": "605904d4-8881-4261-adc8-212891622ed2",
      "capturedAt": "2026-05-22T04:55:00.000Z",
      "source": "claude-project-transcript",
      "providerStorePath": "/Users/example/.claude/projects/.../605904d4-8881-4261-adc8-212891622ed2.jsonl"
    }
  }
}
```

**Rationale:**
- The provider stores are good at proving the native id, but they are not VoiceTree project state. Persisting the resolved handle into `.voicetree/terminals/<terminalId>.json` makes future recovery independent of re-running fuzzy lookup.
- Matching terminal id alone is unsafe because names are reused. Matching terminal id, vault path, task path, and recent timestamps scopes the lookup to the spawn that created the agent.
- The resolver is impure, but the parser/matcher should be pure and black-box testable with fixture rows/records.
- This gives Claude and Codex aligned behavior: both resolve from provider-global state, then store the exact native handle in VoiceTree metadata.

**Alternatives considered:**
- Generate and inject Claude `--session-id` at spawn time. Rejected for now because Claude already writes transcript records containing both VoiceTree markers and `sessionId`, so the global-store resolver aligns better with Codex.
- Read the live agent process environment. Rejected because VoiceTree records the tmux pane shell PID, not necessarily the provider process PID, and process-env scraping is OS-specific.
- Use `claude --continue`, `codex resume --last`, or `codex exec resume --last`. Rejected because those are cwd-relative guesses and can resume the wrong agent when multiple sessions share a workspace.

### D5. Use exact resume-command construction for user-triggered recovery

**Choice:** Add or expose a pure command builder for user-triggered recovery. For this feature, support only:

- Claude interactive/headless resume: `claude --resume <session-id>` plus the existing permission flags appropriate for the spawn mode.
- Codex interactive resume: `codex resume <thread-id>` plus the existing sandbox/hook flags appropriate for interactive terminals.
- Codex headless resume: `codex exec resume <thread-id>` plus the existing headless flags.

**Rationale:**
- Resume command generation is pure and belongs in shared runtime code, not the React sidebar.
- User-triggered recovery has a stricter correctness bar than stop-gate retries. It must target the exact provider session id persisted in `recovery.native.sessionId`.
- Keeping Gemini/custom CLIs unsupported is safer than pretending every CLI has compatible exact-session resume semantics.

### D6. Keep UI state separate from terminal registry state until recovery succeeds

**Choice:** The sidebar's recovery list should come from a recovery store adjacent to `UnclaimedTmuxStore`, backed by main-process polling. A resumable record does not enter `TerminalStore` until `resumePersistedAgentSession` succeeds.

**Rationale:**
- The terminal tree itself should continue to mean "currently registered terminals".
- Failed/stale recovery rows can be removed or refreshed without creating phantom terminal records.
- This keeps the UI behavior consistent with today's surviving-agents section.

**Alternatives considered:**
- Import all resumable records into `TerminalStore` as exited/pending rows. Rejected because normal agent-control tools would then see agents that are not actually routable.

## Risks / Trade-offs

- **Risk: provider global store schemas can change.** -> Keep resolvers isolated, fixture-tested, and diagnostic-only when no exact match is found.
- **Risk: stale metadata can point at a Claude/Codex session that the external CLI can no longer resume.** -> Re-run discovery before action, surface the CLI spawn failure in the row, and leave metadata unchanged unless a new tmux process is actually registered.
- **Risk: resolver lookup could match the wrong provider session if scoped too loosely.** -> Require terminal id, vault path, task path, and recent timestamp constraints before persisting `recovery.native.sessionId`.
- **Risk: a metadata file marked `running` after an intentional UI detach is indistinguishable from a crash if its tmux pane later dies.** -> Treat "running metadata + missing tmux + supported CLI" as user-actionable, not automatic; the user chooses Resume.
- **Risk: duplicate recovery if another process reclaims the same terminal while the user clicks Resume.** -> The resume API must perform an action-time registry/tmux/metadata check and fail if the terminal is no longer resumable.
- **Trade-off: unsupported CLIs are not resumable.** This is intentional until each CLI has tested resume semantics.

## Migration Plan

- No legacy migration is required. Existing `.voicetree/terminals/*.json` files remain the input, but only records with `recovery.native.sessionId` are actionable resume rows.
- Existing live-tmux surviving-agent attach behavior remains available.
- If the feature is rolled back, stale running metadata remains harmless; current reconciliation can still mark missing sessions exited.

## Open Questions

- Should `providerStorePath` be persisted as diagnostic metadata or only kept in logs? Persisting it helps debugging but records an absolute path outside the vault.

## Context

VoiceTree currently has two related recovery mechanisms:

- Running tmux-backed terminals persist metadata under `.voicetree/terminals/<terminalId>.json`.
- The terminal tree sidebar shows "surviving agents" by scanning live tmux sessions that match VoiceTree's namespace but are not currently represented in the in-memory terminal registry.

That covers Electron/MCP registry loss while the tmux pane is still alive. It does not cover the next failure mode: the `.voicetree/terminals` metadata still says the agent was running, but the tmux pane no longer exists. For Claude and Codex, the underlying CLI session can usually be resumed from the same working directory with a CLI-native resume command. The feature should treat that as a different recovery action from attaching a live pane.

## Goals / Non-Goals

**Goals:**
- Discover resumable agent records from the current project's `.voicetree/terminals` directory.
- Keep attach-to-live-tmux and resume-from-CLI as distinct recovery states.
- Resume only supported Claude/Codex agents whose persisted metadata indicates they were not explicitly exited.
- Preserve terminal identity and graph relationships when the resumed process is rehydrated into the registry.
- Present recovery actions in the existing terminal tree sidebar without polluting normal `TerminalStore` membership.

**Non-Goals:**
- Resuming arbitrary custom CLIs or Gemini in this change.
- Guessing a missing command from an agent name when `terminalData.initialCommand` is absent.
- Resuming sessions from another vault namespace.
- Rewriting Claude/Codex local session stores or importing their native session ids into VoiceTree metadata.
- Treating every old metadata file as recoverable; exited/manual/invalid records stay non-actionable.

## Decisions

### D1. Use `.voicetree/terminals` metadata as the source for dead-pane resume candidates

**Choice:** Add a pure classifier that reads terminal metadata records and live tmux state, then returns recovery candidates. A record is resumable when it belongs to the current vault, has `status: "running"`, is not in the registry, its tmux session is absent, and its `terminalData.initialCommand` detects as Claude or Codex.

**Rationale:**
- The metadata already contains the terminal id, context/task attachment, parent terminal, initial spawn directory, initial env vars, initial command, agent name, and display metadata needed to rebuild the VoiceTree terminal record.
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

### D4. Share CLI detection and resume-command construction with stop-gate resume

**Choice:** Move or expose a pure helper near `headlessCli.ts` for `detectCliType` plus resume command construction. For this feature, support only:

- Claude: `claude --continue -p "$RESUME_PROMPT" --dangerously-skip-permissions`
- Codex: `codex exec resume --last -p "$RESUME_PROMPT" --full-auto`

The action may set `RESUME_PROMPT` to a small VoiceTree reconnection prompt, or an empty prompt if the CLI accepts it reliably; that behavior should be tested against the actual command builder.

**Rationale:**
- The repository already has CLI detection and stop-gate resume semantics; duplicating command strings would drift.
- Resume command generation is pure and belongs in shared runtime code, not the React sidebar.
- Keeping Gemini/custom CLIs unsupported is safer than pretending every CLI has compatible resume semantics.

**Alternatives considered:**
- Use the original `initialCommand` with a string replace. Rejected because `claude "$AGENT_PROMPT"` and `codex "$AGENT_PROMPT"` do not resume prior native CLI sessions.

### D5. Keep UI state separate from terminal registry state until recovery succeeds

**Choice:** The sidebar's recovery list should come from a recovery store adjacent to `UnclaimedTmuxStore`, backed by main-process polling. A resumable record does not enter `TerminalStore` until `resumePersistedAgentSession` succeeds.

**Rationale:**
- The terminal tree itself should continue to mean "currently registered terminals".
- Failed/stale recovery rows can be removed or refreshed without creating phantom terminal records.
- This keeps the UI behavior consistent with today's surviving-agents section.

**Alternatives considered:**
- Import all resumable records into `TerminalStore` as exited/pending rows. Rejected because normal agent-control tools would then see agents that are not actually routable.

## Risks / Trade-offs

- **Risk: stale metadata can point at a Claude/Codex session that the external CLI can no longer resume.** -> Re-run discovery before action, surface the CLI spawn failure in the row, and leave metadata unchanged unless a new tmux process is actually registered.
- **Risk: `codex exec resume --last` may resume the latest session for the working directory rather than the exact old VoiceTree terminal.** -> Keep the first implementation limited to the persisted `initialSpawnDirectory`, document the limitation in tests, and do not claim exact native session-id targeting unless metadata support is added later.
- **Risk: a metadata file marked `running` after an intentional UI detach is indistinguishable from a crash if its tmux pane later dies.** -> Treat "running metadata + missing tmux + supported CLI" as user-actionable, not automatic; the user chooses Resume.
- **Risk: duplicate recovery if another process reclaims the same terminal while the user clicks Resume.** -> The resume API must perform an action-time registry/tmux/metadata check and fail if the terminal is no longer resumable.
- **Trade-off: unsupported CLIs are not resumable.** This is intentional until each CLI has tested resume semantics.

## Migration Plan

- No data migration is required. Existing `.voicetree/terminals/*.json` files remain the input.
- Existing live-tmux surviving-agent attach behavior remains available.
- If the feature is rolled back, stale running metadata remains harmless; current reconciliation can still mark missing sessions exited.

## Open Questions

- Should `RESUME_PROMPT` be empty or a short VoiceTree reconnection prompt for user-triggered resume? The implementation should decide with a black-box CLI-command test and avoid sending a prompt that causes unwanted agent actions.
- If future metadata can store native Claude/Codex session ids, should the command builder prefer exact-session resume over "continue/latest"? This is out of scope for the first change.

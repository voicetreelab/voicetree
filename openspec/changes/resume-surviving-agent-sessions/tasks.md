## 1. Recovery model and discovery

- [ ] 1.1 Define a discriminated recovery-session type for live tmux attach rows and persisted CLI resume rows in `@vt/agent-runtime`.
- [ ] 1.2 Add pure metadata classification for `.voicetree/terminals/*.json` records: attachable live tmux, resumable missing tmux, exited, claimed, foreign vault, unsupported CLI, invalid.
- [ ] 1.3 Unit-test classification with black-box inputs covering Claude, Codex, exited metadata, unsupported CLI, invalid metadata, already-registered terminals, live tmux sessions, and missing tmux sessions.
- [ ] 1.4 Add an impure discovery function that reads the current vault terminal metadata, checks live tmux sessions, reuses current namespace scoping, and returns only actionable recovery rows to callers.

## 2. Shared CLI resume command support

- [ ] 2.1 Move or expose `buildResumeCommand` beside `detectCliType` so stop-gate resume and user-triggered recovery share one pure command builder.
- [ ] 2.2 Limit supported user-triggered resume commands to Claude and Codex, and return an explicit unsupported result for other detected or unknown CLIs.
- [ ] 2.3 Unit-test resume command construction for default Claude/Codex commands, env-prefixed Claude commands, Codex commands with existing hook flags, and unsupported custom commands.

## 3. Runtime resume action

- [ ] 3.1 Add `resumePersistedAgentSession(terminalId)` to `@vt/agent-runtime`; it must re-run discovery at action time and fail if the candidate is stale.
- [ ] 3.2 Spawn the resumed process through the tmux-backed terminal runtime using the persisted terminal id, terminal data, env vars, spawn directory, and shared resume command.
- [ ] 3.3 Preserve terminal identity fields on registry rehydration: context/task attachment, anchor, parent terminal id, title, agent name, agent type, worktree name, pinned/minimized defaults, and lifecycle.
- [ ] 3.4 Ensure successful resume writes fresh running metadata with the new tmux session reference and removes the row from future resumable discovery while live.
- [ ] 3.5 Ensure failed resume attempts do not mark metadata exited or add a registry record unless the runtime actually spawned and registered the terminal.
- [ ] 3.6 Add black-box runtime tests for successful Claude resume, successful Codex resume, stale candidate rejection, spawn failure preservation, and no duplicate registry records.

## 4. Main and renderer bridge

- [ ] 4.1 Expose discovery and resume APIs through the main runtime surface adjacent to `listUnclaimedTmuxSessions` / `attachUnclaimedTmuxSession`.
- [ ] 4.2 Add main-process polling/publishing for recovery rows so the renderer receives updates after startup, attach, resume, kill, and project switch.
- [ ] 4.3 Add a renderer store adjacent to `UnclaimedTmuxStore` that stores recovery rows, refreshes from main, removes rows only after successful action, and surfaces action errors.
- [ ] 4.4 Test store behavior with observable state changes rather than internal call expectations where practical: refresh populates rows, successful resume removes a row, failed resume keeps it with an error.

## 5. Terminal tree sidebar UX

- [ ] 5.1 Update the recovery section component to render attachable live tmux rows and resumable persisted rows with distinct labels and actions.
- [ ] 5.2 Keep resumable rows out of normal `TerminalStore`-derived tree rendering until resume succeeds.
- [ ] 5.3 Show actionable errors inline when resume fails, and refresh recovery rows after each attach, resume, or kill action.
- [ ] 5.4 Add React tests showing a resumable row with Resume, an attachable row with Attach, no duplicate normal terminal row, and error display on failed resume.

## 6. Verification and smoke

- [ ] 6.1 Run focused unit tests for agent-runtime recovery discovery/resume command/runtime behavior.
- [ ] 6.2 Run focused UI-edge/store/sidebar tests for recovery row rendering and actions.
- [ ] 6.3 Run `npm run test`.
- [ ] 6.4 Manual smoke: create or fixture a running metadata file whose tmux session is missing, confirm the sidebar shows Resume, resume it, confirm the terminal appears in the normal tree and is controllable.
- [ ] 6.5 Manual regression smoke: with a live unclaimed tmux session, confirm the sidebar still shows Attach and does not also show Resume for the same terminal.

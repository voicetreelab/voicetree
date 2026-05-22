## 1. Recovery model and discovery

- [ ] 1.1 Define a discriminated recovery-session type for live tmux attach rows and persisted CLI resume rows in `@vt/agent-runtime`.
- [ ] 1.2 Extend `.voicetree/terminals/<terminalId>.json` metadata types with `recovery.native` fields for provider cli, mode, session id, capture timestamp, resolver source, and optional provider store path.
- [ ] 1.3 Add pure metadata classification for `.voicetree/terminals/*.json` records: attachable live tmux, resumable missing tmux with native handle, missing native handle, exited, claimed, foreign vault, unsupported CLI, invalid.
- [ ] 1.4 Unit-test classification with black-box inputs covering Claude, Codex, missing native handle, exited metadata, unsupported CLI, invalid metadata, already-registered terminals, live tmux sessions, and missing tmux sessions.
- [ ] 1.5 Add an impure discovery function that reads the current vault terminal metadata, checks live tmux sessions, reuses current namespace scoping, and returns only actionable recovery rows to callers.

## 2. Native provider session id resolution

- [ ] 2.1 Add a Claude resolver that scans recently modified `~/.claude/projects/**/*.jsonl`, matches string user messages by `VOICETREE_TERMINAL_ID`, `VOICETREE_VAULT_PATH`, and `TASK_NODE_PATH`, and returns the transcript `sessionId`.
- [ ] 2.2 Add a Codex resolver that queries `~/.codex/state_5.sqlite` `threads`, matches `first_user_message` by `VOICETREE_TERMINAL_ID`, `VOICETREE_VAULT_PATH`, and `TASK_NODE_PATH`, and returns the full `threads.id`.
- [ ] 2.3 Persist successful resolver output into `.voicetree/terminals/<terminalId>.json` under `recovery.native`; resolver misses remain diagnostic and non-actionable.
- [ ] 2.4 Unit-test resolver matching with fixture Claude JSONL records and Codex `threads` rows, including reused terminal names, wrong vault, wrong task path, old timestamps, array-valued Claude message content, and duplicate candidates.

## 3. Shared CLI resume command support

- [ ] 3.1 Add a pure exact-session resume command builder beside `detectCliType`.
- [ ] 3.2 Limit supported user-triggered resume commands to Claude and Codex, and return an explicit unsupported result for other detected or unknown CLIs.
- [ ] 3.3 Unit-test resume command construction for Claude `--resume <session-id>`, interactive Codex `resume <thread-id>`, headless Codex `exec resume <thread-id>`, existing hook flags, and unsupported custom commands.

## 4. Runtime resume action

- [ ] 4.1 Add `resumePersistedAgentSession(terminalId)` to `@vt/agent-runtime`; it must re-run discovery at action time and fail if the candidate is stale.
- [ ] 4.2 Spawn the resumed process through the tmux-backed terminal runtime using the persisted terminal id, terminal data, env vars, spawn directory, and exact-session resume command.
- [ ] 4.3 Preserve terminal identity fields on registry rehydration: context/task attachment, anchor, parent terminal id, title, agent name, agent type, worktree name, pinned/minimized defaults, and lifecycle.
- [ ] 4.4 Ensure successful resume writes fresh running metadata with the new tmux session reference and removes the row from future resumable discovery while live.
- [ ] 4.5 Ensure failed resume attempts do not mark metadata exited or add a registry record unless the runtime actually spawned and registered the terminal.
- [ ] 4.6 Add black-box runtime tests for successful Claude resume, successful Codex resume, stale candidate rejection, missing native handle rejection, spawn failure preservation, and no duplicate registry records.

## 5. Main and renderer bridge

- [ ] 5.1 Expose discovery and resume APIs through the main runtime surface adjacent to `listUnclaimedTmuxSessions` / `attachUnclaimedTmuxSession`.
- [ ] 5.2 Add main-process polling/publishing for recovery rows so the renderer receives updates after startup, attach, resume, kill, and project switch.
- [ ] 5.3 Add a renderer store adjacent to `UnclaimedTmuxStore` that stores recovery rows, refreshes from main, removes rows only after successful action, and surfaces action errors.
- [ ] 5.4 Test store behavior with observable state changes rather than internal call expectations where practical: refresh populates rows, successful resume removes a row, failed resume keeps it with an error.

## 6. Terminal tree sidebar UX

- [ ] 6.1 Update the recovery section component to render attachable live tmux rows and resumable persisted rows with distinct labels and actions.
- [ ] 6.2 Keep resumable rows out of normal `TerminalStore`-derived tree rendering until resume succeeds.
- [ ] 6.3 Show actionable errors inline when resume fails, and refresh recovery rows after each attach, resume, or kill action.
- [ ] 6.4 Add React tests showing a resumable row with Resume, an attachable row with Attach, no duplicate normal terminal row, and error display on failed resume.

## 7. Verification and smoke

- [ ] 7.1 Run focused unit tests for agent-runtime recovery discovery/resume command/runtime behavior.
- [ ] 7.2 Run focused UI-edge/store/sidebar tests for recovery row rendering and actions.
- [ ] 7.3 Run `npm run test`.
- [ ] 7.4 Manual smoke: create or fixture a running metadata file whose tmux session is missing and has `recovery.native.sessionId`, confirm the sidebar shows Resume, resume it, confirm the terminal appears in the normal tree and is controllable.
- [ ] 7.5 Manual regression smoke: with a live unclaimed tmux session, confirm the sidebar still shows Attach and does not also show Resume for the same terminal.

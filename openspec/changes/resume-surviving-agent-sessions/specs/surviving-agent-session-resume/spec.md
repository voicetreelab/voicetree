## ADDED Requirements

### Requirement: Discover resumable persisted agent sessions

The system SHALL discover resumable agent sessions from the current project's `.voicetree/terminals` metadata in addition to live unclaimed tmux sessions. A persisted record is resumable only when its metadata status is `running`, it belongs to the current project, it is not already represented in the terminal registry, its expected tmux session is not alive, its persisted terminal data identifies a supported Claude or Codex command, and its metadata contains a deterministic native session handle.

#### Scenario: Persisted running Claude record with missing tmux pane is resumable
- **WHEN** `.voicetree/terminals/A.json` contains a valid running terminal metadata record for terminal `A`
- **AND** terminal `A` is not present in the in-memory terminal registry
- **AND** the tmux session referenced by the metadata is not alive
- **AND** `terminalData.initialCommand` detects as Claude
- **AND** the metadata contains `recovery.native.cli === "claude"` and `recovery.native.sessionId`
- **THEN** discovery returns a resumable session for terminal `A`
- **AND** the session includes terminal id, agent name, CLI type, native session id, metadata path, task/context paths, and original spawn directory

#### Scenario: Persisted running Codex record with missing tmux pane is resumable
- **WHEN** `.voicetree/terminals/B.json` contains a valid running terminal metadata record for terminal `B`
- **AND** terminal `B` is not present in the in-memory terminal registry
- **AND** the tmux session referenced by the metadata is not alive
- **AND** `terminalData.initialCommand` detects as Codex
- **AND** the metadata contains `recovery.native.cli === "codex"` and `recovery.native.sessionId`
- **THEN** discovery returns a resumable session for terminal `B`

### Requirement: Persist deterministic native resume handles in project terminal metadata

The system SHALL read Claude/Codex provider-global stores as resolver inputs and persist the resolved native session id into the existing project-local `.voicetree/terminals/<terminalId>.json` file. Provider-global stores SHALL NOT be treated as the durable VoiceTree recovery record.

#### Scenario: Claude resolver persists a transcript session id
- **WHEN** a Claude agent has been spawned for terminal `A`
- **AND** a recently modified `~/.claude/projects/**/*.jsonl` transcript contains a user message whose string content includes `VOICETREE_TERMINAL_ID = A`, the current `VOICETREE_PROJECT_PATH`, and the terminal's `TASK_NODE_PATH`
- **THEN** VoiceTree writes `recovery.native.cli === "claude"` to `.voicetree/terminals/A.json`
- **AND** `recovery.native.sessionId` equals the transcript record's `sessionId`
- **AND** `recovery.native.source === "claude-project-transcript"`

#### Scenario: Codex resolver persists a thread id
- **WHEN** a Codex agent has been spawned for terminal `B`
- **AND** `~/.codex/state_5.sqlite` table `threads` contains a recent row whose `first_user_message` includes `VOICETREE_TERMINAL_ID = B`, the current `VOICETREE_PROJECT_PATH`, and the terminal's `TASK_NODE_PATH`
- **THEN** VoiceTree writes `recovery.native.cli === "codex"` to `.voicetree/terminals/B.json`
- **AND** `recovery.native.sessionId` equals the Codex `threads.id` value
- **AND** `recovery.native.source === "codex-state-index"`

#### Scenario: Resolver miss is diagnostic, not resumable
- **WHEN** a Claude or Codex terminal metadata file has no `recovery.native.sessionId`
- **THEN** discovery does not return an actionable Resume row for that terminal
- **AND** the non-actionable reason identifies the missing native session handle

### Requirement: Exclude non-resumable persisted records

The system SHALL NOT offer resume for persisted terminal metadata that is explicitly exited, already claimed, foreign to the current project, invalid, unsupported by CLI type, or still has a live tmux pane that should be attached instead.

#### Scenario: Exited metadata is not resumable
- **WHEN** a terminal metadata file has `status: "exited"`
- **THEN** discovery does not return a resumable session for that metadata file

#### Scenario: Live unclaimed tmux pane remains an attach action
- **WHEN** a valid running terminal metadata file references a tmux session that is alive
- **AND** that tmux session is not represented in the in-memory terminal registry
- **THEN** discovery returns the session through the live tmux attach path
- **AND** discovery does not also return a resumable CLI session for the same terminal id

#### Scenario: Unsupported CLI is not resumable
- **WHEN** a valid running terminal metadata file has an `initialCommand` that does not detect as Claude or Codex
- **THEN** discovery does not return an actionable resumable session for that metadata file

#### Scenario: Already-claimed terminal is not duplicated
- **WHEN** the terminal registry already contains terminal `A`
- **AND** `.voicetree/terminals/A.json` exists
- **THEN** discovery does not return a resumable session for terminal `A`

### Requirement: Surface resumable sessions in the terminal tree sidebar

The terminal tree sidebar SHALL show resumable persisted sessions in the same recovery area as surviving agents while keeping normal terminal rows derived only from registered terminals. Resumable rows SHALL expose a Resume action, not an Attach action.

#### Scenario: Sidebar shows a resumable session without adding a terminal row
- **WHEN** discovery returns a resumable persisted session for terminal `A`
- **AND** terminal `A` is not registered
- **THEN** the terminal tree sidebar shows a recovery row for `A` with a Resume action
- **AND** `TerminalStore.getTerminals()` does not contain `A`
- **AND** the normal terminal tree does not render `A` as a registered terminal row

#### Scenario: Sidebar distinguishes attachable and resumable recovery rows
- **WHEN** discovery returns one live unclaimed tmux session and one resumable persisted session
- **THEN** the live tmux session row presents Attach
- **AND** the resumable persisted session row presents Resume

### Requirement: Resume a persisted Claude or Codex session

When the user resumes a resumable persisted session, the system SHALL launch a new tmux-backed terminal using the persisted terminal identity, environment, spawn directory, and a CLI-native resume command for the detected CLI type.

#### Scenario: Resume Claude session
- **WHEN** the user clicks Resume for a resumable Claude session `A`
- **THEN** the runtime launches a tmux-backed terminal for `A` using a Claude resume command
- **AND** the command includes `claude --resume <session-id>` using `recovery.native.sessionId`
- **AND** the process runs from `terminalData.initialSpawnDirectory` when present
- **AND** the process receives the persisted `terminalData.initialEnvVars`

#### Scenario: Resume Codex session
- **WHEN** the user clicks Resume for a resumable Codex session `B`
- **THEN** the runtime launches a tmux-backed terminal for `B` using a Codex resume command
- **AND** the command includes `codex resume <thread-id>` for interactive terminals or `codex exec resume <thread-id>` for headless terminals using `recovery.native.sessionId`
- **AND** the process runs from `terminalData.initialSpawnDirectory` when present
- **AND** the process receives the persisted `terminalData.initialEnvVars`

#### Scenario: Resume action revalidates before spawning
- **WHEN** the sidebar shows terminal `A` as resumable
- **AND** terminal `A` becomes registered, exited, deleted, or live in tmux before the user clicks Resume
- **THEN** the resume action fails without spawning a duplicate terminal
- **AND** the recovery list refreshes from current state

### Requirement: Rehydrate resumed sessions into existing terminal identity

After a resume action succeeds, the system SHALL register the resumed process under the original terminal id and preserve the persisted terminal metadata that defines graph attachment, sidebar identity, parent/child relationship, task context, agent name, and display state.

#### Scenario: Successful resume restores terminal registry identity
- **WHEN** resume succeeds for terminal `A`
- **THEN** the terminal registry contains a running record with terminal id `A`
- **AND** the record preserves `attachedToContextNodeId`, `anchoredToNodeId`, `parentTerminalId`, `agentName`, `agentTypeName`, `worktreeName`, and `title` from the persisted terminal data
- **AND** the sidebar removes `A` from the recovery list
- **AND** the normal terminal tree renders `A` in its prior parent/child position

#### Scenario: Successful resume writes fresh running metadata
- **WHEN** resume succeeds for terminal `A`
- **THEN** `.voicetree/terminals/A.json` remains a running metadata record
- **AND** its tmux session reference points to the newly launched tmux session
- **AND** subsequent discovery no longer returns `A` as resumable while that session is alive

### Requirement: Report resume failures without corrupting recovery state

If a resume attempt fails, the system SHALL surface the failure to the sidebar and SHALL NOT delete, mark exited, or otherwise corrupt the persisted terminal metadata unless the failure proves the metadata is invalid.

#### Scenario: CLI resume spawn fails
- **WHEN** the user clicks Resume for terminal `A`
- **AND** the runtime fails to spawn the Claude or Codex resume command
- **THEN** the sidebar displays an error for the recovery action
- **AND** terminal `A` is not added to the terminal registry
- **AND** `.voicetree/terminals/A.json` is not marked exited solely because the spawn failed

#### Scenario: Metadata parse fails during discovery
- **WHEN** a file in `.voicetree/terminals` cannot be parsed as terminal metadata
- **THEN** discovery skips that file
- **AND** valid recovery rows from other metadata files are still returned

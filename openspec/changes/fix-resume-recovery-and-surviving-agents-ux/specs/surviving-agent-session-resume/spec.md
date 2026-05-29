## MODIFIED Requirements

### Requirement: Discover resumable persisted agent sessions

The system SHALL discover resumable agent sessions from the canonical `<projectRoot>/.voicetree/terminals/` directory, where `projectRoot` is resolved from the graph bridge (`getProjectRoot()`), NOT from `writeFolder` or `process.env.VOICETREE_PROJECT_PATH`. Discovery SHALL include records with `status` of `running`, `exited`, or `killed`, scoped to the current vault namespace. Records SHALL be classified as: attachable-live-tmux, resumable-dead-tmux, recently-closed, exited, killed, unsupported, foreign-vault, or invalid. Records older than the recency horizon (configurable, default 7 days since `endedAt` or `startedAt`) SHALL be omitted to keep the list bounded.

#### Scenario: Discovery reads from projectRoot regardless of writeFolder
- **WHEN** the current vault has `projectRoot = /a/b` and `writeFolder = /a/b/sub` (writeFolder differs from projectRoot)
- **AND** `/a/b/.voicetree/terminals/Noa.json` exists with a valid metadata record
- **THEN** discovery returns a row for `Noa`
- **AND** discovery does NOT read from `/a/b/sub/.voicetree/terminals/`

#### Scenario: Exited record within horizon is surfaced
- **WHEN** `/projectRoot/.voicetree/terminals/Iris.json` has `status: "exited"` and `endedAt` within the last 7 days
- **AND** `Iris` is not in the in-memory terminal registry
- **THEN** discovery returns a recovery row for `Iris` marked as exited
- **AND** the row carries `endedAt`, `worktreeName`, `title`, `agentTypeName`

#### Scenario: Record older than horizon is omitted
- **WHEN** `/projectRoot/.voicetree/terminals/OldOne.json` has `endedAt` 30 days ago
- **AND** the configured horizon is 7 days
- **THEN** discovery does NOT return a row for `OldOne`
- **AND** the on-disk JSON is left intact (no automatic deletion)

#### Scenario: Missing terminals directory returns empty list, not error
- **WHEN** `<projectRoot>/.voicetree/terminals/` does not exist
- **THEN** discovery returns an empty list
- **AND** does not throw

### Requirement: Surface row context fields for every recovery row

Every recovery row (attachable, resumable, or recently-closed) SHALL carry `worktreeName`, `title`, `agentTypeName`, `startedAt`, and (when applicable) `endedAt` and `killReason`, sourced from the persisted `terminalData`. The sidebar SHALL render these fields with the same visual treatment used by live terminal tiles, so resumable rows are visually consistent with normal terminals.

#### Scenario: Sidebar shows worktree + title on every recovery row
- **WHEN** discovery returns a row for terminal `A` whose `terminalData.worktreeName = "wt-foo"` and `terminalData.title = "Refactor X"`
- **THEN** the recovery row in `SurvivingAgentsSection` shows "wt-foo" and "Refactor X"
- **AND** shows an "agent type" badge with the value of `terminalData.agentTypeName` (e.g. "Claude" or "Codex")

#### Scenario: Missing worktree/title degrades gracefully
- **WHEN** the persisted record has no `worktreeName` or `title`
- **THEN** the row renders the terminal id as fallback title
- **AND** omits the worktree chip rather than displaying empty markup

## ADDED Requirements

### Requirement: Permanently delete a persisted recovery record

The system SHALL provide a per-row Delete action on Surviving Agents rows that removes the on-disk metadata JSON and its sibling artifacts (`<name>.log`, `<name>-prompt.txt`, `<name>.exitcode`) from `<projectRoot>/.voicetree/terminals/`. Deletion SHALL require a confirm step, SHALL refresh discovery state immediately, and SHALL be exposed through the runtime as `removePersistedAgentRecord(terminalId)`.

#### Scenario: Delete removes JSON + sibling files
- **WHEN** the user clicks Delete on the recovery row for `Iris` and confirms
- **THEN** `Iris.json`, `Iris.log`, `Iris-prompt.txt`, `Iris.exitcode` are removed from `<projectRoot>/.voicetree/terminals/`
- **AND** the recovery row disappears from the sidebar
- **AND** subsequent discovery polls do not surface `Iris`

#### Scenario: Delete refuses to remove a live registry record
- **WHEN** `Ama` is currently in the in-memory terminal registry (live, attached)
- **THEN** the Delete action is disabled / hidden for `Ama`'s row
- **AND** calling `removePersistedAgentRecord("Ama")` from the runtime returns `{kind: "refused", reason: "live-registry-entry"}`

#### Scenario: Delete after the JSON already disappeared is idempotent
- **WHEN** the JSON for `Gone` was already removed (manually or by another process) when the user clicks Delete
- **THEN** the action returns `{kind: "removed"}` without error
- **AND** the row is removed from the sidebar

### Requirement: Native session resolver miss carries a structured reason

When `resolveNativeSession` returns `not-found`, the result SHALL include a `reason` discriminant identifying why the lookup failed. Resume failures driven by a resolver miss SHALL propagate the reason to the UI, and the UI SHALL render the reason plus (where applicable) a copy-to-clipboard manual resume command line.

Codex resolver `reason` values:
- `db-missing` — `~/.codex/state_5.sqlite` does not exist
- `db-schema-mismatch` — the file exists but the `threads` table or expected columns are absent
- `outside-recency-window` — no rows matched within the resolver's recency window (default 24h)
- `marker-mismatch` — recent rows exist but none contain all three VoiceTree markers
- `no-rows` — the `threads` table is empty for the relevant window

Claude resolver `reason` values:
- `projects-dir-missing` — `~/.claude/projects` does not exist
- `no-jsonl-matches` — no transcript JSONL files were found for the vault/cwd
- `marker-mismatch` — JSONLs were scanned but none contained all three VoiceTree markers
- `scan-timeout` — scan exceeded its time budget before completion

#### Scenario: Codex resolver miss with no DB returns db-missing
- **WHEN** `~/.codex/state_5.sqlite` does not exist
- **AND** the user clicks Resume on a Codex recovery row
- **THEN** `resolveNativeSession` returns `{kind: "not-found", reason: "db-missing"}`
- **AND** the UI surfaces a toast: "Cannot resume: Codex state database not found at ~/.codex/state_5.sqlite"

#### Scenario: Outside-recency-window miss offers manual command
- **WHEN** the codex thread for terminal `Old` exists in the DB but was created 30 days ago
- **AND** resolver recency window is 24h
- **THEN** resume fails with `{kind: "no-native-session", reason: "outside-recency-window"}`
- **AND** the UI surfaces the reason
- **AND** the UI offers a "Copy manual resume command" button with the literal text `codex resume <id>` (id obtained by widening the resolver query to drop the recency filter for the diagnostic-only lookup)

#### Scenario: Marker mismatch reports actionable detail
- **WHEN** the resolver finds candidate rows but none contain `VOICETREE_TERMINAL_ID = <id>` matched against this vault
- **THEN** `not-found` reason is `marker-mismatch`
- **AND** the UI says: "No matching session — likely the vault was moved or the task node renamed since spawn"

### Requirement: Codex Resume produces a manually-runnable `codex resume` command

The Resume action for an interactive Codex agent SHALL build a command equivalent to the verified-working manual invocation `codex resume <sessionId>`. Any preserved `-c 'hooks.…'` flags from the original spawn MAY be appended (codex accepts hook overrides on `resume`), but no other transformation is permitted: the bare `codex resume <id>` form MUST run unchanged when the user copies it into a terminal in the same `cwd` with the same env. Headless mode SHALL produce the equivalent `codex exec resume <id>` form.

#### Scenario: Interactive codex resume matches manual command
- **WHEN** the user clicks Resume on a codex recovery row whose `recovery.native.sessionId = "019e651e-b53e-79a0-815a-f6247aca3724"`
- **AND** the original spawn used interactive mode (not headless)
- **THEN** the built command begins with `codex resume 019e651e-b53e-79a0-815a-f6247aca3724`
- **AND** the command runs from `terminalData.initialSpawnDirectory`
- **AND** the command receives `terminalData.initialEnvVars`
- **AND** running the bare `codex resume <id>` form manually in that cwd / env yields the same restored session

#### Scenario: Hook flags from original command are preserved
- **WHEN** the original `initialCommand` contained `-c 'hooks.Stop=[{type="command",command="curl ..."}]'`
- **THEN** the built resume command appends that exact `-c 'hooks.Stop=...'` token verbatim
- **AND** no other flags are added beyond `codex resume <id>` + preserved hook flags

#### Scenario: Headless codex resume uses exec resume
- **WHEN** the recovery row's `terminalData.isHeadless = true`
- **THEN** the built command begins with `codex exec resume <id>`

### Requirement: Persisted recovery records SHALL live under projectRoot

All writers of `.voicetree/terminals/*.json` (tmux spawn, reconciliation, hook handlers, runtime APIs) SHALL write to `<projectRoot>/.voicetree/terminals/`. Writing to `<writeFolder>/.voicetree/terminals/` is prohibited. On vault open, a one-time migration SHALL detect legacy records in `<writeFolder>/.voicetree/terminals/` (when `writeFolder ≠ projectRoot`) and move them and their sibling artifacts into the canonical location. The migration SHALL be idempotent and SHALL leave the source directory empty (but not removed) so external tooling that watches it does not break.

#### Scenario: Spawn writes to projectRoot path
- **WHEN** a tmux-backed terminal is spawned in a vault with `projectRoot = /a/b` and `writeFolder = /a/b/sub`
- **THEN** the metadata JSON is written to `/a/b/.voicetree/terminals/<id>.json`
- **AND** no JSON appears in `/a/b/sub/.voicetree/terminals/`

#### Scenario: Migration moves legacy records on first open
- **WHEN** vault opens with `projectRoot = /a/b`, `writeFolder = /a/b/sub`
- **AND** `/a/b/sub/.voicetree/terminals/X.json` exists from a prior install
- **AND** `/a/b/.voicetree/terminals/` is empty or missing
- **THEN** `X.json` (and `X.log`, `X-prompt.txt`, `X.exitcode` if present) are moved to `/a/b/.voicetree/terminals/`
- **AND** discovery on next poll returns a row for `X`

#### Scenario: Migration skips conflicts safely
- **WHEN** both `/a/b/sub/.voicetree/terminals/X.json` and `/a/b/.voicetree/terminals/X.json` exist
- **THEN** the canonical (`/a/b/.voicetree/...`) copy wins
- **AND** the legacy copy is left untouched
- **AND** a one-line warning is logged identifying the conflict

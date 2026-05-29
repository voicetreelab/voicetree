## 1. Canonical metadata location: `<projectRoot>/.voicetree/terminals/`

- [x] 1.1 Add `getRecoveryMetadataDir(projectRoot: string): string` helper in `@vt/agent-runtime/src/application/recovery/paths.ts` returning `path.join(projectRoot, '.voicetree', 'terminals')`. Cover with unit test.
- [x] 1.2 Refactor `reconcileTmuxTerminalRegistry(projectRoot, deps)` in `packages/systems/agent-runtime/src/application/terminals/terminal-registry/reconciliation.ts:74-129` to use `getRecoveryMetadataDir(projectRoot)`. The `projectRoot` argument's documented semantics now require the value returned by `graph.getProjectRoot()`, NOT writeFolder / env.
- [x] 1.3 Update `webapp/src/shell/edge/main/runtime/electron/daemon/lifecycle/graph-model-init.ts:75` to pass `info.projectRoot` (or pull from `getRuntimeProjectRoot()`) instead of `info.writeFolder`. Confirm the graph-model `onVaultOpened` event carries `projectRoot`; if it doesn't, add it to the event payload first.
- [x] 1.4 Update `webapp/src/shell/edge/main/runtime/electron/app/main.ts:262-267` to either drop the startup reconciliation call (now redundant with `onVaultOpened`) or resolve `projectRoot` through the graph bridge. Delete the `process.env.VOICETREE_PROJECT_PATH`-driven branch.
- [x] 1.5 Update `webapp/src/shell/edge/main/cli/commands/runtime/serve.ts:180` and `packages/systems/voicetree-mcp/bin/vt-mcpd.ts:160` to derive `projectRoot` from `args.vault`'s graph-bridge probe (or document that headless callers MUST pass projectRoot, not writeFolder).
- [x] 1.6 Refactor `discovery.ts:resolveCurrentVaultMetadataDir` (`packages/systems/agent-runtime/src/application/recovery/discovery.ts:172-178`) to use `getRecoveryMetadataDir(getRuntimeProjectRoot())`. Delete the `writeFolder/terminals` (no-`.voicetree`) fallback branch.
- [x] 1.7 Add black-box test in `discovery.test.ts` asserting the metadata dir is `<projectRoot>/.voicetree/terminals/` regardless of writeFolder (mock `runtimeEnv.getWriteFolder` to return a different path; verify discovery reads only projectRoot path).
- [x] 1.8 Audit `tmuxHeadlessRuntime.ts` and any other writer of `.voicetree/terminals/*.json` (grep for `'terminals'` joins). Update each writer to use `getRecoveryMetadataDir(projectRoot)`.

## 2. One-time migration: legacy → canonical

- [x] 2.1 Add `packages/systems/agent-runtime/src/application/recovery/migrate-legacy-terminal-dir.ts` exporting `migrateLegacyTerminalDir({projectRoot, writeFolder, logger})`. Returns `{moved: string[], conflicts: string[], skipped: string[]}`.
- [x] 2.2 Implementation rules: no-op when `writeFolder === projectRoot` or when legacy dir does not exist. For each `<id>.json` in `<writeFolder>/.voicetree/terminals/`: if `<projectRoot>/.voicetree/terminals/<id>.json` exists → log conflict + skip; else `fs.rename` the JSON and each existing sibling artifact (`<id>.log`, `<id>-prompt.txt`, `<id>.exitcode`).
- [x] 2.3 Write `MIGRATED.txt` into the legacy dir on first successful move pointing users at the canonical location.
- [x] 2.4 Invoke the migration synchronously from `onVaultOpened`, BEFORE `reconcileTmuxTerminalsForVault(...)`. Order matters — reconciliation must see the post-move state.
- [x] 2.5 Unit-test migration: no-op when paths equal; idempotent when run twice; conflict path keeps canonical copy + logs warning; missing sibling artifacts don't break (skip silently); malformed JSON files are migrated as-is (don't try to parse).

## 3. Structured resolver-miss reasons

- [x] 3.1 Widen `NativeSessionResult` in `packages/systems/agent-runtime/src/application/recovery/resolvers/resolveNativeSession.ts` to `{kind: 'not-found', reason: NativeSessionMissReason}`. Define `NativeSessionMissReason` as the union from the spec (5 codex + 4 claude variants).
- [x] 3.2 Update `resolveCodexNativeSession`: try/catch open → `db-missing`. Try/catch prepared statement → `db-schema-mismatch`. Returned rows empty → distinguish `no-rows` vs `outside-recency-window` via second query without time filter (drop the `WHERE updated_at_ms >= ?` clause). Rows non-empty but no marker match → `marker-mismatch`.
- [x] 3.3 Update `resolveClaudeNativeSession` with analogous reasons: `projects-dir-missing` / `no-jsonl-matches` / `marker-mismatch` / `scan-timeout` (wrap scan in `Promise.race` with a configurable timeout).
- [x] 3.4 Propagate the reason through `resumePersistedAgentSession.ts:79` so `{kind: 'no-native-session'}` becomes `{kind: 'no-native-session', cliType, reason}`. Update `forkAgentSession.ts` analogously.
- [x] 3.5 Update resolver tests (`resolveCodexNativeSession.test.ts`, `resolveClaudeNativeSession.test.ts`) to assert each reason variant. Add fixtures for missing DB, missing table, empty rows, and marker mismatch.
- [x] 3.6 For the `outside-recency-window` reason, return the discovered native session id alongside the reason so the UI can offer a copy-resume-command button. Update `NativeSessionResult` accordingly: `{kind: 'not-found', reason: 'outside-recency-window', diagnosticSessionId: string}`.

## 4. Codex resume command — regression guard

- [x] 4.1 Add a test in `resumeCli.test.ts` asserting the interactive Codex builder emits a command whose first three tokens are `codex resume <sessionId>` and that the bare 3-token form parses (no extra flags inserted before `<sessionId>`).
- [x] 4.2 Add a test asserting headless Codex emits `codex exec resume <id>` (first four tokens).
- [x] 4.3 Add a test that hook flags from the original command are appended after the session id, not before, and preserved verbatim (use the real-world Stop-hook string format from `Jin.json` as the fixture).

## 5. Surviving Agents UX: worktree + title + agent-type parity

- [x] 5.1 Extend `RecoverableAgentSession` payload (`packages/systems/agent-runtime/src/application/recovery/types.ts`) to surface `worktreeName`, `title`, `agentTypeName`, `endedAt`, `killReason` from `terminalData`. Already present in `classifier.normalizeMetadataTerminalData` — just plumb to the row level.
- [x] 5.2 Update `SurvivingAgentsSection` renderer to display worktree chip, title (mono-truncated to one line), and an agent-type badge (Claude / Codex). Match the styling used by live terminal tiles.
- [x] 5.3 Snapshot/visual regression test for SurvivingAgentsSection with three rows: claude-resumable, codex-resumable, recently-exited.
- [x] 5.4 Graceful-degradation test: row with missing worktree/title falls back to terminal id without empty markup.

## 6. Include exited/killed rows + recency horizon

- [x] 6.1 Update `classifyRecord` (`packages/systems/agent-runtime/src/application/recovery/classifier.ts:146`) to return `kind: 'recoverable'` for `status: 'exited'` and `status: 'killed'` records when within horizon, with a `closedAt` field on the row.
- [x] 6.2 Add `RECOVERY_HORIZON_MS` constant defaulting to `7 * 24 * 60 * 60 * 1000`. Read override from `process.env.VOICETREE_RECOVERY_HORIZON_DAYS`.
- [x] 6.3 Update `discoverRecoverableAgentSessions` to drop rows whose `endedAt` (fallback `startedAt`) is older than `now() - RECOVERY_HORIZON_MS`. Done at the sort step in `discovery.ts:sortRecords` or earlier.
- [x] 6.4 Sort rows: live-tmux-attachable first, resumable-dead-tmux next, recently-closed last; within each group sort by `endedAt`/`startedAt` desc.
- [x] 6.5 Add UI "show older" link that re-fetches with horizon disabled. Use the existing renderer poll path; pass a `horizonDays` override.
- [x] 6.6 Black-box tests in `discovery.test.ts`: exited row within horizon is included; exited row outside horizon is dropped; killed row is included with `killReason` propagated; live + exited interleave is sorted correctly.

## 7. Per-row Delete action

- [x] 7.1 Add `removePersistedAgentRecord(terminalId, deps)` to `packages/systems/agent-runtime/src/application/recovery/removePersistedAgentRecord.ts`. Validates `terminalId` matches `/^[A-Za-z0-9_-]+$/`; refuses if live registry contains it; unlinks `<id>.json`, `<id>.log`, `<id>-prompt.txt`, `<id>.exitcode` under `<projectRoot>/.voicetree/terminals/`; returns `{kind: 'removed'} | {kind: 'refused', reason} | {kind: 'invalid-id'}`.
- [x] 7.2 Export from `agent-runtime-api.ts`. Wire MCP / IPC surface through `terminalRuntimeSurface`.
- [x] 7.3 Unit-test: removes JSON + siblings; idempotent on missing files; refuses when live; rejects malicious ids (`../foo`, `id with spaces`, etc).
- [x] 7.4 Renderer: add trash button on each Surviving Agents row (visible on hover, like the kill button on live tiles). Click → confirm dialog ("Permanently delete `<id>` history and logs?") → calls the runtime action → refreshes store.
- [x] 7.5 UI test: click trash → confirm → row disappears + JSON file no longer exists on disk.

## 8. Resume failure UX: structured reason toast + manual command copy

- [x] 8.1 Update the Resume failure toast in the renderer to render the structured `reason` from `{kind: 'no-native-session', reason}`. Map each reason to a one-line plain-language message (Codex DB missing → "Codex state database not found at ~/.codex/state_5.sqlite", etc.).
- [x] 8.2 When `reason === 'outside-recency-window'` and `diagnosticSessionId` is present, render a secondary "Copy manual resume command" button. Click writes `codex resume <id>` (or `claude --resume <id>`) to system clipboard and toasts "Copied".
- [x] 8.3 UI tests covering each reason variant: rendered message, copy button presence (only for outside-recency-window), clipboard content correctness.

## 9. Cross-cutting validation

- [ ] 9.1 Manual smoke test on the affected vault (`/Users/example/Voicetree/voicetree-26-5/`): remove the temporary symlink, restart Electron, verify all 50 agents appear in Surviving Agents with worktree+title; click Resume on Jin → produces `codex resume 019e651e-...`; click Delete on a stale row → JSON gone. **Orchestrator + user — requires real vault and electron restart.**
- [x] 9.2 Add an end-to-end Playwright spec covering the crash-recovery flow: spawn 3 agents → kill electron → reopen → assert all 3 surface in Surviving Agents → Resume one → assert it becomes a live terminal. **Scoped to fixture-backed discovery→render→attach (per leading comment); real SIGKILL variant deferred to follow-up since Phase 6 single-agent crash test already covers the kill primitive.**
- [x] 9.3 Update `docs/RECOVERY.md` (or create) with the new canonical location, the migration behavior, and the resolver-miss reasons + manual-resume escape hatch.
- [x] 9.4 Add a project memory / brain note (`~/brain/knowledge/`) capturing the projectRoot-vs-writeFolder distinction, so future agents don't re-introduce the divergence.

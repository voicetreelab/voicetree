## Why

The `resume-surviving-agent-sessions` change shipped Resume/Attach for orphaned agents, but in real recovery situations it silently fails. When VoiceTree's dev process crashes and the user reopens the vault, all previously-spawned agents stay invisible in the Surviving Agents UI even though their tmux metadata is on disk. Root cause: discovery reads from `<projectRoot>/.voicetree/terminals/` while reconciliation **writes** to `<writeFolder>/.voicetree/terminals/`. When the user-loaded folder differs from the vault's write folder (e.g. project root contains the vault as a subdirectory), the directories diverge, `readdirSync` throws ENOENT, the error is silently swallowed, and the user sees zero recoverable rows.

Two adjacent gaps make recovery painful even when discovery does find rows: Surviving Agents rows lack the worktree + task title shown by live terminal tiles, and there's no way to permanently remove rows the user has finished with (closed/killed agents linger forever, and manually deleted-from-UI agents stay on disk). Finally, when the native session resolver SQL/JSONL scan returns no match, the UI surfaces a generic "no native session" with no actionable reason — users can't tell if the codex DB rotated, the recency window expired, or markers got mutated.

## What Changes

- **BREAKING (internal):** Make `<projectRoot>/.voicetree/` the single canonical location for all VoiceTree per-project data (terminal metadata, hooks, positions, settings overrides, folder visibility). `writeFolder/.voicetree/` is deprecated as a metadata location.
- Change `reconcileTmuxTerminalRegistry` to resolve its terminal directory from `projectRoot` (graph bridge), not from a caller-supplied path. Update all callers (`graph-model-init.ts:75`, `webapp main.ts:263`, `vt serve`, `vt-mcpd`) to stop passing `writeFolder` / `VOICETREE_VAULT_PATH`.
- Change `discovery.ts:resolveCurrentVaultMetadataDir` to read from `<projectRoot>/.voicetree/terminals/` only. Drop the buggy `writeFolder/terminals` fallback that omits the `.voicetree` prefix.
- Add a one-time on-startup migration that detects legacy `<writeFolder>/.voicetree/terminals/*.json` and moves files into `<projectRoot>/.voicetree/terminals/` (no-op when paths already match).
- **Surviving Agents row parity:** render `worktreeName` and the agent's task title on each Surviving Agents row, matching live terminal tile presentation. Show `agentTypeName` (Claude / Codex) as a badge.
- **Show all recent agents:** expand Surviving Agents to include `status: exited` and `status: killed` records (not just non-claimed running-but-dead). Order by `endedAt` (or `startedAt` if missing) descending. Cap at a configurable horizon (default: last 7 days) to keep the list bounded.
- **Per-row delete:** add an X / trash button on each Surviving Agents row that deletes the on-disk metadata JSON (and its sibling `.log`, `-prompt.txt`, `.exitcode` files) after a confirm prompt. Refreshes discovery state immediately.
- **Resolver diagnostics:** widen `NativeSessionResult` to carry a structured `reason` when `not-found` (codex: `db-missing` / `db-schema-mismatch` / `outside-recency-window` / `marker-mismatch` / `no-rows`; claude: `projects-dir-missing` / `no-jsonl-matches` / `marker-mismatch` / `scan-timeout`). Plumb this through `resumePersistedAgentSession` and surface it in the UI's Resume failure toast.
- Add a "Why can't I resume?" affordance that, on resolver miss, shows the diagnostic reason and (where applicable) a copy-to-clipboard `codex resume <id>` / `claude --resume <id>` command line for manual recovery.

## Capabilities

### New Capabilities
<!-- None: all changes extend the existing surviving-agent-session-resume capability and shared metadata-location conventions -->

### Modified Capabilities
- `surviving-agent-session-resume`: requirements change to (a) read metadata from canonical `<projectRoot>/.voicetree/terminals/`, (b) surface worktree+title+CLI-type on every row, (c) include exited/killed rows within a recency horizon, (d) support per-row permanent deletion of on-disk artifacts, (e) surface structured resolver-miss reasons + manual-resume copy command.

## Impact

- **Runtime (`@vt/agent-runtime`):**
  - `application/terminals/terminal-registry/reconciliation.ts` — `projectRoot` arg becomes the single source of truth; drop callers passing `writeFolder`.
  - `application/recovery/discovery.ts` — `resolveCurrentVaultMetadataDir` reads `projectRoot/.voicetree/terminals`; classifier extended to include exited/killed rows within horizon and to carry `closedAt` / `killReason` into row payload.
  - `application/recovery/resolvers/{resolveCodexNativeSession,resolveClaudeNativeSession,resolveNativeSession}.ts` — `not-found` widens to carry a `reason` discriminant; codex resolver returns `db-missing` / `db-schema-mismatch` / `outside-recency-window` / `marker-mismatch` / `no-rows`; claude resolver returns analogous reasons.
  - `application/recovery/resumePersistedAgentSession.ts` — propagate resolver `reason` through `{kind: 'no-native-session', reason}`.
  - `application/headless/tmuxHeadlessRuntime.ts` and any other writer of `.voicetree/terminals/*.json` — write to `projectRoot`-based path.
- **Webapp main process:**
  - `webapp/src/shell/edge/main/runtime/electron/app/main.ts:262-267` — remove `process.env.VOICETREE_VAULT_PATH` arg; reconciliation pulls path from graph bridge.
  - `webapp/src/shell/edge/main/runtime/electron/daemon/lifecycle/graph-model-init.ts:75` — pass `info.projectRoot` instead of `info.writeFolder` (or call reconciliation without arg).
  - One-time migration helper invoked from startup before reconciliation: scan candidate `writeFolder/.voicetree/terminals/`, move JSONs (and sibling artifacts) into canonical location.
- **Headless callers:**
  - `webapp/src/shell/edge/main/cli/commands/runtime/serve.ts:180` and `packages/systems/voicetree-mcp/bin/vt-mcpd.ts:160` — stop passing `args.vault` as the terminal dir source; either pass projectRoot or rely on graph-bridge.
- **Renderer:**
  - `SurvivingAgentsSection` (and `UnclaimedTmuxStore` recovery rows) — render new fields (`worktreeName`, `title`, `agentTypeName`, `endedAt`, `killReason`).
  - Per-row trash control with confirm; success refreshes store.
  - Resume failure toast — render structured `reason` + copy-to-clipboard manual command.
- **MCP / IPC:**
  - Add `removePersistedAgentRecord(terminalId)` action surfaced from main runtime through the recovery store.
- **Tests:**
  - Update `recovery/discovery.test.ts` for new `resolveCurrentVaultMetadataDir` behavior.
  - Update `resolvers/tests/resolveCodexNativeSession.test.ts` and `.../resolveClaudeNativeSession.test.ts` to assert structured `reason` on misses.
  - Add `reconciliation.test.ts` migration coverage (legacy → canonical).
  - Add UI tests for trash-delete confirm flow and horizon-bounded recent-list rendering.
- **Docs:** Update `docs/RECOVERY.md` (if present) and add a note to project setup that `.voicetree/` always lives at `projectRoot`, never inside subdir vaults.

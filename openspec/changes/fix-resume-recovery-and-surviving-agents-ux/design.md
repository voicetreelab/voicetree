## Context

The just-shipped `resume-surviving-agent-sessions` change introduced the Surviving Agents UI section and a CLI-native resume flow for orphaned Claude/Codex agents. In real recovery situations (Electron crash → reopen vault) the feature fails silently for users whose `projectRoot ≠ writeFolder` (this happens whenever a vault is loaded as a subdirectory of a folder that already contains a `.voicetree/` config dir).

Concrete reproducible failure observed 2026-05-27:
- 50 agent JSONs in `<innerVault>/.voicetree/terminals/` (where `reconciliation.ts` wrote them via `info.writeFolder`)
- `discovery.ts:resolveCurrentVaultMetadataDir` reads from `<outerProjectRoot>/.voicetree/terminals/` (from `graph.getProjectRoot()`)
- `readdirSync` throws ENOENT, caught silently, discovery returns `[]`, UI is empty
- Workaround: symlink outer dir → inner dir (already applied to the affected vault as a temporary patch)

In addition to fixing the path bug, three adjacent gaps make the recovery UX poor even when discovery does find rows. Bundling them keeps the surface change-set small and lets a single migration handle the metadata-location consolidation.

## Goals / Non-Goals

**Goals:**
- Make Resume work after a crash, in 100% of vault layouts, with zero user setup.
- One canonical location for all `.voicetree/` per-project data: `<projectRoot>/.voicetree/`.
- Visual parity between Surviving Agents rows and live terminal tiles (worktree, title, agent type).
- Per-row permanent deletion for users to prune accumulated history.
- When resume cannot proceed, tell the user WHY (structured reason) and give them an escape hatch (copy-to-clipboard manual `codex resume <id>` / `claude --resume <id>`).
- Keep the `codex resume <id>` form that users have verified works manually as the literal command emitted by the UI.

**Non-Goals:**
- Auto-resume on crash. User must click Resume / Attach explicitly.
- Cross-vault recovery (foreign-vault rows still filtered).
- Gemini or other CLIs (still `unsupported`).
- Reaching back to retrieve sessions that codex / claude itself never persisted — that's a provider limitation we surface, not one we work around.
- Resurrecting metadata older than the recency horizon (default 7 days) on the live discovery polls — only the Delete-time diagnostic resolver lookup widens the window.

## Decisions

### 1. Single source of truth: `getProjectRoot()` for all `.voicetree/` paths

**Decision:** `projectRoot` (from the graph bridge) becomes the only path used to derive `.voicetree/` data locations. `writeFolder` is for markdown / vault content only. `process.env.VOICETREE_VAULT_PATH` is no longer consulted at runtime for terminal-dir resolution.

**Alternatives considered:**
- *Make `writeFolder` canonical* — would require migrating every existing install's `.voicetree/` from project root to subdir vault, and breaks projects that intentionally co-locate `.voicetree/` at a parent level (`/projects/foo/.voicetree/` shared across multiple sub-vaults). Rejected.
- *Accept both paths in discovery (search both, prefer one)* — masks the inconsistency rather than fixing it; metadata still gets written to two locations going forward. Rejected.

**Migration:** one-time on-vault-open scan moves legacy `<writeFolder>/.voicetree/terminals/*.json` (+ siblings) to `<projectRoot>/.voicetree/terminals/`. Idempotent; conflicts log a warning and keep the canonical copy.

### 2. Reconciliation pulls projectRoot from the graph bridge, not from its caller

**Decision:** `reconcileTmuxTerminalRegistry()` reads `projectRoot` via injected `getProjectRoot` (default: graph bridge), rather than accepting it as a positional arg. Existing callers (`main.ts:262-267`, `graph-model-init.ts:75`, `serve.ts:180`, `vt-mcpd.ts:160`) drop the arg.

**Why:** Today the same function takes "projectRoot" as a parameter but receives `writeFolder` / `process.env.VOICETREE_VAULT_PATH` from different sites. Making it pull from a single source removes the divergence at the type level.

**Trade-off:** Adds an implicit dependency on graph-bridge availability at reconciliation time. Mitigated by gating reconcile on `onVaultOpened` (already the case) and exposing an optional `projectRoot` override for tests / headless callers.

### 3. Recency horizon for exited rows, not unbounded history

**Decision:** Surviving Agents shows rows with `endedAt` (or `startedAt` if missing) within the last 7 days by default. Configurable via `VOICETREE_RECOVERY_HORIZON_DAYS`.

**Alternatives considered:**
- *Unbounded* — list would balloon to hundreds of rows on heavy-use vaults (this vault already has 50). Rejected for UX + render cost.
- *Per-status horizon (longer for `killed`, shorter for `exited`)* — over-engineered for v1. Single horizon now, can split later.

### 4. Structured resolver-miss reasons

**Decision:** Widen `NativeSessionResult.not-found` to `{ kind: 'not-found', reason: <discriminant> }`. Plumb through `resumePersistedAgentSession` and render in the UI toast.

**Codex reasons:** `db-missing` | `db-schema-mismatch` | `outside-recency-window` | `marker-mismatch` | `no-rows`
**Claude reasons:** `projects-dir-missing` | `no-jsonl-matches` | `marker-mismatch` | `scan-timeout`

Implementation: `resolveCodexNativeSession` early-returns the reason when `openCodexDb` fails (db-missing), when the prepared statement throws on `threads` (db-schema-mismatch), when `listRecentThreads` returns 0 rows (no-rows / outside-recency-window — distinguish by re-running the query without the time predicate; expensive but only on miss), and finally when rows are returned but no marker conjunction matches (marker-mismatch).

**Why a second query for outside-recency-window:** lets the UI tell the user "your session is older than 24h but does exist — here's the manual command to resume it." Without the second query, we'd lump all empty results into a generic "not found."

### 5. Copy-to-clipboard manual command on miss

**Decision:** When the diagnostic lookup finds a matching thread/transcript outside the recency window, the UI exposes a "Copy resume command" button populating the system clipboard with `codex resume <id>` or `claude --resume <id>` (no flags, no env prefix). Users have verified the bare form works.

**Trade-off:** Doesn't carry over hook flags or env vars. Acceptable for a manual escape hatch — when users are debugging recovery they want the simplest command that runs.

### 6. Per-row delete with confirm

**Decision:** Per-row trash button on Surviving Agents rows. Click → confirm → runtime call `removePersistedAgentRecord(terminalId)` that unlinks the JSON and its siblings (`<id>.log`, `<id>-prompt.txt`, `<id>.exitcode`) from the canonical path. Live registry entries refuse the operation (delete is for orphaned/closed records only).

**Why confirm:** delete is irreversible and removes the only knowledge of past agent work (prompt text, log output). Make the user explicitly opt in.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Migration moves files mid-write, racing with a concurrent spawn | Run migration synchronously in `onVaultOpened`, before reconciliation triggers any new spawns. Migrating only `status: exited`/`killed` records first (writes to running records are rarer mid-vault-switch); fall back to skip-on-EBUSY for the still-live ones. |
| Users open the legacy path manually (e.g. via VS Code) and lose their tmux pane | The legacy dir is left present-but-empty after migration. Add a `MIGRATED.txt` stub pointing to the canonical location. |
| Recency horizon hides recovery a user needs | Configurable via env var; UI shows a "show older" link that re-queries without the horizon. |
| Codex resolver's "second query without time filter" doubles DB load on miss | Only runs on the miss path (not the live discovery poll). One extra SELECT per failed resume click. Negligible. |
| Structured reasons leak filesystem layout into the UI | Acceptable for a power-user tool. Surfaces useful debugging detail; users running into this are usually devs. |
| `removePersistedAgentRecord` deletes the wrong files if `<id>` contains path separators | Validate `terminalId` matches `[A-Za-z0-9_-]+` before any unlink. Refuse otherwise. |

## Migration Plan

No feature flag, no rollback CLI. Per project policy (CLAUDE.md): nothing is in production, and keeping legacy code paths around is explicitly not desired. The change lands directly:

1. `<projectRoot>/.voicetree/terminals/` becomes the only path readers and writers use.
2. A one-time migration runs synchronously on `onVaultOpened`, before reconciliation, to move any legacy `<writeFolder>/.voicetree/terminals/*.json` into the canonical location. Idempotent; conflicts log a warning and keep the canonical copy.
3. The legacy-path read branch is deleted in the same change.

**Rollback:** Since `fs.rename` is a metadata move, manual rollback is `mv <projectRoot>/.voicetree/terminals/* <writeFolder>/.voicetree/terminals/` — trivial and one-shot. No CLI needed.

## Open Questions

- Should `removePersistedAgentRecord` also remove the matching codex `threads` row / claude JSONL? (Probably **no** — those are CLI-owned stores; we don't own them.)
- Should we surface a "Resume All" button when there are many recovery rows? (Defer to a follow-up.)
- Is the right default horizon 7 days or 30? (Start with 7; widen if users complain.)
- Does the migration need to handle the `<projectRoot>/.voicetree/hooks/` and `<projectRoot>/.voicetree/positions.json` files, or are those already always at projectRoot? (Audit during implementation.)

---
color: green
isContextNode: false
agent_name: Fei
---
# Proposal: vt-graphd Single-owner Daemon Architecture

Proposed replacing Electron's vaultless graph daemon spawn path with a vault-scoped single-owner protocol shared by Electron, CLI, and tests. The proposal covers current spawn paths, storm risks, ownership/heartbeat/backoff design, interaction model, observability, migration, and tests.

## Current paths and storm risk

- CLI `vt serve` and `GraphDbClient.ensureDaemon(vault)` use the vault-bound path: `startDaemon({ vault })` acquires `<vault>/.voicetree/graphd.lock`, writes `graphd.port`, and either starts one daemon or reports an existing lock holder.
- Electron `openVault()` currently calls `ensureDaemonProcess()` first, which uses `spawnVaultlessDaemon({ appSupportPath })`. That child starts `startDaemon()` without `vault`, so no per-vault lock is acquired before the process exists.
- The vaultless daemon later receives `client.openVault(vaultPath)`, at which point it can write the vault port file, but there is no OS-level owner claim preventing another vaultless child from opening the same vault or lingering unbound.
- The in-process Electron guard (`activeDaemon` / `inflightDaemon`) helps only inside one loaded module instance. The observed 100-child synchronized fork storm is exactly the class of failure that module-local state cannot make impossible.
- SSE and watch-sync reconnect loops reuse stale `baseUrl`/client state and log failures, but daemon recovery still depends on the same Electron-side process cache being coherent.

## Single-owner design

- Define one public launcher: `ensureGraphDaemonForVault(vault, caller) -> { client, owner }`. Electron, CLI, MCP/headless, and tests use this; `spawnVaultlessDaemon` is removed from production graph ownership.
- The owner is vault-scoped and durable: `<vault>/.voicetree/graphd.owner.json` or an upgraded lock/port pair containing `schemaVersion`, canonical vault path, pid, port, owner nonce, startedAt, heartbeatAt, caller kind, contract version, and process command fingerprint.
- Startup order is claim-first: canonicalize vault, create `.voicetree`, check healthy owner, acquire owner atomically, spawn/start daemon, bind loopback, write owner+port, then serve graph RPCs. A daemon must not expose graph RPC for a vault it has not claimed.
- Add a process-local single-flight only as an optimization. Correctness comes from the owner record, health probe, nonce match, and lock/lease semantics across processes.
- Heartbeat is owner-owned. If pid is alive and `/health` returns matching vault+nonce, reuse. If lock exists but no healthy port appears, wait with bounded backoff, then fail loudly or reclaim only after stale heartbeat and command-line safety checks.
- Recovery is rate-limited per vault. After launch failure, write a launch-failure breadcrumb and suppress repeated spawns for a short cooldown instead of letting every caller fork.
- Preferred semantics: one graph daemon owner per vault per machine. Multiple Electron windows and CLI clients share it via separate daemon sessions. Switching vaults means connecting to that vault's owner, not mutating an unclaimed vaultless singleton.

## Electron, CLI, and tests

- Electron `openVault(path)` should call `ensureGraphDaemonForVault(path, 'electron')`, create or reuse a renderer session, subscribe to SSE for that client's base URL, and keep graph operations as client calls. `vault:lost` should stop reconnect loops and require one owner-mediated recovery attempt, not spawn from every poller.
- CLI `vt serve --vault` should use the same ensure path. By default it can reuse an existing graph daemon and start only MCP/headless surfaces; an explicit exclusive/debug mode may fail if another owner exists.
- Tests should use a harness around the same owner protocol with temp vaults. Unit tests cover pure owner-record decisions; integration tests assert observable results: one port, one healthy owner, clients share state, stale owners are reclaimed, duplicate launch attempts are suppressed.

## Observability

- Emit structured lifecycle events: `owner.claim_attempt`, `owner.reused`, `owner.acquired`, `owner.waiting_for_lock_holder`, `owner.stale_reclaimed`, `spawn.started`, `spawn.ready`, `spawn.failed`, `spawn.suppressed_by_cooldown`, `duplicate_process_detected`.
- Include vault, caller, attempt id, pid, ppid, port, owner nonce, lock path, heartbeat age, contract version, and failure reason.
- `/health` should return pid, ppid, vault, owner nonce, uptime, contract version, and session count. Diagnostics should surface duplicate owners as a red operator event, not just stderr noise.

## Migration and tests

1. Add owner-record types and pure decision functions in `@vt/graph-db-client`/server lifecycle code; test them black-box with filesystem temp dirs.
2. Upgrade `graph-db-server` lock/port lifecycle so `startDaemon` claims ownership before graph init and releases on shutdown.
3. Replace Electron `spawnVaultlessDaemon` use in `graph-daemon.ts`/`openVault.ts` with the shared vault-scoped ensure path.
4. Rework CLI `serve.ts` to reuse the owner path instead of owning a separate graph daemon path.
5. Remove or quarantine production vaultless spawning; keep only explicit test helpers if still needed.
6. Add regression tests: 100 concurrent Electron-style opens produce one owner/port; stale dead lock is reclaimed; live lock with missing port waits then fails without spawning N children; daemon death allows one bounded recovery attempt; SSE/watch-sync failure does not spawn.

Likely touched code: `packages/systems/graph-db-server/src/daemon/{startDaemon,lock,portFile,lifecycle/*}`, `packages/systems/graph-db-client/src/{autoLaunch.ts,autoLaunch/*,portDiscovery.ts,orphanCleanup.ts}`, `webapp/src/shell/edge/main/runtime/electron/daemon/{graph-daemon.ts,daemon-watch-sync.ts,daemon-sse-subscription.ts}`, `webapp/src/shell/edge/main/graph/watch_folder/openVault.ts`, and `webapp/src/shell/edge/main/cli/commands/runtime/serve.ts`.

Do not fix this with only another module-level boolean. That may reduce one symptom in one process, but it does not establish cross-process ownership and would leave the architecture capable of another storm.

### NOTES

- This is proposal-only work; no production code was implemented.
- The main architectural shift is from Electron-owned vaultless children to a vault-scoped owner protocol shared by all launchers.
- No fragile workaround, reward hack, or verification hack was introduced.

[[task_u0fngg]]

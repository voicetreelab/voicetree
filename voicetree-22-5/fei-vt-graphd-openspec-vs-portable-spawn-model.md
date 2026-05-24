---
color: green
isContextNode: false
agent_name: Fei
---
# OpenSpec Vs Portable Spawn Model

Compared the current `vt-graphd-single-owner-daemon` OpenSpec against the discussed portable ensure-on-use spawn model. Conclusion: it matches the ownership intent, but underspecifies the exact cross-platform spawn primitive and claim handoff.

## Question

Does the current OpenSpec match the portable spawn/ownership model just discussed?

## Short Answer

Mostly yes at the invariant level, but not fully at the implementation-contract level.

## Current OpenSpec Covers

- Production launch becomes vault-scoped and claim-first.
- Electron stops using production `spawnVaultlessDaemon`.
- Electron, CLI, MCP/headless, graph-db-client share `ensureGraphDaemonForVault(vault, caller)`.
- Owner metadata lives under `<vault>/.voicetree/` and is verified by `/health` with an owner nonce.
- Concurrent launch attempts coalesce through filesystem owner state, not process-local booleans.
- Lock/owner-without-port waits instead of spawning many children.
- Recovery is bounded and observable.

## Model Discussed

```text
every caller
  -> ensureGraphDaemonForVault(vault, callerKind)
  -> atomic vault owner claim/read under <vault>/.voicetree/
  -> healthy owner exists? reuse it
  -> owner starting? wait/bounded failure
  -> no owner? caller that wins claim spawns vt-graphd --vault <vault>
  -> verify /health owner identity before returning client
```

## Gap

The OpenSpec implies this model, but it does not explicitly say the portable baseline is Node `child_process.spawn` of the existing `vt-graphd --vault <path>` entrypoint via runtime resolution, with no launchd/systemd/tmux supervisor in the core correctness path.

It also has a subtle claim-handoff ambiguity:

```text
Option A: launcher claims pending owner, then child verifies/finalizes it
Option B: child process claims owner after spawn, while launcher waits
```

The discussion leaned toward Option A for storm prevention: claim/read before spawning, then the daemon health proves the same nonce before clients use it.

## Recommendation Before Implementation

Capture two explicit design statements before coding:

1. The cross-platform spawn baseline is ensure-on-use using Node `child_process.spawn` and the existing `vt-graphd --vault` entrypoint.
2. The outer ensure path owns claim arbitration; the daemon must verify/finalize that owner identity before serving.

### NOTES

- No OpenSpec or code files were modified for this comparison.
- The existing OpenSpec is directionally correct but should be tightened before implementation to prevent an implementation from introducing an OS-specific supervisor or a spawn-then-claim race.

[[task_u0fngg]]

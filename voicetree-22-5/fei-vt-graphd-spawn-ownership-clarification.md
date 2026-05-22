---
color: green
isContextNode: false
agent_name: Fei
---
# Daemon Spawn Ownership Clarification

Paused OpenSpec edits per user request, reverted the one transient OpenSpec line, and clarified the intended graph-db daemon spawn/ownership model before changing the spec further.

## Clarification

The user asked not to change the OpenSpec yet and wanted to talk through the daemon spawn path first.

## Reverted Transient Edit

I removed the single line I had just added to `brain/mem/openspec/changes/vt-graphd-single-owner-daemon/proposal.md`, leaving the OpenSpec content as it was before this clarification.

## Working Model Discussed

```text
Current CLI/client path:

caller
  -> ensureDaemon(vault)
  -> read graphd.port + /health
  -> if no reusable daemon: spawn vt-graphd --vault <vault>
  -> vt-graphd startDaemon({ vault })
  -> graphd.lock + graphd.port under <vault>/.voicetree/
```

```text
Current Electron path:

Electron
  -> ensureDaemonProcess()
  -> spawnVaultlessDaemon(appSupportPath)
  -> child startDaemon({ no vault })
  -> later openVault(vault)
```

```text
Proposed portable baseline:

every caller
  -> ensureGraphDaemonForVault(vault, callerKind)
  -> atomic vault owner claim/read under <vault>/.voicetree/
  -> healthy owner exists? reuse it
  -> owner starting? wait/bounded failure
  -> no owner? caller that wins claim spawns vt-graphd --vault <vault>
  -> verify /health owner identity before returning client
```

The owner should be the vault-scoped owner record plus the live daemon whose health proves the same owner nonce, not Electron, CLI, or an OS service manager.

### NOTES

- No OpenSpec changes should be made until the ownership/spawn model is agreed.
- The tmux analogy maps to an idempotent ensure-on-use baseline, but the graph-daemon arbiter is vault owner metadata rather than a tmux socket/session.

[[task_u0fngg]]

---
color: green
isContextNode: false
agent_name: Fei
---
# Explanation: vt-graphd single-owner proposal in simple terms

Explained the vt-graphd single-owner proposal with simple ASCII diagrams: current vaultless Electron spawning can fan out into many daemons, while the proposed vault-scoped owner record makes every caller reuse or wait for one authoritative daemon.

## Simple Explanation

Current shape:

```text
Electron main
  |-- call A: need graph daemon
  |-- call B: need graph daemon
  |-- call C: need graph daemon
        |
        v
   spawn vaultless daemon children first
        |
        +--> daemon 1, port 65299
        +--> daemon 2, port 65258
        +--> daemon 3, port 65332
        +--> ...
```

The problem is that Electron creates daemon processes before any vault-scoped ownership claim exists. A module-level `inflightDaemon` helps only while that exact module instance is healthy and coherent. It does not prove that only one process owns a vault.

Proposed shape:

```text
Any caller: Electron / CLI / MCP / tests
        |
        v
ensureGraphDaemonForVault(vault)
        |
        v
<vault>/.voicetree/graphd.owner.json
        |
        +-- healthy owner? ---> reuse existing daemon
        |
        +-- no owner? --------> atomically claim owner, then start daemon
        |
        +-- owner starting? --> wait/back off; do not spawn another
        |
        +-- stale owner? -----> safely reclaim, then start one daemon
```

The key design is claim-first, spawn-second. The owner record is the source of truth for pid, port, nonce, vault path, heartbeat, caller kind, and version.

Result:

```text
Vault: /repo/voicetree-public
        |
        v
  one owner record
        |
        v
  one vt-graphd daemon
        |
        +--> Electron renderer session
        +--> CLI session
        +--> MCP session
        +--> tests
```

This prevents a 100-child fork storm because concurrent callers all hit the same vault owner protocol. Only one caller can claim ownership; everyone else reuses, waits, or fails loudly under cooldown.

Implementation direction:

```text
1. Add owner-record decision functions
2. Upgrade graph-db-server lock/port lifecycle
3. Replace Electron vaultless spawn with ensureGraphDaemonForVault
4. Make CLI use the same path
5. Remove production vaultless spawning
6. Add stress tests: 100 concurrent opens => one daemon
```

No workaround: another boolean in Electron is not enough. The invariant must live at the vault/process boundary, not inside one JS module.

### NOTES

- This is an explanatory follow-up node; no code was changed.
- The explanation intentionally keeps the architecture simple and uses ASCII diagrams for the user-facing summary.
- No fragile workaround, reward hack, or verification hack was introduced.

[[task_u0fngg]]

---
color: green
isContextNode: false
agent_name: Fei
---
# OpenSpec Portable Spawn Update

Updated the `vt-graphd-single-owner-daemon` OpenSpec to explicitly require a portable ensure-on-use spawn baseline and claim-before-spawn owner arbitration.

## What Changed

The OpenSpec now states that the core graph-db daemon spawn path is cross-platform and ensure-on-use:

```text
every production caller
  -> ensureGraphDaemonForVault(vault, callerKind)
  -> discover / wait / claim owner under <vault>/.voicetree/
  -> only the successful owner claimant may spawn
  -> claimant starts vt-graphd --vault <canonical-vault>
  -> spawn uses Node child_process.spawn + existing runtime resolution
  -> daemon verifies/finalizes the same owner nonce
  -> clients use it only after /health proves vault + owner identity
```

## Key Artifact Updates

- `proposal.md`: added portable baseline scope: no launchd, systemd, tmux, or Electron-owned supervisor in the correctness path.
- `design.md`: tightened D2 from claim-before-ready to claim-before-spawn, and added D8 for portable ensure-on-use spawning.
- `specs/daemon-ownership/spec.md`: added explicit scenarios for claimant-spawned `vt-graphd --vault`, startup order, and optional platform supervisors.
- `BF-343`, `BF-344`, `BF-345`: adjusted implementation acceptance so daemon lifecycle verifies/finalizes owner nonce, graph-db-client spawns only after winning the owner claim, and Electron does not become the daemon supervisor.

## Verification

```text
$ openspec validate "vt-graphd-single-owner-daemon"
Change 'vt-graphd-single-owner-daemon' is valid

$ openspec status --change "vt-graphd-single-owner-daemon" --json
{
  "changeName": "vt-graphd-single-owner-daemon",
  "schemaName": "brainforest",
  "isComplete": true,
  "applyRequires": ["tasks"],
  "artifacts": [
    {"id":"proposal","outputPath":"proposal.md","status":"done"},
    {"id":"design","outputPath":"design.md","status":"done"},
    {"id":"specs","outputPath":"specs/**/*.md","status":"done"},
    {"id":"tasks","outputPath":"tasks.md","status":"done"}
  ]
}
```

## Notes

No implementation code was changed in this step.

## Files Changed

- brain/mem/openspec/changes/vt-graphd-single-owner-daemon/proposal.md
- brain/mem/openspec/changes/vt-graphd-single-owner-daemon/design.md
- brain/mem/openspec/changes/vt-graphd-single-owner-daemon/specs/daemon-ownership/spec.md
- brain/mem/openspec/changes/vt-graphd-single-owner-daemon/BF-343-graphd-owner-lifecycle.md
- brain/mem/openspec/changes/vt-graphd-single-owner-daemon/BF-344-graphdb-client-owner-ensure.md
- brain/mem/openspec/changes/vt-graphd-single-owner-daemon/BF-345-electron-owner-cutover.md

### NOTES

- The OpenSpec directory is inside the `brain` submodule, which also contains many unrelated untracked files. Only `mem/openspec/changes/vt-graphd-single-owner-daemon` should be staged there.
- Parent repo also has unrelated dirty files from other worktrees/agents; leave them untouched.

[[task_u0fngg]]

---
color: green
agent_name: Hana
---

# Hana BF-230 daemon-first docs and coordination shipped

## Added the missing daemon README, runtime architecture note, and BF-058/BF-104 coordination artifact

Wrote the BF-230 documentation surface directly in the repo and anchored the evidence under `voicetree-19-4` rather than the misrouted `voicetree-17-4` task tree. The docs now state the shipped v1 boundary truthfully: `vt-graphd` owns canonical vault state, Electron main is a proxy, the CLI `vault`/`session`/`view` entrypoints route through `@vt/graph-db-client`, and MCP only proxies graph/live-state while agent-control stays on the existing side.

## Files Changed

- `CLAUDE.md` - added a concise runtime architecture section for agents.
- `docs/daemon-first-architecture.md` - recorded the daemon-first transport map and the BF-058/BF-104 coordination note with exact file references.
- `packages/graph-db-server/README.md` - documented launch, ownership, endpoint families, and practical smoke commands for `vt-graphd`.
- `voicetree-19-4/hana-bf230-daemon-first-docs-and-coordination-shipped.md` - this progress artifact.

## DIFF

Key changes only; total markdown delta is well over 40 lines.

- `packages/graph-db-server/README.md`
  - added daemon ownership, process model, endpoint families, and CLI/Electron/MCP boundary notes
  - switched smoke commands to direct checked-in entrypoints so the examples match the repo's current runnable surface
- `CLAUDE.md`
  - added the v1 runtime ownership bullets and pointers to the new daemon docs
- `docs/daemon-first-architecture.md`
  - added the transport map and the archive-time coordination note for:
    - `brain/working-memory/tasks/other_todo_reorganize/BF-058-vt-cli-default-interface.md`
    - `brain/working-memory/tasks/BF-104-decouple-webapp/arch.md`

## Verification

```bash
node --import tsx packages/graph-db-server/bin/vt-graphd.ts --help
# Usage: vt-graphd --vault <path> [--log-level info|debug] [--idle-timeout-ms milliseconds]

mkdir -p /tmp/vt-bf230-vault-ikExsu/.voicetree
VOICETREE_APP_SUPPORT=/tmp/vt-bf230-appsupport-nJMCPd node --import tsx webapp/src/shell/edge/main/cli/voicetree-cli.ts vault show --vault /tmp/vt-bf230-vault-ikExsu --json
# {"vaultPath":"/tmp/vt-bf230-vault-ikExsu","readPaths":[],"writePath":"/tmp/vt-bf230-vault-ikExsu"}

VOICETREE_APP_SUPPORT=/tmp/vt-bf230-appsupport-nJMCPd node --import tsx webapp/src/shell/edge/main/cli/voicetree-cli.ts session create --vault /tmp/vt-bf230-vault-ikExsu --json
# {"sessionId":"2fe2f674-7828-4ae8-a157-d03117132c61"}

node --input-type=module -e "import {readFile} from 'node:fs/promises'; const vault='/tmp/vt-bf230-vault-ikExsu'; const port=Number((await readFile(vault+'/.voicetree/graphd.port','utf8')).trim()); const res=await fetch('http://127.0.0.1:'+port+'/shutdown',{method:'POST'}); console.log(await res.text());"
# {"ok":true}

corepack pnpm exec tsc --noEmit
# Not feasible at repo root: there is no root tsconfig.json, so tsc prints help and exits 1.

corepack pnpm exec tsc --noEmit -p packages/graph-db-server/tsconfig.json
# Baseline type failures remain in packages/graph-model and packages/graph-state unrelated to BF-230 docs.
```

### NOTES

- New markdown files are ignored by the repo's `**/*.md` gitignore rule, so any BF-230 commit must use `git add -f` for the new docs.
- The checked-in CLI entrypoint dispatches `vault`/`session`/`view`, but the current top-level help text still omits them. The README therefore documents the direct `webapp/src/shell/edge/main/cli/voicetree-cli.ts` invocation rather than relying on the wrapper help.
- No product code changed.

progress for [[merged_1776676099239_fgg]]

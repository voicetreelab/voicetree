# BF-129 QA Red-Team Report

BF-120 is not clean. The main issues are a real partial-write failure path, incorrect mode routing in non-TTY execution, and a verification/output gap where filesystem `graph create` discards the fix/rejection detail that the pure layer already computes.

## Findings

### 1. High: filesystem mode can leave partial writes behind on mid-batch failure

- Code path: `webapp/src/shell/edge/main/cli/commands/graph.ts:449` writes each file in order with `writeFileSync()` and no rollback or temp-file swap.
- Contract conflict: `~/brain/working-memory/openspec/changes/filesystem-native-graph-authoring/design.md` says filesystem mode should be "atomically enough to avoid partial-graph surprises".
- Reproduction:

```text
$ tmpdir=$(mktemp -d)
$ cd "$tmpdir"
$ cat > ok.md <<'EOF'
# Ok

Body
EOF
$ cat > locked.md <<'EOF'
# Locked

Body
EOF
$ chmod 444 locked.md
$ env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" AGENT_NAME=Eve \
    npx tsx webapp/src/shell/edge/main/cli/voicetree-cli.ts --json graph create ok.md locked.md
=> error: EACCES: permission denied, open 'locked.md'
```

- Observed result: `ok.md` was rewritten with frontmatter, `locked.md` stayed unchanged. The batch failed after mutating only a subset of the requested nodes.

### 2. Medium: non-interactive filesystem `graph create` is misrouted into the live stdin path

- Code path: `webapp/src/shell/edge/main/cli/commands/graph.ts:483` checks `!process.stdin.isTTY` before argument parsing and immediately forces the stdin JSON/MCP route.
- Impact: `vt graph create file.md` fails in piped or headless invocations even when the user supplied filesystem inputs and does not want MCP/Electron.
- Reproduction:

```text
$ tmpdir=$(mktemp -d)
$ cd "$tmpdir"
$ cat > test-node.md <<'EOF'
# Test Node

Child summary
EOF
$ printf '' | env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" AGENT_NAME=Eve \
    npx tsx webapp/src/shell/edge/main/cli/voicetree-cli.ts --json graph create test-node.md
=> error: Stdin was empty. Provide create_graph JSON payload.
```

- Verification gap: `webapp/src/shell/edge/main/cli/commands/graph.test.ts:76` covers TTY filesystem inputs and `graph.test.ts:92` covers non-TTY stdin JSON, but nothing covers non-TTY filesystem args.

### 3. Medium: filesystem `graph create` drops actionable fix/rejection detail from user output

- Pure layer evidence: `packages/graph-tools/src/filesystemAuthoring.ts:64` returns per-file `reports`, and `packages/graph-tools/tests/filesystemAuthoring.test.ts:289` proves rejection suggestions exist.
- CLI drop points:
  - `webapp/src/shell/edge/main/cli/commands/graph.ts:41` defines a filesystem success payload with only `{path,status}`.
  - `webapp/src/shell/edge/main/cli/commands/graph.ts:519` outputs only created paths and never surfaces `planResult.reports`.
  - `webapp/src/shell/edge/main/cli/commands/graph.ts:387` formats validation errors but discards `suggestions`.
- Reproductions:

```text
$ env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" AGENT_NAME=Eve \
    npx tsx webapp/src/shell/edge/main/cli/voicetree-cli.ts --json graph create rough-capture.md
=> {"success":true,"mode":"filesystem","nodes":[{"path":".../rough-capture.md","status":"ok"}]}
```

`rough-capture.md` was auto-fixed in place with new frontmatter, but the JSON response exposed no `fixes` data.

```text
$ env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" AGENT_NAME=Eve \
    npx tsx webapp/src/shell/edge/main/cli/voicetree-cli.ts graph create oversized-brief.md
=> error: .../oversized-brief.md: 81 lines exceeds 70-line limit. (file: .../oversized-brief.md)
```

The pure layer generated split suggestions, but the CLI output omitted them.

## Verification Run

```text
$ cd packages/graph-tools && npx vitest run tests/filesystemAuthoring.test.ts tests/graphLint.test.ts
=> 35 passed

$ cd webapp && npx vitest run src/shell/edge/main/cli/commands/graph.test.ts
=> 3 passed
```

These suites stay green despite the three issues above, so the current BF-120 verification story is incomplete.

## Residual Risk

I did not find a concrete inconsistent-parent bug in the current ASCII/Mermaid parsers beyond the output/validation issues above. The remaining highest risk is still CLI integration behavior, not the pure manifest parser itself.

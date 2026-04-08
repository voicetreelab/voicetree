# BF-132 Post-QA Verification Rerun

Tested commit: `bb801d75` (`fix: harden filesystem graph create CLI`)

Worktree under test:
`/Users/bobbobby/repos/voicetree-public/.worktrees/wt-excelllent-now-let-s-execute-t-x0s`

## Automated BF-120 Targeted Verification

```text
$ cd /Users/bobbobby/repos/voicetree-public/.worktrees/wt-excelllent-now-let-s-execute-t-x0s/packages/graph-tools && npx vitest run
=> Test Files 4 passed (4)
=> Tests 44 passed (44)
=> exit 0

$ cd /Users/bobbobby/repos/voicetree-public/.worktrees/wt-excelllent-now-let-s-execute-t-x0s/webapp && npx vitest run src/shell/edge/main/cli/commands/graph.test.ts src/shell/edge/main/cli/mcp-client.test.ts src/shell/edge/main/mcp-server/integration-tests/addProgressNodeMcp.test.ts src/shell/edge/main/mcp-server/integration-tests/buildMarkdownBody-formatting.test.ts src/shell/edge/main/mcp-server/createGraphValidation.test.ts src/shell/edge/main/mcp-server/createGraphValidationE2E.test.ts
=> Test Files 6 passed (6)
=> Tests 64 passed (64)
=> exit 0
```

## BF-129 Repro Reruns

### 1. Original partial-write repro (`chmod 444`)

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
    npx tsx /Users/bobbobby/repos/voicetree-public/.worktrees/wt-excelllent-now-let-s-execute-t-x0s/webapp/src/shell/edge/main/cli/voicetree-cli.ts --json graph create ok.md locked.md
=> {
=>   "success": true,
=>   "mode": "filesystem",
=>   "nodes": [
=>     {
=>       "path": "ok.md",
=>       "status": "ok",
=>       "fixes": [
=>         {
=>           "code": "added_frontmatter",
=>           "message": "Added frontmatter (color, agent_name, isContextNode)."
=>         }
=>       ]
=>     },
=>     {
=>       "path": "locked.md",
=>       "status": "ok",
=>       "fixes": [
=>         {
=>           "code": "added_frontmatter",
=>           "message": "Added frontmatter (color, agent_name, isContextNode)."
=>         }
=>       ]
=>     }
=>   ]
=> }
```

Observed result:
- exit `0`
- the old `EACCES` no longer reproduces
- both `ok.md` and `locked.md` gained frontmatter

Interpretation:
- the exact BF-129 failure command is closed
- this command is no longer a stable failure-path repro because BF-131 now stages content and renames over the target, which still works when the file itself is read-only but the directory is writable

### 1b. Equivalent rollback failure-path check

The exact `chmod 444` command now succeeds, so I added one focused CLI-level failure check that still forces a later-file write error.

```text
$ tmpdir=$(mktemp -d)
$ cd "$tmpdir"
$ mkdir okdir lockedir
$ cat > okdir/first-node.md <<'EOF'
# First Node

First summary
EOF
$ cat > lockedir/second-node.md <<'EOF'
# Second Node

Second summary
EOF
$ before_first=$(shasum okdir/first-node.md | cut -d ' ' -f1)
$ before_second=$(shasum lockedir/second-node.md | cut -d ' ' -f1)
$ chmod 555 lockedir
$ env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" AGENT_NAME=Eve \
    npx tsx /Users/bobbobby/repos/voicetree-public/.worktrees/wt-excelllent-now-let-s-execute-t-x0s/webapp/src/shell/edge/main/cli/voicetree-cli.ts --json graph create okdir/first-node.md lockedir/second-node.md
=> error: Failed to apply filesystem authoring plan: EACCES: permission denied, open 'lockedir/second-node.md.vt-graph-create-stage-...'
$ chmod 755 lockedir
$ after_first=$(shasum okdir/first-node.md | cut -d ' ' -f1)
$ after_second=$(shasum lockedir/second-node.md | cut -d ' ' -f1)
=> exit_code=1
=> before_first=3716d49a07d93083eae3e87e90303252c0fbd3cd
=> after_first=3716d49a07d93083eae3e87e90303252c0fbd3cd
=> before_second=9ae6b07db421131e3bacaeeb6370db99df483ca1
=> after_second=9ae6b07db421131e3bacaeeb6370db99df483ca1
```

Observed result:
- the second file fails during stage-file creation in the non-writable directory
- both hashes remain unchanged
- `okdir/first-node.md` and `lockedir/second-node.md` remain in their original no-frontmatter state

### 2. Exact non-TTY filesystem routing repro

```text
$ tmpdir=$(mktemp -d)
$ cd "$tmpdir"
$ cat > test-node.md <<'EOF'
# Test Node

Child summary
EOF
$ printf '' | env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" AGENT_NAME=Eve \
    npx tsx /Users/bobbobby/repos/voicetree-public/.worktrees/wt-excelllent-now-let-s-execute-t-x0s/webapp/src/shell/edge/main/cli/voicetree-cli.ts --json graph create test-node.md
=> {
=>   "success": true,
=>   "mode": "filesystem",
=>   "nodes": [
=>     {
=>       "path": "test-node.md",
=>       "status": "ok",
=>       "fixes": [
=>         {
=>           "code": "added_frontmatter",
=>           "message": "Added frontmatter (color, agent_name, isContextNode)."
=>         }
=>       ]
=>     }
=>   ]
=> }
```

Observed result:
- exit `0`
- no `Stdin was empty. Provide create_graph JSON payload.` error
- the command routes to filesystem mode and rewrites `test-node.md`

### 3. Exact fix-detail success repro

```text
$ tmpdir=$(mktemp -d)
$ cd "$tmpdir"
$ cat > rough-capture.md <<'EOF'
# Rough Capture

Captured summary
EOF
$ env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" AGENT_NAME=Eve \
    npx tsx /Users/bobbobby/repos/voicetree-public/.worktrees/wt-excelllent-now-let-s-execute-t-x0s/webapp/src/shell/edge/main/cli/voicetree-cli.ts --json graph create rough-capture.md
=> {
=>   "success": true,
=>   "mode": "filesystem",
=>   "nodes": [
=>     {
=>       "path": "rough-capture.md",
=>       "status": "ok",
=>       "fixes": [
=>         {
=>           "code": "added_frontmatter",
=>           "message": "Added frontmatter (color, agent_name, isContextNode)."
=>         }
=>       ]
=>     }
=>   ]
=> }
```

Observed result:
- success output now exposes `fixes`
- `rough-capture.md` gained frontmatter as before

### 4. Exact rejection-detail repro

```text
$ tmpdir=$(mktemp -d)
$ cd "$tmpdir"
$ cat > oversized-brief.md <<'EOF'
# Oversized Brief

Intro line 1
...
Intro line 36
## Evidence
Evidence line 1
...
Evidence line 22
## Implications
Implication line 1
...
Implication line 22
EOF
$ env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" AGENT_NAME=Eve \
    npx tsx /Users/bobbobby/repos/voicetree-public/.worktrees/wt-excelllent-now-let-s-execute-t-x0s/webapp/src/shell/edge/main/cli/voicetree-cli.ts graph create oversized-brief.md
=> {
=>   "success": false,
=>   "mode": "filesystem",
=>   "errors": [
=>     {
=>       "code": "node_too_long",
=>       "message": "oversized-brief.md: 84 lines exceeds 70-line limit.",
=>       "filename": "oversized-brief.md",
=>       "suggestions": [
=>         "Split at ## headings: \"Evidence\" (23 lines), \"Implications\" (23 lines)."
=>       ]
=>     }
=>   ],
=>   "reports": [
=>     {
=>       "filename": "oversized-brief.md",
=>       "fixes": [
=>         {
=>           "code": "added_frontmatter",
=>           "message": "Added frontmatter (color, agent_name, isContextNode)."
=>         }
=>       ],
=>       "rejections": [
=>         {
=>           "code": "node_too_long",
=>           "message": "oversized-brief.md: 84 lines exceeds 70-line limit.",
=>           "filename": "oversized-brief.md",
=>           "suggestions": [
=>             "Split at ## headings: \"Evidence\" (23 lines), \"Implications\" (23 lines)."
=>           ]
=>         }
=>       ]
=>     }
=>   ]
=> }
```

Observed result:
- rejection output now preserves split suggestions
- rejection output also carries `reports` with both `fixes` and `rejections`

## BF-129 Closure Status

| Finding | Status | Evidence |
| --- | --- | --- |
| High: partial-write mid-batch failure leaves earlier files mutated | Closed | The original `chmod 444` repro no longer fails, and the equivalent locked-directory failure-path check shows unchanged hashes for both files after a later-file `EACCES`. |
| Medium: non-TTY filesystem invocation misroutes into stdin JSON/MCP path | Closed | The exact `printf '' | ... graph create test-node.md` repro now returns filesystem success instead of `Stdin was empty`. |
| Medium: filesystem output drops fix/rejection detail | Closed | The exact `rough-capture.md` success repro now exposes `fixes`, and the `oversized-brief.md` rejection repro now exposes actionable `suggestions`. |

## Outcome

BF-132 rerun is green on the targeted BF-120 surface and on the BF-129 repro set. The one adjustment from the original QA note is that `chmod 444` is no longer a reliable way to force a write failure after BF-131; a non-writable parent directory is the stable manual rollback probe now.

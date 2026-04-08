# BF-128 Verification Report

Shared graph artifacts:
- `/Users/bobbobby/repos/voicetree-public/voicetree-8-4-1/bf-128-automated-verification-sweep.md`
- `/Users/bobbobby/repos/voicetree-public/voicetree-8-4-1/bf-128-manual-cli-smoke-and-attribution.md`

## Automated Checks

```text
$ cd /Users/bobbobby/repos/voicetree-public/.worktrees/wt-excelllent-now-let-s-execute-t-x0s/packages/graph-tools && npx vitest run
=> Test Files 4 passed (4); Tests 44 passed (44); exit 0

$ cd /Users/bobbobby/repos/voicetree-public/.worktrees/wt-excelllent-now-let-s-execute-t-x0s/webapp && npx vitest run src/shell/edge/main
=> Test Files 4 failed | 68 passed (72); Tests 9 failed | 697 passed | 6 skipped (712); exit 1
=> unrelated ambient failures:
   - createContextNode.test.ts / getUnseenNodesAroundContextNode.test.ts: fixture-path ENOENTs under example_small/*.md vs example_small/voicetree/*.md
   - fakeAgentE2E.test.ts / fakeAgentE2E.multi-agent.test.ts: `npm run build` failure in tools/vt-fake-agent

$ cd /Users/bobbobby/repos/voicetree-public/.worktrees/wt-excelllent-now-let-s-execute-t-x0s/webapp && npx vitest run src/shell/edge/main/cli/commands/graph.test.ts src/shell/edge/main/cli/mcp-client.test.ts src/shell/edge/main/mcp-server/integration-tests/addProgressNodeMcp.test.ts src/shell/edge/main/mcp-server/integration-tests/buildMarkdownBody-formatting.test.ts src/shell/edge/main/mcp-server/createGraphValidation.test.ts src/shell/edge/main/mcp-server/createGraphValidationE2E.test.ts
=> Test Files 6 passed (6); Tests 60 passed (60); exit 0
```

## Manual CLI Smoke

```text
$ env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" AGENT_NAME=Eva npx tsx /Users/bobbobby/repos/voicetree-public/.worktrees/wt-excelllent-now-let-s-execute-t-x0s/webapp/src/shell/edge/main/cli/voicetree-cli.ts --json graph create fresh-smoke.md
=> success; frontmatter added with color: blue, agent_name: Eva, isContextNode: false

$ env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" AGENT_NAME=Eva npx tsx /Users/bobbobby/repos/voicetree-public/.worktrees/wt-excelllent-now-let-s-execute-t-x0s/webapp/src/shell/edge/main/cli/voicetree-cli.ts --json graph create root-brief.md evidence-cluster.md rollout-checklist.md --manifest structure.ascii.tree.txt
=> success; all three files gained Eva frontmatter; children gained - parent [[root-brief]]

$ env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" AGENT_NAME=Eva npx tsx /Users/bobbobby/repos/voicetree-public/.worktrees/wt-excelllent-now-let-s-execute-t-x0s/webapp/src/shell/edge/main/cli/voicetree-cli.ts --json graph create root-brief.md evidence-cluster.md rollout-checklist.md --manifest structure.mermaid.mmd
=> success; all three files gained Eva frontmatter; children gained - parent [[root-brief]]

$ env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" AGENT_NAME=Eva npx tsx /Users/bobbobby/repos/voicetree-public/.worktrees/wt-excelllent-now-let-s-execute-t-x0s/webapp/src/shell/edge/main/cli/voicetree-cli.ts --json graph create missing-ref-root.md present-detail.md --manifest structure.ascii.tree.txt
=> error: Manifest references missing target: missing-target (ref: missing-target); shasums unchanged before/after

$ env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" AGENT_NAME=Eva npx tsx /Users/bobbobby/repos/voicetree-public/.worktrees/wt-excelllent-now-let-s-execute-t-x0s/webapp/src/shell/edge/main/cli/voicetree-cli.ts --json graph create duplicate-root.md shared-detail.md --manifest structure.ascii.tree.txt
=> error: ASCII manifest references the same target more than once: shared-detail (ref: shared-detail); shasums unchanged before/after

$ env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" AGENT_NAME=Eva npx tsx /Users/bobbobby/repos/voicetree-public/.worktrees/wt-excelllent-now-let-s-execute-t-x0s/webapp/src/shell/edge/main/cli/voicetree-cli.ts --json graph create root-brief.md evidence-cluster.md --manifest structure.mermaid.mmd
=> error: Malformed Mermaid manifest line: root -->; shasums unchanged before/after

$ AGENT_NAME=Eva npx tsx /Users/bobbobby/repos/voicetree-public/.worktrees/wt-excelllent-now-let-s-execute-t-x0s/packages/graph-tools/bin/vt-graph.ts lint /tmp/bf128-manual-1JS8iC/lint-fix --fix --json
=> authoring.mode=fix; scannedFiles=2; changedFiles=1; rejectedFiles=1
=> rough-capture.md: added_frontmatter applied
=> oversized-brief.md: node_too_long rejected with split suggestions for "Evidence" and "Implications"
```

## Live CLI And Probe C

```text
Isolated temp harness:
=> port 3101, terminal eva-live-smoke, agentName EvaSmoke

$ printf '%s' '{"callerTerminalId":"eva-live-smoke","nodes":[{"filename":"bf-128-live-stdin-smoke","title":"BF-128 Live Stdin Smoke","summary":"stdin JSON routed through MCP in temp harness."}]}' | npx tsx src/shell/edge/main/cli/voicetree-cli.ts --port 3101 --json graph create
=> success; created bf-128-live-stdin-smoke.md in the temp watched vault

$ npx tsx src/shell/edge/main/cli/voicetree-cli.ts --port 3101 --terminal eva-live-smoke --json graph create --node 'BF-128 Live Explicit Smoke::explicit --node routed through MCP in temp harness.'
=> success; created bf-128-live-explicit-smoke.md in the temp watched vault

$ cat > .../bf-128-watcher-attribution-smoke.md
=> wrote a markdown file directly with agent_name: EvaSmoke (no create_graph call)

$ sleep 2 && npx tsx src/shell/edge/main/cli/voicetree-cli.ts --port 3101 --json agent list
=> newNodes for eva-live-smoke included:
   - bf-128-live-stdin-smoke.md
   - bf-128-live-explicit-smoke.md
   - bf-128-watcher-attribution-smoke.md
=> Probe C resolved true: watcher/query attribution recovery works without registerAgentNodes()
```

## Outcome

BF-120 verification is green on the targeted surface this phase owns. The only red automated results came from unrelated ambient suites outside the filesystem-authoring / CLI-routing / live-adapter change set.

---
color: blue
agent_name: Uma
---

# BF-314 Phase 5 crash resilience + registry reconciliation complete

## Summary

Implemented tmux terminal registry reconciliation, persisted `TerminalData` for tmux-backed headless agents, wired reconciliation into `vt-mcpd` / `vt serve` / Electron startup, added a real-tmux reconciliation test, and produced BF-314 evidence plus leaf synthesis.

Relay crash and CLI symmetry passed. The Electron kill/relaunch panel-rebind check was blocked by sandbox process-list restrictions and remains a manual sweep before Phase 6.

## Files Changed

- `packages/systems/agent-runtime/src/application/terminals/terminal-registry/reconciliation.ts`
- `packages/systems/agent-runtime/src/application/terminals/terminal-registry/index.ts`
- `packages/systems/agent-runtime/src/application/headless/headlessAgentManager.ts`
- `packages/systems/agent-runtime/src/api/agent-runtime-api.ts`
- `packages/systems/agent-runtime/src/application/terminals/tests/terminal-registry.reconciliation.test.ts`
- `packages/systems/voicetree-mcp/bin/vt-mcpd.ts`
- `webapp/src/shell/edge/main/cli/commands/runtime/serve.ts`
- `webapp/src/shell/edge/main/runtime/electron/app/main.ts`
- `spikes/tmux-agent-lifecycle/crash-resilience/test-1-kill-relay.md`
- `spikes/tmux-agent-lifecycle/crash-resilience/test-2-kill-electron.md`
- `spikes/tmux-agent-lifecycle/crash-resilience/test-3-cli-symmetry.md`
- `bf-314-phase5-leaf-synthesis.md`

## DIFF

```diff
diff --git a/packages/systems/agent-runtime/src/application/terminals/terminal-registry/reconciliation.ts b/packages/systems/agent-runtime/src/application/terminals/terminal-registry/reconciliation.ts
+export async function reconcileTmuxTerminalRegistry(vaultPath: string, deps: TmuxReconciliationDeps = {}): Promise<TmuxReconciliationResult> {
+    const terminalDir: string = join(vaultPath, '.voicetree', 'terminals')
+    const hasSession: (name: string) => Promise<boolean> = deps.hasSession ?? defaultHasSession
+    const result: TmuxReconciliationResult = {imported: [], markedExited: [], skipped: []}
+    // scan JSON metadata, import live sessions, mark stale sessions exited
+}
+
diff --git a/packages/systems/agent-runtime/src/application/headless/headlessAgentManager.ts b/packages/systems/agent-runtime/src/application/headless/headlessAgentManager.ts
+        terminalData,
+export async function reconcileTmuxHeadlessAgents(vaultPath: string, deps: HeadlessAgentDeps = defaultHeadlessAgentDeps): Promise<TmuxReconciliationResult> {
+    return reconcileTmuxTerminalRegistry(vaultPath, {hasSession, onRunningSession: ({terminalId, metadataPath, metadata}) => {
+        tmuxHeadlessSessions.set(terminalId, {logPath: metadata.logFile ?? join(vaultPath, '.voicetree', 'terminals', `${terminalId}.log`), metadataPath, pollTimer: startTmuxExitPoll(terminalId, deps)})
+    }})
+}
```

## Evidence

- `spikes/tmux-agent-lifecycle/crash-resilience/test-1-kill-relay.md`: PASS, relay killed with `SIGKILL`, tmux survived, relay reconnected in 158 ms.
- `spikes/tmux-agent-lifecycle/crash-resilience/test-2-kill-electron.md`: BLOCKED, sandbox denies process listing (`pgrep` / `ps`), manual Electron kill/relaunch panel rebind remains.
- `spikes/tmux-agent-lifecycle/crash-resilience/test-3-cli-symmetry.md`: PASS, CLI `tmux attach` and relay attach observed each other's sentinel commands.
- `bf-314-phase5-leaf-synthesis.md`: recommends GO-WITH-MITIGATIONS; do not flip default until manual Electron sweep passes.

## Verification

- `npx vitest run packages/systems/agent-runtime/src/application/terminals/tests/terminal-registry.reconciliation.test.ts packages/systems/agent-runtime/src/application/headless/tests/headlessAgentManager.tmux.test.ts` -> 2 files / 2 tests PASS.
- `npm --workspace @vt/agent-runtime run test` -> 24 files / 300 tests PASS.
- `npm --workspace @vt/agent-runtime run typecheck` -> FAIL in pre-existing graph-model readonly collection errors.
- `npm run test` -> FAIL during existing health tier checks: `graph-db-client-e2e-system`, `graph-db-server-e2e-system`, `graph-state-public-api-contract`.
- `tmux ls | rg 'bf314|bf311|bf310|bf312|bf313'` -> no matching sessions left.

## Learnings

- Tried to perform the Electron kill test directly, but process discovery is blocked in this sandbox; the correct successor action is a manual Electron kill/relaunch sweep, not more headless retries.
- Future agents may miss that registry import alone is insufficient: the tmux-backed headless session map must also be rebuilt or MCP `send_message` / `read_terminal_output` will treat imported records as non-tmux.
- The key model is: persisted JSON is the durable registry source, tmux is the liveness oracle, and `TerminalData` must be persisted for faithful UI/MCP restoration.

## Parent

documents completion of [[task_1778838430501clh]]


# BF-314 Phase 5 leaf synthesis

Per-test verdicts:
- Test 1 kill-relay-mid-operation: PASS. Relay process was killed with `SIGKILL`; tmux session survived; restarted relay reconnected in 158 ms and accepted new input.
- Test 2 kill-Electron: BLOCKED in headless sandbox. `pgrep` and `ps` were not permitted, so Electron PID discovery and relaunch/panel-rebind verification could not be performed here.
- Test 3 CLI symmetry: PASS. Plain `tmux attach` and relay WebSocket attach observed each other's sentinel input in both directions.
- Section 5.4/5.5 registry reconciliation: PASS. Startup reconciliation scans persisted running tmux JSONs, imports live sessions, marks stale sessions exited, and has a real-tmux integration test.

Crash-resilience verdict:
- Headless relay crash resilience: PASS.
- Full Electron crash resilience: NOT FULLY PROVEN in this sandbox because Test 2 requires a manual Electron kill/relaunch sweep.

Residual risks:
- Electron panel recreation/rebind after a hard app kill is still a manual validation item. Registry reconciliation is in place, but this sandbox could not prove renderer panel restoration end-to-end.
- Reconciled legacy metadata without persisted `terminalData` falls back to a minimal headless terminal record. New BF-314 metadata persists full `TerminalData`, so this is only a backwards-compatibility fallback.

Calibration claims:
- Claim: tmux-backed sessions survive relay process death. Confidence: high. Falsifier: `tmux has-session -t {name}` fails immediately after relay `SIGKILL`.
- Claim: registry reconciliation does not respawn live tmux sessions. Confidence: high. Falsifier: test shows a second pane PID/session creation instead of importing existing JSON.
- Claim: stale running JSONs are rewritten to `status: "exited"` on startup. Confidence: high. Falsifier: a staged JSON whose tmux session is absent remains `running` after reconciliation.
- Claim: Electron hard-kill panel rebind is likely but not proven here. Confidence: medium. Falsifier: manual kill/relaunch leaves registry imported but no usable terminal panel attached to the session.

Phase 6 recommendation:
- GO-WITH-MITIGATIONS. The load-bearing tmux/relay/session mechanics passed, and registry reconciliation now exists with tests. Do not flip the default until Sam runs the manual Electron kill/relaunch/panel-rebind sweep and records Test 2 as PASS.

Verification:
- `npx vitest run packages/systems/agent-runtime/src/application/terminals/tests/terminal-registry.reconciliation.test.ts packages/systems/agent-runtime/src/application/headless/tests/headlessAgentManager.tmux.test.ts` -> 2 files / 2 tests PASS.
- `npm --workspace @vt/agent-runtime run test` -> 24 files / 300 tests PASS.
- `npm --workspace @vt/agent-runtime run typecheck` -> FAIL in pre-existing `graph-model` readonly collection errors.
- `npm run test` -> FAIL during existing health tier checks (`graph-db-client-e2e-system`, `graph-db-server-e2e-system`, `graph-state-public-api-contract`), before webapp tests.


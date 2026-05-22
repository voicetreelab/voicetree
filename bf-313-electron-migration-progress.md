---
color: green
agent_name: Timi
---

# BF-313 Electron relay WS migration progress

## Summary

Implemented Phase 4 client wiring for the tmux terminal migration. `TerminalVanilla` now keeps the default `node-pty` IPC path intact, but when `ptyBackend === "tmux"` it attaches xterm.js to the BF-312 relay WebSocket at `ws://localhost:{getMcpPort()}/terminals/{terminalId}/attach`.

The tmux path maps relay `{type:"data",payload}` messages to `term.write`, sends terminal input as `{type:"data",payload}`, sends resize as `{type:"resize",cols,rows}`, shows a small relay status badge, retries closed sockets with 200 ms exponential backoff capped at 5 s, and does not kill the tmux session when the Electron panel is disposed.

Electron IPC spawn is also gated: when settings say `ptyBackend === "tmux"`, `terminal:spawn` returns the existing `terminalData.terminalId` without calling `terminalManager.spawn`, so the Electron main process does not become the node-pty owner for tmux-backed terminals.

## Files Changed

- `webapp/src/shell/UI/floating-windows/terminals/TerminalVanilla.ts`
- `webapp/src/shell/UI/floating-windows/terminals/terminal-chrome.css`
- `webapp/src/shell/UI/floating-windows/terminals/terminalRelayClient.ts`
- `webapp/src/shell/UI/floating-windows/terminals/terminalRelayClient.test.ts`
- `webapp/src/shell/edge/main/agent/terminals/ipc-terminal-handlers.ts`
- `webapp/src/shell/edge/main/agent/terminals/terminal-backend-gate.ts`
- `webapp/src/shell/edge/main/agent/terminals/ipc-terminal-handlers.test.ts`
- `spikes/tmux-agent-lifecycle/viewport/webapp-integration/EVIDENCE/phase4-verification-gap.md`

## Verification

- PASS: `npx vitest run webapp/src/shell/UI/floating-windows/terminals/terminalRelayClient.test.ts webapp/src/shell/edge/main/agent/terminals/ipc-terminal-handlers.test.ts`
  - Result: 2 files, 3 tests.
- PASS: `npm --workspace webapp exec tsc --noEmit --pretty false`
- BLOCKED: `npm --workspace webapp run lint:run -- --quiet`
  - `eslint: command not found`
- BLOCKED: `npx eslint ...`
  - npm cache under `/Users/bobbobby/.npm/_cacache` contains root-owned files and cannot be written by this process.
- BLOCKED: `npm --workspace webapp run test`
  - Startup error before tests: missing installed dependency `@vitejs/plugin-react`.
- NOT RUN: Electron close/reopen manual sweep. The gap is recorded in `spikes/tmux-agent-lifecycle/viewport/webapp-integration/EVIDENCE/phase4-verification-gap.md`.

## Commit Relay

Commit message:

```text
[BF-313] feat: Electron xterm.js → relay WS migration (Phase 4)
```

Git add commands:

```bash
git add webapp/src/shell/UI/floating-windows/terminals/TerminalVanilla.ts webapp/src/shell/UI/floating-windows/terminals/terminal-chrome.css webapp/src/shell/UI/floating-windows/terminals/terminalRelayClient.ts webapp/src/shell/UI/floating-windows/terminals/terminalRelayClient.test.ts webapp/src/shell/edge/main/agent/terminals/ipc-terminal-handlers.ts webapp/src/shell/edge/main/agent/terminals/terminal-backend-gate.ts webapp/src/shell/edge/main/agent/terminals/ipc-terminal-handlers.test.ts
git add -f spikes/tmux-agent-lifecycle/viewport/webapp-integration/EVIDENCE/phase4-verification-gap.md bf-313-electron-migration-progress.md
```

Sandbox Git blocker:

```text
fatal: Unable to create '/Users/bobbobby/repos/voicetree-public/.git/worktrees/wt-spike-filesystem-native-agent--1wx/index.lock': Operation not permitted
```

## Learnings

- Tried the narrow implementation path first: branch the existing terminal wrapper and leave the xterm/addon stack untouched. That held; no renderer redesign was needed.
- Future pitfall: do not route tmux mode through `window.electronAPI.terminal.spawn`; that reaches the Electron-owned node-pty terminal manager and defeats the migration. The renderer attaches by terminal id, and the IPC handler now has a defensive bypass.
- The default remains `ptyBackend: "node-pty"`. Phase 4 only adds the tmux attach path behind the flag and leaves relay code, `terminal-output-buffer.ts`, `tmux-session-manager.ts`, and registry reconciliation untouched.

relates_to [[task_1778837768983l9n.md]]

# BF-313 Phase 4 Verification Gap

Implemented and locally verified on 2026-05-15:

- `npx vitest run webapp/src/shell/UI/floating-windows/terminals/terminalRelayClient.test.ts webapp/src/shell/edge/main/agent/terminals/ipc-terminal-handlers.test.ts`
  - PASS: 2 files, 3 tests.
- `npm --workspace webapp exec tsc --noEmit --pretty false`
  - PASS.

Not completed in this sandbox:

- Electron close/reopen manual sweep with screenshot or video capture.
- ESLint. The then-current direct webapp ESLint script failed because `eslint` is not installed in this checkout; `npx eslint ...` failed because `/Users/example/.npm/_cacache` contains root-owned files and cannot be written by this process.
- Full webapp test gate. `npm --workspace webapp run test` failed before running tests because `@vitejs/plugin-react` is missing from the installed workspace dependencies.

Manual sweep still needed:

- Set `ptyBackend: "tmux"`.
- Spawn or select an existing tmux-backed terminal.
- Confirm the xterm panel renders via `ws://localhost:{MCP_PORT}/terminals/{name}/attach`.
- Quit Electron and reopen.
- Confirm the tmux session remains alive and the panel reattaches with scrollback/history.

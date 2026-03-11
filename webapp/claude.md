<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
<!-- OPENSPEC:END -->

This project is a UI for a live tree/graph visualisation of markdown folders and orchestration system for coding agents

## Development

Testing:
`npm run test` - Runs all unit tests
`npx vitest run <file>` - Test specific unit tests
`npx electron-vite build && npx playwright test webapp/tests/e2e/full-electron/electron-terminal.spec.ts --config=playwright-electron.config.ts` - Run electron test
 If electron playwright tests, such as smoke tests fail with unclear error messages, run `npm run electron:prod` WITH IMPORTANTLY A 30s bash tool timeout. This reveals electron startup errors that don't show up in test logs. 

DO NOT run `npm run dev` or `npm run electron` in foreground without a short timeout. These will block your session as they start indefinite servers.

### FILE EDITING

- NEVER remove comments written by a HUMAN, (e.g. tagged with  //human), you are only allowed to concisely modify them minimal edits if the comment has become out of date 

### PHILOSOPHY

THIS PROJECT AIMS TO FOLLOW FUNCTIONAL DESIGN. NOT OOP. EVERYTHING SHOULD BE MODELLED AS FUNCTIONS & types. PREFER. PUSH IMPURITY TO EDGE / SHELL.

We favor "deep functions", a single function to provide a minimal public API hiding internal complexity. Deep and narrow. These can themselves be composition of functions.
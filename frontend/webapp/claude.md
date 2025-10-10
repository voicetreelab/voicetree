This project is a UI for a live tree/graph visualisation of markdown file tre.
The visual cytoscape.js tree should update automatically on file changes (CUD).
It also contains an input window for voice-> text or text input which will call the backend endpoint for updating the tree.

The tree is navigateable, and can be modified with markdown floating editors, or floating terminals.

## Development

Primary development command:
`npm run electron` - Starts electron-vite dev mode with --watch flag for hot reload of main process, preload, and renderer

Testing:
`npm run test` - Runs all unit tests and our main e2e system playwright test
`npx vitest run <file>` - Test specific unit tests
`npx playwright test tests/e2e/isolated-with-harness-graph-core/breathing-animation.spec.ts` - Run a specific playwright test in browser
`npx electron-vite build && npx playwright test webapp/tests/e2e/full-electron/electron-terminal.spec.ts --config=playwright-electron.config.ts` - Run electron test

## Important Config Notes
DO NOT run `npm run dev` or `npm run electron` in foreground. These will block your session as they start indefinite servers.

All code you write will be typechecked, this means you can't use `any` type (edits will be blocked)
@typescript-eslint/no-explicit-any
Same with "Unexpected aliasing of 'this' to local variable" from @typescript-eslint/no-this-alias

## Folders

cytoscape graph visualisation is at webapp/src/graph-core


We favor "deep modules", a single class with a minimal public API hiding internal complexity, over shallow ones that create unnecessary indirection.
This project is a UI for a live tree/graph visualisation of markdown file tree.
The visual cytoscape.js tree should update automatically on file changes. 
It also contains an input window for voice-> text or text input which will call the text to tree server endpoint for updating the tree.

The tree is navigable, and can be modified with markdown floating editors, or floating terminals.

## Development

Primary development command:
`npm run electron` - Starts electron-vite dev mode with --watch flag for hot reload of main process, preload, and renderer

Testing:
`npm run test` - Runs all unit tests
`npx vitest run <file>` - Test specific unit tests
`npx playwright test tests/e2e/isolated-with-harness-graph-core/breathing-animation.spec.ts` - Run a specific playwright test in browser
`npx electron-vite build && npx playwright test webapp/tests/e2e/full-electron/electron-terminal.spec.ts --config=playwright-electron.config.ts` - Run electron test
 If electron playwright tests, such as smoke tests fail with unclear error messages, run `npm run electron:prod` WITH IMPORTANTLY A 30s bash tool timeout. This reveals electron startup errors that don't show up in test logs. 

DO NOT run `npm run dev` or `npm run electron` in foreground without a short timeout. These will block your session as they start indefinite servers.

### HANDOVER

Once you are at 100,000 tokens, make a <TASK>_HANDOVER.md document saving your thought process for how you were going to solve your next steps.

### FILE EDITING

- NEVER remove comments written by a HUMAN, (e.g. tagged with  //human), you are only allowed to concisely modify them minimal edits if the comment has become out of date 

- All code you write will be typechecked, this means you CAN NOT use the `any` type,
you must specify the type of any variable.

### PHILOSOPHY

THIS PROJECT AIMS TO FOLLOW FUNCTIONAL DESIGN. NOT OOP. EVERYTHING SHOULD BE MODELLED AS FUNCTIONS. PURE OR IMPURE. PUSH IMPURITY TO EDGEs.

We favor "deep functions", a single function to provide a minimal public API hiding internal complexity. Deep and narrow.  

The folder structure of this project should aim to represent our architecture. 

DO NOT create unnecessary indirection.

Do not create dependency objects, push state to the functional edge/shell in src/functional/shell/state. Keep it as just a local variable here.
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
`npx playwright test tests/e2e/graph-core/breathing-animation.spec.ts` - Run a specific playwright test

## Important Config Notes

**When adding Vite plugins or renderer config:**
- ✅ Add to `vite.renderer.config.ts` (shared config)
- ❌ Never add directly to `vite.config.ts` or `electron.vite.config.ts`
- This prevents config drift between browser and electron modes

See ELECTRON_VITE_SETUP.md for detailed architecture and best practices.

DO NOT run `npm run dev` or `npm run electron` in foreground. These will block your session as they start indefinite servers.

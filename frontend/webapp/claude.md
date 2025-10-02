This project is a UI for a live tree/graph visualisation of markdown file tre.
The visual cytoscape.js tree should update automatically on file changes (CUD).
It also contains an input window for voice-> text or text input which will call the backend endpoint for updating the tree.

The tree is navigateable, and can be modified with markdown hover edtiors.

After making changes, test with either
`npm run test` this runs all unit test, and our main e2e system playwright test.

`npx vitest run <file>` test specific unit tests

`npx playwright test tests/e2e/graph-core/breathing-animation.spec.ts` # run a playwright test

DO NOT run `npm run dev` in foreground. This will block your session as it starts an indefinite server.

This project is a UI for a live tree/graph visualisation of markdown file tre.
The visual cytoscape.js tree should update automatically on file changes (CUD).
It also contains an input window for voice-> text or text input which will call the backend endpoint for updating the tree.

The tree is navigateable, and can be modified with markdown hover edtiors.

After making changes, test with
npm run test

DO NOT run npm run dev in foreground. This will block your session as it starts an indefinite server.

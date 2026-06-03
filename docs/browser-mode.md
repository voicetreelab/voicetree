# Run VoiceTree in the browser (no Electron) — `vt webapp`

`vt webapp` serves the full VoiceTree UI in your normal web browser, with no
Electron shell. It boots both per-project daemons, starts the webapp dev server
(vite) pointed at `vt-daemon`, and opens the browser. The page talks to a single
daemon (`vt-daemon`); the graph database (`vt-graphd`) stays loopback-internal
behind it.

**This is a monorepo-only dev command.** It serves the live `webapp/` vite source
tree, so it only works from a checkout of this repo. The `@voicetree/cli` package
is **not** published to npm today — `npm install -g @voicetree/cli` / `npx` do
**not** work yet. For the packaged end-user experience, use the desktop app
(see the [Install](../readme.md#install) section in the root readme).

## Steps (from a monorepo checkout)

```bash
# 1. Clone and install dependencies (Node.js 22+, pnpm 10 via `corepack enable`)
git clone https://github.com/voicetreelab/voicetree.git
cd voicetree
pnpm install

# 2. Launch the browser app for a project
./packages/systems/voicetree-cli/bin/vt webapp --project /path/to/your/project
```

This serves the UI on http://localhost:3000 and opens it in your browser. Press
Ctrl-C to stop the dev server (the daemons are shared resources and are left
running on exit).

## Flags

- `--project <path>` (required) — the project graph to open.
- `--port <n>` — port for the webapp dev server (default `3000`). Use this to
  avoid a clash with an Electron dev server already running on port 3000.
- `--no-open` — start the server but do not auto-open a browser tab.

> Note: if a `vt-daemon` is already running for the project, `vt webapp` reuses
> it. A reused daemon keeps its existing CORS config, so if the browser shows
> CORS errors, stop that daemon and rerun (or pick a matching `--port`).

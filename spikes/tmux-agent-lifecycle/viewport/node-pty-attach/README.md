# BF-207 node-pty tmux attach bridge

This spike validates the renderer bridge shape from `spike-tmux-renderer-bridge/design.md`:

```
xterm.js <-> WebSocket /attach/:name <-> node-pty spawned `tmux attach -t name` <-> tmux session
```

## Run

```sh
npm install
npm test
```

The bridge can also be run directly:

```sh
npm start
open "http://127.0.0.1:4277/?name=np-demo"
```

Create the tmux session before opening the page:

```sh
tmux new-session -d -s np-demo
```

The test harness creates and removes only `np-*` tmux sessions.

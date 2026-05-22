# BF-206 pipe-pane probe

This probe tests whether `tmux pipe-pane -O` can replace the BF-203 `capture-pane` polling bridge. It starts `pp-*` tmux sessions, pipes pane output into `.runtime-streams/*.stream.log`, tails new bytes with Node, and forwards those chunks to xterm.js over WebSocket. Input still uses `tmux send-keys`, matching the BF-203 input path.

## Setup

Use the parent viewport install:

```bash
cd spikes/tmux-agent-lifecycle/viewport
npm install
npx playwright install chromium
cd pipe-pane-probe
```

## Run

```bash
npm start
```

Open `http://127.0.0.1:4176/?agent=Smoke&command=bash`. The server creates `pp-Smoke` on first connection and writes the raw pipe stream to `.runtime-streams/Smoke.stream.log`.

## Capture evidence

```bash
npm run capture:evidence
```

The capture script verifies `claude --print` smoke rendering, starts an interactive `claude` session, counts raw alt-screen toggles in the pipe stream, sends a 5000-byte random-base64 paste through `tmux send-keys -l`, saves screenshots to `EVIDENCE/`, and kills every `pp-*` session on exit.

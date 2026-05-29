# BF-203 tmux viewport prototype

Standalone xterm.js viewport for a BF-200 tmux-backed agent session. The server reuses `../spawn-agent.sh` and `../kill-agent.sh`, renders `tmux capture-pane` frames in the browser, and sends browser terminal input back to tmux with `tmux send-keys`.

## Setup

```bash
cd spikes/tmux-agent-lifecycle/viewport
npm install
npx playwright install chromium
```

## Run the viewport manually

```bash
npm start
```

Open `http://127.0.0.1:4173/?agent=BF203`. The server starts `vt-BF203` on first browser connection unless the session already exists.

Useful environment variables:

```bash
PORT=4174 npm start
VIEWPORT_AGENT=Rex npm start
PROJECT_DIR=/tmp/bf203-project npm start
```

## Capture evidence

```bash
npm run capture:evidence
```

The capture script starts the server, opens Chromium through Playwright, types commands into xterm, waits for real `claude --print` output in the tmux pane, saves screenshots into `EVIDENCE/`, then kills `vt-BF203`.

## Cleanup

```bash
npm run clean
```

This kills the viewport agent session for `VIEWPORT_AGENT` or `BF203`.

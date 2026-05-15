# BF-203 viewport results

## Approach

The prototype uses a WebSocket bridge that polls `tmux capture-pane -e` into xterm.js and maps xterm input back to `tmux send-keys`. This was the cheapest falsification path because it reuses the BF-200 spawn/kill scripts and avoids native `node-pty` build risk while still exercising the same tmux session boundary the product would rely on.

## (A) Rendering

Verdict: PASS.

Evidence: `EVIDENCE/render.png`.

The screenshot shows xterm rendering the live `vt-BF203` pane, including ANSI green output from `printf`, three delayed tick lines, and a real `claude --print` response of `RENDER_PASS`.

## (B) Keystrokes

Verdict: PASS.

Evidence: `EVIDENCE/keystroke.png`.

The screenshot shows a command typed through the xterm viewport, delivered to tmux through `send-keys`, and acted on by real `claude --print`, which returned `KEYSTROKE_PASS`.

## Latency observations

The bridge polls tmux every 100 ms. The final automated capture reported `firstFrameAfterInputMs: 5946`, but that measurement covered the full typed command plus the `claude --print` response path, so it is dominated by Claude runtime rather than raw tmux echo latency.

## Open questions

This prototype clears the single-session render/input question only. BF-204 still needs to validate multiple concurrent sessions, browser detach/reattach behavior, and whether polling full pane snapshots remains acceptable under heavier output.

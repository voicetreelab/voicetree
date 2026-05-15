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

## BF-204 stress extension

Verdict: PASS for N=3 concurrent viewports and detach/reattach history recovery.

Evidence:
- `STRESS_RESULTS.json`
- `STRESS_RUN_LOG.md`
- `EVIDENCE/multi-3-viewports.png`
- `EVIDENCE/reattach-before.png`
- `EVIDENCE/reattach-after.png`

Results:
- `multi_C_n3_pass`: true
- `multi_C_n10_pass`: "untested"
- `multi_C_max_concurrent_observed`: 3
- `reattach_D_pass`: true
- `reattach_D_history_lines_recovered`: 2

The same polling bridge held up for three simultaneous browser viewports backed by three independent `vt-BF204-*` tmux sessions. No cross-talk was observed. For reattach, `vt-Rex` stayed alive while the browser and viewport server were killed; its tmux log grew from 483 to 638 bytes while disconnected, and the reopened viewport recovered the disconnected Claude output line plus the completion marker.

Remaining risk for BF-205: N=10 was intentionally left untested to keep BF-204 bounded, so the full-pane polling strategy still needs a higher-fanout or higher-output stress pass before productizing.

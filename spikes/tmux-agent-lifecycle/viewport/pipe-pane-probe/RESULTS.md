# BF-206 pipe-pane streaming probe results

## Approach

The probe starts isolated `pp-*` tmux sessions and attaches `tmux pipe-pane -O 'cat > .runtime-streams/<agent>.stream.log'` to each pane. A Node WebSocket server tails the stream file with `fs.watchFile` and forwards new raw chunks into xterm.js; browser input and scripted paste still go through `tmux send-keys`, matching the BF-203 input path while replacing `capture-pane` polling with push streaming.

## Fidelity verdict per test

| Test | Verdict | Evidence |
| --- | --- | --- |
| Smoke render | PASS | `EVIDENCE/render.png`; real `claude --print` produced `PIPE_PANE_RENDER_PASS` in xterm. |
| Alt-screen | FAIL | Raw stream toggle count: `0`; `EVIDENCE/tui-or-fail.png`; `EVIDENCE/tui.stream.log` contains no `ESC[?1049h` or `ESC[?1049l`. |
| Cursor positioning | PASS | Stream contained 25 carriage returns and 55 cursor/control sequences while interactive `claude` was active, and xterm did not show the spinner as simple appended lines. |
| Paste | FAIL | One `tmux send-keys -l` sent 6668 base64 characters, but only the tail token was visible in the pane and stream; the full buffer was not visible as one contiguous input buffer. Evidence: `EVIDENCE/paste.png`, `EVIDENCE/capture-results.json`. |

## One-line recommendation

pipe-pane has same fidelity ceiling as polling, node-pty needed

## Numeric

Alt-screen toggle count in stream: `0`

## Notes

- `tmux pipe-pane -O` is push-based and lower-latency than periodic `capture-pane`, but this run shows it is still not equivalent to raw PTY bytes from `tmux attach`.
- The critical failure is alt-screen fidelity: interactive `claude` did not emit `ESC[?1049` toggles into the pipe stream, so the stream appears to be tmux pane output after terminal interpretation rather than the raw TUI byte stream the renderer bridge needs.
- Smoke rendering passing is still useful: pipe-pane is viable for log-like command output, but not as the migration's full terminal renderer bridge.

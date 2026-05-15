# BF-207 node-pty + tmux attach results

## Verdict
GO for the node-pty `tmux attach` bridge.

## Results
- node_pty_install_ok: true
- A_render_pass: true
- B_keystroke_pass: true
- C_n3_pass: true
- D_reattach_pass: true (2 disconnected history lines recovered)
- paste_pass: true (200 lines received)
- latency_p50_ms: 103
- latency_p95_ms: 106

## Notes
- claude version: 2.1.142 (Claude Code)
- node-pty npm install succeeded, but first runtime spawn failed with posix_spawnp failed until npm rebuild node-pty --build-from-source was run locally.
- Resize request sent through WS resize -> node-pty resize; tmux pane reports 100 27.
- Latency measured as command send -> token visible in xterm buffer over 100 shell echoes.

# BF-312 relay production latency

Measured: 2026-05-15T09:28:01.475Z
Platform: Darwin 24.6.0 arm64
Linux gap: this worktree ran on macOS; no Linux runner was available in-session.
Method: event-driven Node measurement against the production `mountTmuxAttachRelay` WebSocket endpoint. Each sample timestamps immediately before WS `input` send and resolves on the WS `data` event containing the echoed token. Direct node-pty baseline uses the same bash echo loop without tmux/WS.

| metric | p50_ms | p95_ms | min_ms | max_ms | samples |
| --- | ---: | ---: | ---: | ---: | ---: |
| direct_node_pty_baseline | 0 | 0 | 0 | 0 | 40 |
| relay_ws_tmux_attach | 45 | 47 | 1 | 49 | 40 |

Result: `overhead_p95=47ms` (PASS; gate `<200ms`).

Raw baseline samples ms: 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0

Raw bridge samples ms: 1, 42, 43, 44, 44, 44, 44, 44, 44, 44, 44, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 46, 46, 46, 46, 46, 46, 46, 47, 47, 47, 47, 47, 49

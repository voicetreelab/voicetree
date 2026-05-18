# BF-312 relay N=10 stress

Measured: 2026-05-15T09:28:01.475Z
Platform: Darwin 24.6.0 arm64
Linux gap: this worktree ran on macOS; no Linux runner was available in-session.
Method: one production relay server, 10 tmux sessions, 10 concurrent WS attach clients. Each client sent 20 echoed tokens and resolved samples from WS `data` events, not polling.

| client | p50_ms | p95_ms | min_ms | max_ms | samples | verdict |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 0 | 51 | 54 | 1 | 54 | 20 | PASS |
| 1 | 51 | 54 | 1 | 54 | 20 | PASS |
| 2 | 51 | 54 | 1 | 54 | 20 | PASS |
| 3 | 51 | 54 | 1 | 54 | 20 | PASS |
| 4 | 51 | 54 | 1 | 54 | 20 | PASS |
| 5 | 51 | 54 | 1 | 54 | 20 | PASS |
| 6 | 51 | 54 | 1 | 54 | 20 | PASS |
| 7 | 51 | 54 | 1 | 54 | 20 | PASS |
| 8 | 51 | 54 | 1 | 54 | 20 | PASS |
| 9 | 51 | 54 | 1 | 54 | 20 | PASS |

Overall: PASS (all client p95 values < 200ms).

No `bf312-*` tmux sessions remain after cleanup check.

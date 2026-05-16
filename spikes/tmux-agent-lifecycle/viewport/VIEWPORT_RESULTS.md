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

---

# BF-205 viewport synthesis + UI go/no-go

## Executive summary

- **A (xterm renders live tmux pane): PASS** — `EVIDENCE/render.png` shows ANSI + real `claude --print` output rendered in xterm.js via the polling bridge.
- **B (keystrokes round-trip): PASS** — `EVIDENCE/keystroke.png` shows xterm input delivered through `tmux send-keys` and acted on by `claude --print` (`KEYSTROKE_PASS`).
- **C (N concurrent viewports): PASS at N=3 / INCONCLUSIVE at N=10** — `STRESS_RESULTS.json:multi_C_max_concurrent_observed=3`, `multi_C_n10_pass="untested"`; three simultaneous real `claude --print` sessions with no cross-talk.
- **D (detach/reattach preserves history): PASS** — `STRESS_RESULTS.json:reattach_D_history_lines_recovered=2`; `vt-Rex` log grew 483→638 bytes while viewport/browser were dead, and reopening the viewport recovered both lines.
- **Recommendation: PIVOT** — **GO for the polling/`capture-pane` bridge** validated here; the parent migration (`refactor-tmuxify-agent-terminals`) is designed against a **node-pty(`tmux attach`) byte-stream bridge** which this spike did NOT exercise, so the `spike-tmux-renderer-bridge` 6-check battery (render fidelity diff vs. node-pty, resize, paste, p95 latency, raw-ANSI `.log` tax) must run before the migration commits to a bridge.

## Combined verdict table

| Concern | Verdict | Evidence file or RESULTS key | 1-sentence rationale |
|---|---|---|---|
| A xterm renders live tmux pane | PASS | `EVIDENCE/render.png` (BF-203) | ANSI green output, delayed ticks, and a real `claude --print RENDER_PASS` response all rendered live in xterm.js via the WebSocket+`capture-pane` poll bridge. |
| B keystrokes round-trip | PASS | `EVIDENCE/keystroke.png` (BF-203) | Browser-typed input was delivered by `tmux send-keys` and produced `KEYSTROKE_PASS` from real `claude --print` in the same xterm pane. |
| C N concurrent viewports | PASS at N=3 / INCONCLUSIVE at N=10 | `STRESS_RESULTS.json` (`multi_C_n3_pass=true`, `multi_C_max_concurrent_observed=3`, `multi_C_n10_pass="untested"`); `EVIDENCE/multi-3-viewports.png` (BF-204) | Three independent `vt-BF204-*` sessions ran simultaneously through the polling bridge with no cross-talk; the N=10 stretch was deliberately not run, so the polling strategy's ceiling is unmeasured. |
| D detach/reattach preserves history | PASS | `STRESS_RESULTS.json` (`reattach_D_pass=true`, `reattach_D_history_lines_recovered=2`); `EVIDENCE/reattach-before.png`, `EVIDENCE/reattach-after.png` (BF-204) | After killing browser + viewport server, `vt-Rex`'s tmux log grew 483→638 bytes (`pipe-pane` kept appending); reopening the viewport recovered 2 history lines including the post-disconnect Claude output. |

## Open risks for the migration

1. **Bridge divergence — this verdict does NOT cover the node-pty(`tmux attach`) bridge.** BF-203/204 validate a WebSocket server polling `tmux capture-pane -e` at ~100 ms + outbound `tmux send-keys`. The parent migration design (`refactor-tmuxify-agent-terminals/design.md` + `spike-tmux-renderer-bridge/design.md`) decided on a `node-pty` subprocess wrapping `tmux attach`, with bytes streaming both ways. Render fidelity, latency, resize, paste, and raw-ANSI `.log` consumption may behave differently under the attach bridge. The `spike-tmux-renderer-bridge` spec's tasks.md "Status & reconciliation" section (brain commit `66bba45`) lists 4 checks still fully open (Resize, Paste, p95 latency vs. node-pty baseline, raw-ANSI `.log` tax) and 2 checks needing re-validation against the attach bridge (Render fidelity diff, Detach/reattach).
2. **N=10 untested** — `STRESS_RESULTS.json:multi_C_n10_pass="untested"`. BF-204 stopped at N=3. The polling strategy's behavior under higher fan-out (or higher per-pane output rate) is unmeasured; full-pane `capture-pane` cost scales with active pane count × poll frequency and was not stress-tested past 3.
3. **macOS-only measurements** — all viewport runs are Darwin 24.6.0 / `tmux 3.6a` / Node 23.7.0 (`STRESS_RUN_LOG.md` environment block). No Linux re-run for any viewport flow; the parent BF-202 GO carried the same Linux follow-up debt for the headless layer.
4. **`claude --print` mode used, not full interactive multi-turn** — every viewport evidence point drives a single-shot `claude --print` invocation. Real Claude Code interactive sessions (spinners, in-place line updates, alt-screen, syntax-highlighted diffs, paste of multi-line code, prompt editing) were not exercised. BF-203's render PNG is qualitative; there is no side-by-side comparison against the current node-pty webapp render (`spike-tmux-renderer-bridge` Check 1's pass criterion is unmet).
5. **Latency is qualitative, not p50/p95** — VIEWPORT_RESULTS.md latency observations report `firstFrameAfterInputMs: 5946` for a single round-trip dominated by `claude --print` runtime. There is no p50/p95 over N=100 keystrokes and no node-pty baseline (`spike-tmux-renderer-bridge` Check 5 still owns this in full).

## Recommendation for the migration team

**PIVOT — GO for the polling/`capture-pane` bridge as validated; run `spike-tmux-renderer-bridge`'s full 6-check battery before locking the parent migration's node-pty(`tmux attach`) bridge.**

Falsifiable numeric criteria the migration team must meet before merging the renderer pivot:

1. **Concurrency ceiling on the production target:** the chosen bridge must sustain a ≤ 100 ms render-update cadence at **N ≥ 10** simultaneously attached viewports with zero cross-talk and zero dropped frames, measured on the production Linux host. This spike confirmed N = 3 only on macOS; N = 10 and Linux are both unmet.
2. **Reattach must recover ≥ all history written while disconnected.** BF-204 recovered 2/2 lines for a single disconnected session; the migration's bridge must hit 100% recovery (no drops) when the recovery window exceeds tmux's default `history-limit` and across all attached panes simultaneously.
3. **Input-echo latency p95 ≤ baseline + 10 ms** over N ≥ 100 keystrokes versus a direct node-pty echo baseline on the same host (per `spike-tmux-renderer-bridge` Check 5). Eyeball "feels responsive" is rejected.
4. **Render fidelity gate:** side-by-side screenshot of the same prompt (spinners + code block + diff) under both bridges must match the current node-pty webapp render to byte-equivalent ANSI parser output (per `spike-tmux-renderer-bridge` Check 1). The BF-203 single screenshot does not clear this bar.

If any of (1)–(4) fails on the attach bridge, fall back to the polling bridge validated here — it has empirical PASS for A/B/C@N=3/D and a known floor of work to harden (N=10 stress, Linux re-run, paste/resize behavior under polling).

**Load-bearing numeric criterion (one line):** the productized bridge must hold a ≤ 100 ms snapshot/render cadence at **N ≥ 10 concurrent viewports** on the production Linux target with zero cross-talk; BF-204 reached `multi_C_max_concurrent_observed=3` on macOS only, so the ceiling between 3 and 10 is unmeasured and must be closed before the migration ships.

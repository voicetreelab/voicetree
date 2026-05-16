# BF-302 — Renderer bridge synthesis (GO / NO-GO + migration addendum)

Synthesizes BF-301's residual empirical battery (commit `2b31913d`) on top of recorded BF-207 evidence (commit `83f611f2`). Inputs: `spikes/tmux-renderer-bridge/RESULTS.json`, `RUN_LOG.md`, `spikes/tmux-agent-lifecycle/viewport/node-pty-attach/RESULTS.md`, BF-208 Q3 findings node, proposal, and design.

## Verdict

**GO-WITH-MITIGATIONS.**

5 of 6 checks PASS. Check 5 (input latency) FAILs the <10ms gate by ~10x — bridge_p95=106ms vs baseline_p95=7ms (overhead_p95=99ms). The miss is uniform (p50=103, p95=106), which is consistent either with a true fixed per-keystroke cost in the WS↔node-pty↔tmux-attach hop OR with a polling-interval artifact in BF-207's measurement methodology. The bridge is otherwise functional end-to-end (render fidelity, detach/reattach, resize, paste, sanitizer compatibility). Mitigations are specified below in `## Migration constraints` and `## design.md addendum`.

## Per-check verdicts

| # | Check | Verdict | Source |
|---|-------|---------|--------|
| 1 | Render fidelity (side-by-side) | PASS | BF-301 (`EVIDENCE/check1_attach.png`, `check1_nodepty.png`) |
| 2 | Detach + reattach in browser | PASS (recorded) | BF-207 `83f611f2` (`D_reattach_pass=true`, 2 history lines recovered) |
| 3 | Resize end-to-end | PASS | BF-301 (`tput cols`=160 in 309ms, `EVIDENCE/check3_resize_*.png`) |
| 4 | Paste 200-line | PASS (with pacing caveat) | BF-207 `83f611f2` (200/200 lines via 32B/50ms server pacing) |
| 5 | Input latency vs node-pty baseline | **FAIL** | BF-301 (`scripts/check5_latency.mjs`, `RUN_LOG.md`): baseline p95=7ms, bridge p95=106ms, overhead_p95=99ms |
| 6 | Raw-ANSI `.log` tax (Q3 patch no-op on node-pty) | PASS | BF-301 (`scripts/check6_sanitizer.mjs`, `EVIDENCE/check6_nodepty_attach.log`): drift_pct=0 |

## Load-bearing numeric criterion

`overhead_p95 = bridge_p95 − baseline_p95 = 106ms − 7ms = 99ms` against a budget of `<10ms`.

Falsifiable claim: **the node-pty(tmux attach) bridge adds ~99ms p95 to keystroke→echo latency on macOS, ~10x the design budget; safety margin = −89ms.** The number is reproducible from `spikes/tmux-renderer-bridge/RESULTS.json#5_input_latency.measured` and `scripts/check5_latency.mjs`. Re-running with `tmux set -g escape-time 0`, with a tighter measurement loop (event-driven not polling), or on Linux can falsify the reading without changing the bridge code.

Secondary load-bearing number: Check 6 `drift_pct = 0` on a 7,033-byte raw node-pty(attach) capture — confirms the Q3 1-LOC sanitizer patch is safe on the bridge's stream and can be applied without regressing attach input.

## Top risks (1–2)

1. **Check 5 measurement vs reality.** The 99ms uniform overhead is suspiciously close to a polling-interval bucket. BF-207's measurement was "command send → token visible in xterm buffer over 100 shell echoes"; if the buffer is polled at ~100ms, the measured latency is bounded below by the poll period, not the bridge. Migration must re-measure with an event-driven probe (`requestAnimationFrame`/`MutationObserver` on the xterm DOM, or hook node-pty's `onData` directly) before treating the FAIL as load-bearing. **Until that re-measurement happens, the verdict must assume ~100ms is real.**
2. **Linux re-run not yet performed.** All BF-301/BF-207 measurements are macOS Darwin 24.6 + tmux 3.6a + node 23.7. The migration's production target includes Linux; both render fidelity (Check 1) and latency (Check 5) can plausibly differ. Out of scope for the spike but a migration-Phase-3 prerequisite.

(Out-of-scope flag — N-concurrent viewport ceiling: design.md fixes spike at "one agent at a time"; the polling spike's "N≥10 @ ≤100ms" criterion does not transfer cleanly to the attach bridge because each connection is its own node-pty subprocess. Migration Phase 3 should add this gate explicitly.)

## Migration constraints

The parent migration `refactor-tmuxify-agent-terminals` must honor these, derived from BF-207 + BF-301:

- **Paste pacing:** the relay must chunk pasted input into ≤32-byte writes spaced ≥50ms apart (BF-207 `paste_pass` is conditional on this; without pacing, paste collapses). This is a relay-side constraint, not an xterm.js-side one.
- **Q3 sanitizer patch (`cleaned.replace(/\r+\n/g, '\n')` before CRLF normalize):** verified by BF-301 Check 6 to be a no-op on node-pty(attach) input (drift_pct=0). Recommended disposition: **apply NOW** (separate cheap PR, owned by Ama) — it unblocks BF-208's `read_terminal_output` MCP gate (BF-208 findings: 0 → 649 readable chars on pipe-pane input) without coupling to the migration timeline. Defer-to-migration is acceptable but leaves the MCP gate broken on pipe-pane sources for the migration window.
- **Latency budget:** the migration spec must either (a) re-measure with an event-driven probe and demonstrate overhead_p95 < 10ms, OR (b) apply the optimizations enumerated in the design.md addendum and re-measure, OR (c) explicitly accept ~100ms input latency for interactive agents and document the human-factors trade-off (still inside the ~150ms perceptual "responsive" threshold but noticeable). Do NOT silently ship the FAIL.
- **Bridge selection lock:** Q2 (BF-208) showed pipe-pane is structurally lossy for `tui_alt_screen` hook detection — node-pty(attach) is the only viable bridge. The migration cannot fall back to pipe-pane for interactive agents. (Pipe-pane remains valid for `.log` capture only.)
- **Env hygiene:** spawn `tmux attach` with an explicit minimal env (per design.md risk row) — do not inherit relay-host env into the agent terminal.

## design.md addendum for `refactor-tmuxify-agent-terminals`

> Draft paragraph for `brain/mem/openspec/changes/refactor-unixify-voicetree/refactor-tmuxify-agent-terminals/design.md`. Owner of application: Ama (do NOT apply from BF-302).

```markdown
### Renderer-bridge latency budget (per BF-302)

The `spike-tmux-renderer-bridge` synthesis (`spikes/tmux-renderer-bridge/RESULTS.md`,
commit BF-302) returned **GO-WITH-MITIGATIONS** with one load-bearing FAIL:
keystroke→echo overhead through the WS ↔ node-pty(`tmux attach`) ↔ xterm.js bridge
measured `overhead_p95 = 99ms` on macOS, ~10x the original `<10ms` budget.

Phase 3 of this migration MUST, before merging the relay WS bridge:

1. Re-measure latency with an **event-driven probe** (e.g. `MutationObserver` on the
   xterm.js DOM, or instrumenting node-pty `onData` directly). BF-301's measurement
   used a polling loop and the 99ms uniform overhead is consistent with a polling-
   interval artifact (RESULTS.md "Top risks" §1). If the event-driven probe shows
   `overhead_p95 < 10ms`, the FAIL is downgraded.
2. If the FAIL persists, apply the following tmux-side optimizations and re-measure:
   - `tmux set -g escape-time 0` (default 500ms; only affects ESC-prefixed input but
     worth eliminating)
   - Disable tmux status-line refresh on the attached client (`set -g status off`
     for the relay session, or run with `-T` to suppress periodic refresh)
   - Verify node-pty is built from source (BF-207 `npm rebuild node-pty
     --build-from-source` was required for spawn to succeed) and not throttling
     output via internal buffering
3. If the FAIL still persists after #1 and #2, the design must either explicitly
   accept ~100ms input latency for interactive agents (with human-factors note —
   still inside the ~150ms perceptual "responsive" threshold but user-visible),
   OR re-evaluate the double-bridge approach in favor of tmux control mode (`-CC`),
   which exposes structured PTY events the relay can forward without an attached
   client process.

In addition, Phase 3 MUST honor:
- **Paste pacing**: the relay chunks pasted input into ≤32-byte writes spaced ≥50ms
  apart. Without this, paste collapses (BF-207 `paste_pass`).
- **N-concurrent viewport ceiling**: BF-301 measured one agent at a time; before
  shipping, validate that N≥10 concurrent attached clients each maintain the bridge's
  per-check verdicts, especially Check 5 latency.
- **Linux re-run**: all BF-301/BF-207 measurements are macOS-only; re-run the full
  6-check battery on Linux before production cutover.

Sanitizer patch (BF-301 Check 6, BF-208 Q3): the 1-LOC pre-CRLF-normalize
(`cleaned = cleaned.replace(/\r+\n/g, '\n')`) is verified no-op on node-pty(attach)
input and recovers 0 → 649 readable chars on pipe-pane input. Recommendation: ship
as a standalone PR ahead of this migration; do not couple to the migration's timeline.
```

## Commit shas

For traceability:

- **BF-302 (this synthesis):** to be set on commit (will match `git log -1 --pretty=%h` after the synthesis commit lands; expected message `[BF-302] spike: renderer bridge synthesis (GO/NO-GO + migration addendum)`).
- **BF-301 (residual empirical battery):** `2b31913d` — `[BF-301] spike: renderer bridge residual empirical (Checks 1/3/5/6 + record 2/4)`.
- **BF-207 (node-pty + tmux attach bridge + viewport battery):** `83f611f2` — `[BF-207] spike: node-pty + tmux attach bridge + viewport battery`.
- **BF-208 (webapp integration / Q3 sanitizer findings):** uncommitted at synthesis time. Working tree shows `?? spikes/tmux-agent-lifecycle/viewport/webapp-integration/` (per `git status`); BF-208's findings are captured only in `voicetree-15-5/bf208-open-sanitizer-findings.md` and `webapp-integration/RESULTS.json`. The owning leaf is still in flight per BF-208 prediction Claim 1; the migration should reference the eventual BF-208 commit when it lands.

## PREDICTION CLAIMS

1. **(MEDIUM, ~0.6) Bridge verdict will hold as GO-WITH-MITIGATIONS through migration kickoff.** Ama will accept the verdict and the design.md addendum will land substantially as drafted, because Check 5 is the only red and it is plausibly a measurement artifact (or cheaply tunable), while the alternatives (tmux control mode, falling back to node-pty for interactive) are larger architectural moves than the migration was scoped for. *Falsifier:* Ama downgrades to NO-GO and the migration's interactive path is rerouted off `tmux attach`, OR upgrades to clean GO without honoring at least one of the three latency-mitigation paths in the addendum.

2. **(MEDIUM-HIGH, ~0.7) The 99ms uniform overhead in Check 5 is at least partially a measurement artifact.** Re-measuring with an event-driven probe (`MutationObserver` on the xterm DOM, or hooking node-pty `onData` directly) will reduce `overhead_p95` by ≥50% without any bridge changes — bringing it within striking distance of the 10ms gate or, with `escape-time=0` + status-line tweaks, possibly under it. *Falsifier:* event-driven re-measurement shows `overhead_p95 ≥ 50ms` with no methodology change and no tmux/node-pty tuning able to push it below 50ms.

3. **(HIGH, ~0.85) Q3 1-LOC sanitizer patch will be applied within one sprint of BF-302 synthesis** — either as a standalone PR (per the recommendation here) or folded into the next BF-208-area commit. The cost is 1 LOC + a regression test; the benefit is unblocking the `read_terminal_output` MCP gate; the risk is verified zero on node-pty input and bounded on pipe-pane input. *Falsifier:* the patch is still unapplied 14 days after BF-302 commit, or is rejected outright in review.

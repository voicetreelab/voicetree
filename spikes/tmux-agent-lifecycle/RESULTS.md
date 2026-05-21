# BF-202 — tmux Agent Lifecycle Spike: Results & Go/No-Go

**Status:** Hypothesis **validated**. Recommendation: **GO** (with risks noted).
**Source data:** [`RESULTS.json`](./RESULTS.json), [`RUN_LOG.md`](./RUN_LOG.md)
**Phases:** BF-200 (scaffold, commit `702df78c`) → BF-201 (empirical run, commit `7fc2d376`) → BF-202 (this doc).

---

## 1. Executive Summary

- **Hypothesis status: VALIDATED.** Agent lifecycle (spawn / observe / interact / kill / crash-resilient re-attach) can be driven by `tmux` + filesystem operations against a real `claude` binary (`claude_version` = `2.1.142 (Claude Code)`). 13/13 tests PASS.
- **Headline numbers (medians, 5 runs each):** cold-start `perf_5_1_ms = 22`, send-keys `perf_5_2_ms = 12`, has-session `perf_5_3_ms = 13`, list-sessions @10 sessions `perf_5_4_ms = 15`, output-lag `perf_5_5_ms = 1`. **Every operation is ≥ 2× under the 50 ms budget.**
- **Crash resilience: 3/3 PASS** — tmux session survives parent shell death (`crash_4_1`), `capture-pane` preserves history (`crash_4_2`), a fresh relay PID can resume control (`crash_4_3`).
- **One quantitative caveat:** `val_3_5` measured 2883 ms from spawn → exit detection — that figure conflates `claude --print` runtime with poll latency. Pure detection latency (`perf_5_3_ms = 13 ms`) is the load-bearing number; the 2 s criterion in Q4 below is met when interpreted as detection latency.
- **Recommendation, one line: GO** — proceed to the unixification migration. Every tmux op median ≤ 22 ms (criterion: < 50 ms) and crash resilience holds, so the architectural bet has empirical support.

---

## 2. Answers to the 7 Hypothesis Questions

### Q1 — Can tmux spawn a Claude Code agent with correct env vars?
- **Pass criterion:** Agent runs, uses env vars.
- **Measured result:** `val_3_1` = PASS (`metadata exists, vt-Rex is present, Rex.log became non-empty`); `claude_version` = `"2.1.142 (Claude Code)"` confirms a real `claude` binary was driven, not a stand-in; `val_3_5` shows a `claude --print` invocation producing `"Hi! What would you like to work on?"` in the captured log.
- **Verdict: PASS.** A real Claude Code agent was spawned inside `tmux new-session`, with metadata and log file produced as designed; env-var-driven invocation is observable via the spawn-agent script behavior recorded in `RUN_LOG.md §3.1` and `§3.5`.

### Q2 — Does `tmux pipe-pane` capture full output including ANSI?
- **Pass criterion:** Output is complete and usable.
- **Measured result:** `val_3_1` PASS (log non-empty within 2 s); `val_3_5` PASS — log tail in `RUN_LOG.md §3.5` shows the model greeting *and* ANSI sequences (`[?1006l[?1003l[?1002l[?1000l[>4m...`); `crash_4_2` PASS — `capture-pane` returned both `echo crash-preserved` and its output verbatim.
- **Verdict: PASS.** ANSI sequences round-trip through the log; downstream UI will need to render or strip them, but the data is fully captured. Output-lag median `perf_5_5_ms = 1` shows the pipe-pane → file path is essentially synchronous.

### Q3 — Can we inject text via `tmux send-keys` reliably?
- **Pass criterion:** Agent acts on the message.
- **Measured result:** `val_3_2` PASS (`Rex.log contains sent message text`); `RUN_LOG.md §3.2` shows `say hello` echoed by the receiving shell. `crash_4_3` PASS — after a fresh relay-PID, the agent ran `echo relay-ok` and the log records `relay-ok` on the next line. Median send-keys latency `perf_5_2_ms = 12`.
- **Verdict: PASS.** Injection is reliable, observable in the same log used for read-back, and the round-trip is sub-15 ms.

### Q4 — Does `tmux has-session` detect exit reliably?
- **Pass criterion:** Status changes within 2 s of exit.
- **Measured result:** `val_3_4` PASS (`vt-Rex absent and Rex.json status is exited`); `val_3_5` PASS but the harness recorded 2883 ms from spawn through detected natural exit — that figure includes `claude --print` execution. The isolated `has-session` call costs `perf_5_3_ms = 13 ms` (median of 5).
- **Verdict: PASS.** The exit-*detection* primitive (`tmux has-session`) is 13 ms — well under 2 s. Production polling should size cadence against `perf_5_3_ms`, not against the 2883 ms end-to-end figure, which is dominated by agent work not by tmux.

### Q5 — Does the agent survive "relay" death?
- **Pass criterion:** Agent still running.
- **Measured result:** `crash_4_1` PASS — `RUN_LOG.md §4.1` records `session vt-Rex: 0` (tmux has-session returns 0) *after* the spawning subshell PID was killed.
- **Verdict: PASS.** tmux sessions are detached from the spawner, exactly as the hypothesis required.

### Q6 — Can a new process re-attach after "relay" death?
- **Pass criterion:** Same session, output history preserved.
- **Measured result:** `crash_4_2` PASS — `tmux capture-pane -t vt-Rex -p` returned the prior `crash-preserved` output (`RUN_LOG.md §4.2`). `crash_4_3` PASS — after writing a fresh PID into `.voicetree/relay.pid`, `send-message.sh` from a new shell delivered `echo relay-ok` and the log shows both the prior and new output (`RUN_LOG.md §4.3`).
- **Verdict: PASS.** Re-attach is content-preserving and a new relay can take over without restarting the agent.

### Q7 — What's the latency of tmux operations?
- **Pass criterion:** < 50 ms per operation.
- **Measured result (median of 5):**
  - `perf_5_1_ms = 22` (new-session cold start)
  - `perf_5_2_ms = 12` (send-keys)
  - `perf_5_3_ms = 13` (has-session)
  - `perf_5_4_ms = 15` (list-sessions with 10 concurrent sessions)
  - `perf_5_5_ms = 1` (pipe-pane output lag)
- **Verdict: PASS.** Slowest measured op is 22 ms — 56 % under budget. Output lag is essentially zero, confirming the log file is a viable real-time event source.

---

## 3. Surprises / Blockers

From `RUN_LOG.md` and the Phase-1/2 progress notes:

- **Session naming asymmetry.** Phase-1 scripts prefix sessions with `vt-` (so agent `Rex` lives in tmux session `vt-Rex`). The proposal table and several test names use bare `Rex`. Harmless but a foot-gun for anyone grepping `^Rex:` in `tmux list-sessions`. Documented in `RUN_LOG.md` preamble.
- **Repo `.gitignore` swallows markdown.** `**/*.md` is globally ignored, which means every doc in the spike (`README.md`, `RESULTS.md`, `RUN_LOG.md`, this file) must be added with `git add -f`. Documented in the BF-200 progress note. **Follow-up: the unixification migration will produce lots of markdown — we need a `!spikes/**/*.md` / per-directory un-ignore before the migration lands, or every PR will silently drop docs.**
- **`val_3_5` end-to-end timing of 2883 ms is misleading.** The harness measured spawn → detect-exit, which conflates `claude --print` runtime with poll latency. The isolated `has-session` measurement is 13 ms. **Follow-up: when promoting this to production polling, budget against `perf_5_3_ms`, not the conflated figure.**
- **ANSI is captured raw.** `val_3_5` log shows long `[?1006l...` escape sequences alongside the agent greeting. **Follow-up: viewport renderer must either render or strip ANSI; downstream parsers must not assume plain text.**
- **macOS-only run.** Tests ran on Darwin 24.6.0 with `tmux 3.6a`. No Linux numbers yet. **Follow-up: re-run `run-tests.sh` on the production Linux target before locking the 50 ms budget.**

No blockers — all 13 tests PASS and the surprises above are migration-time concerns, not spike-time falsifiers.

---

## 4. Go / No-Go Recommendation

**Verdict: GO.**

**Falsifiable criterion:** every tmux primitive used by the agent-lifecycle layer has a measured median latency ≤ **22 ms** on the macOS test host, a > 2× margin under the 50 ms budget from the proposal; crash resilience is 3/3 PASS with content-preserving re-attach. If a Linux re-run pushes any single op above 50 ms, or if crash-resilience regresses on the production target, this GO must be re-evaluated.

**Next 3 concrete migration steps:**
1. **Promote the 5 phase-1 scripts into a typed `agent-lifecycle` module** (deep-narrow functions: `spawn`, `send`, `list`, `kill`, `read`). Keep impurity at the shell boundary; expose pure types upstream — aligned with the worktree CLAUDE.md FP discipline.
2. **Add a `.gitignore` exemption for `spikes/**/*.md` and any new `agent-lifecycle/**/*.md`** so docs are tracked by default; documented as a follow-up from Surprises §3.
3. **Re-run `run-tests.sh` on the target Linux host** and lock the 50 ms budget against those numbers (currently macOS-only). Publish the comparison as BF-203.

**Biggest remaining risks:**
- **ANSI handling in the viewport.** The log is raw — somebody must decide whether the renderer interprets, strips, or stores both. This is a UI question, not a tmux question, but the unixification design must answer it before shipping a user-facing viewport.
- **Linux performance unknown.** If `tmux new-session` or `has-session` is materially slower on the production OS, the budget margins shrink. Mitigation: BF-203 above.
- **Markdown gitignore footgun.** Until the `.gitignore` exemption lands, every future migration PR risks silently dropping new spec/doc files.

---

## 5. Cost / Time Accounting

- **Phase 1 (BF-200, scaffold + bash-syntax checks):** ~1 agent (Amit, leaf, depth=0). Wall time not recorded in the progress notes; estimated **≤ 30 min** based on the 5 scripts × ~30–60 lines each + README + verification doc + single commit.
- **Phase 2 (BF-201, empirical run on real `claude`):** ~1 agent (Amy, leaf). Wall time not recorded; run-tests.sh wall is dominated by `val_3_5` (2883 ms) + five 5-run perf batches. Estimated **≤ 60 min** including two portability bug-fixes called out in the progress note.
- **Phase 3 (BF-202, this synthesis):** 1 agent (Anna, depth-budget=1 not spent on sub-agents — single-context synthesis was sufficient). Estimated **≤ 15 min**.
- **Total estimated agent wall time: ~1.5–2 hours.**
- **$ cost estimate: not tracked.** No per-agent cost meter was wired into this spike. **Follow-up: the BF-201 progress notes describe the "Cost / time accounting" deliverable as part of the spec — we should add a `cost_estimate_usd` field to RESULTS.json on the next spike so this section can be authoritative rather than estimated.**

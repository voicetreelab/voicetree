# BF-204 stress run log

## Environment
- Timestamp: 2026-05-15T06:10:50.373Z
- claude: 2.1.142 (Claude Code)
- tmux: tmux 3.6a
- Node: v23.7.0
- Project: .stress-project

## Results
- multi_C_n3_pass: true
- multi_C_n10_pass: untested
- multi_C_max_concurrent_observed: 3
- reattach_D_pass: true
- reattach_D_history_lines_recovered: 2

## Evidence
- EVIDENCE/multi-3-viewports.png
- EVIDENCE/reattach-before.png
- EVIDENCE/reattach-after.png

## Transcript
- Started viewport server on 4273.
- Multi-session C: n=3 pass=true; max_concurrent=3; no_cross_talk=true.
- Started viewport server on 4274.
- Killed browser and viewport server while vt-Rex background claude command continued.
- Started viewport server on 4274.
- Reattach D: pass=true; alive_during_disconnect=true; log_bytes_before=483; log_bytes_after=638; recovered_lines=2.

## Notes
- N=10 stretch was left untested to keep this spike bounded; N=3 used real concurrent claude --print calls.
- cleanup probe empty for grep -E '^(vt-|bf204)' after run.

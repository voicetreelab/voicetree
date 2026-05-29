# BF-301 renderer bridge residual empirical run log

## Versions
tmux: tmux 3.6a
claude: 2.1.142 (Claude Code)
node: v23.7.0

## Server
BF-301 renderer bridge listening on http://127.0.0.1:4281
## Check 1 - render fidelity
Prompt:
```
Return exactly this markdown content and no extra explanation:
BF301_RENDER_START
```js
const alpha = 1;
console.log(alpha + 2);
```
```diff
- old renderer
+ tmux attach renderer
```
BF301_RENDER_END
```
$ tmux new-session -d -s bf301-check1-attach -x 120 -y 40
$ tmux send-keys -t bf301-check1-attach -l -- unset npm_config_prefix; claude --print "$(cat EVIDENCE/check1_prompt.txt)"; echo BF301_CHECK1_ATTACH_DONE
$ tmux send-keys -t bf301-check1-attach Enter
$ direct node-pty cmd: claude --print "$(cat EVIDENCE/check1_prompt.txt)"; echo BF301_CHECK1_NODEPTY_DONE
## Check 3 - resize end-to-end
$ tmux new-session -d -s bf301-check3-resize -x 80 -y 24
## Check 5 - direct node-pty latency baseline
$ node scripts/check5_latency.mjs
{"baseline_p50":6,"baseline_p95":7,"n":100,"samples":[4,4,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7]}
Measured: {"baseline_p50":6,"baseline_p95":7,"n":100,"samples":[4,4,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7],"bridge_p50":103,"bridge_p95":106,"overhead_p95":99}
## Check 6 - node-pty attach raw-ANSI log sanitizer drift
Prompt:
```
Return exactly this markdown content and no extra explanation:
BF301_LOG_START
This node-pty attach capture should remain readable after ANSI cleanup.
```ts
const bridge = "node-pty(tmux attach)";
console.log(bridge);
```
BF301_LOG_END
```
$ tmux new-session -d -s bf301-check6-log -x 120 -y 40
$ tmux send-keys -t bf301-check6-log -l -- unset npm_config_prefix; claude --print "$(cat EVIDENCE/check6_prompt.txt)"; sleep 30; echo BF301_CHECK6_DONE
$ tmux send-keys -t bf301-check6-log Enter
$ node scripts/check6_sanitizer.mjs /Users/example/repos/voicetree-public/spike-filesystem-native-agent-lifecycle/.worktrees/wt-spike-filesystem-native-agent--1wx/spikes/tmux-renderer-bridge/EVIDENCE/check6_nodepty_attach.log
{"raw_chars":7033,"unpatched":3730,"patched":3730,"drift_pct":0,"unpatched_sample":"leep*                                                                                                               \"\" 18:16 15-May-26(B\n[bf301-che0:sleep*                                                                                                               \"\" 18:17 15-May-26(B(B>[lost tty]\n","patched_sample":"leep*                                                                                                               \"\" 18:16 15-May-26(B\n[bf301-che0:sleep*                                                                                                               \"\" 18:17 15-May-26(B(B>[lost tty]\n"}
Measured: {"raw_chars":7033,"unpatched":3730,"patched":3730,"drift_pct":0,"unpatched_sample":"leep*                                                                                                               \"\" 18:16 15-May-26(B\n[bf301-che0:sleep*                                                                                                               \"\" 18:17 15-May-26(B(B>[lost tty]\n","patched_sample":"leep*                                                                                                               \"\" 18:16 15-May-26(B\n[bf301-che0:sleep*                                                                                                               \"\" 18:17 15-May-26(B(B>[lost tty]\n"}

## tmux cleanup
(none)

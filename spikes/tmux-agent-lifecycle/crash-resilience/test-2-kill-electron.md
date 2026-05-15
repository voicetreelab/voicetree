# BF-314 Test 2: kill Electron

Verdict: M1 FAIL - Electron tmux-mode panels never create/rebind backing tmux sessions, so the kill/relaunch sweep cannot validly proceed. Phase 6 stays gated.

Date: 2026-05-15
Runner: Wei
Worktree: `wt-spike-filesystem-native-agent--1wx`

## Summary

`ptyBackend` was set to `tmux` in the user settings file and Electron was launched headfully with `VOICETREE_PERSIST_STATE=1 npm --workspace webapp run electron`.

Electron reached a visible window and auto-created 3 Fake Agent panels (`Aki`, `Ama`, `Amit`) through the normal Electron debug setup. All 3 panels displayed `tmux reconnecting`. There were no tmux sessions at all, so there were no sentinels to capture and no valid Electron-kill survival test to run.

Per the M1 hard fence, this is a real architectural finding and no patch was attempted in this task.

## Step Results

| Step | Result | Evidence |
| --- | --- | --- |
| 1. Set runtime `ptyBackend = "tmux"` | PASS | `/Users/bobbobby/Library/Application Support/Voicetree/settings.json` had top-level `"ptyBackend": "tmux"`; previous settings were backed up to `settings.json.pre-m1-2026-05-15T10-19-47-911Z`. |
| 2. Build natives and launch Electron | PASS with environment workaround | `scripts/rebuild-native.sh` initially failed because `webapp/node_modules` was absent. After `npm install`, rebuild passed. Electron dev launch initially failed resolving `ws` optional native dependency `bufferutil`; installing `bufferutil` and `utf-8-validate` with `--no-save` and rebuilding them allowed Electron to launch. |
| 3. Spawn 3 agents and emit sentinels | FAIL | Electron created 3 Fake Agent panels (`Aki`, `Ama`, `Amit`), but all remained stuck at `tmux reconnecting`. No backing tmux sessions existed, so the agents could not emit sentinels. |
| 4. Capture Electron PID | PASS | Main Electron PID: `85837`. |
| 5. `kill -9 $ELECTRON_PID` | NOT RUN | Stopped before kill because step 3 failed in a load-bearing way. |
| 6. `tmux ls` between kill and relaunch | FAIL before kill | `tmux ls` returned `no server running on /private/tmp/tmux-501/default`. |
| 7. Relaunch and observe panel rebind | NOT RUN | No sessions existed to rebind. |
| 8. Optional CLI attach | NOT RUN | No tmux target existed. |

## Timestamps

- Settings override timestamp: 2026-05-15T10:19:47Z
- First successful Electron launch timestamp: 2026-05-15T10:25:52Z
- Failure observation timestamp: 2026-05-15T10:28:38Z
- Kill timestamp: not applicable; stopped before kill because no tmux sessions existed.
- Relaunch timestamp: not applicable.
- Observed rebind latency: not applicable; all panels stayed in `tmux reconnecting`.
- Post-run cleanup: the dev Electron process was stopped and the pre-M1 settings backup was restored.

## Process Evidence

```text
85837 /Users/bobbobby/repos/voicetree-public/spike-filesystem-native-agent-lifecycle/.worktrees/wt-spike-filesystem-native-agent--1wx/webapp/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .
86232 /Users/bobbobby/repos/voicetree-public/spike-filesystem-native-agent-lifecycle/.worktrees/wt-spike-filesystem-native-agent--1wx/webapp/node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Helper (GPU).app/Contents/MacOS/Electron Helper (GPU) --type=gpu-process --user-data-dir=/Users/bobbobby/Library/Application Support/Voicetree ...
86233 /Users/bobbobby/repos/voicetree-public/spike-filesystem-native-agent-lifecycle/.worktrees/wt-spike-filesystem-native-agent--1wx/webapp/node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Helper.app/Contents/MacOS/Electron Helper --type=utility --utility-sub-type=network.mojom.NetworkService --user-data-dir=/Users/bobbobby/Library/Application Support/Voicetree ...
86286 /Users/bobbobby/repos/voicetree-public/spike-filesystem-native-agent-lifecycle/.worktrees/wt-spike-filesystem-native-agent--1wx/webapp/node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Helper (Renderer).app/Contents/MacOS/Electron Helper (Renderer) --type=renderer --user-data-dir=/Users/bobbobby/Library/Application Support/Voicetree ...
```

## `tmux ls` Evidence

```text
no server running on /private/tmp/tmux-501/default
```

## Panel Text Capture

Captured from the visible Electron renderer via Playwright/CDP:

```text
TERMINALS
Hover over me
⎇ wt-spike-filesystem-native-agent--1wx
Aki - Fake Agent
×
Generate codebase graph (run me)
⎇ wt-spike-filesystem-native-agent--1wx
Ama - Fake Agent
×
Voicetree
⎇ wt-spike-filesystem-native-agent--1wx
Amit - Fake Agent
×
...
Hover over me
Aki
⎇ wt-spike-filesystem-native-agent--1wx
tmux reconnecting
Generate codebase graph (run me)
Ama
⎇ wt-spike-filesystem-native-agent--1wx
tmux reconnecting
Voicetree
Amit
⎇ wt-spike-filesystem-native-agent--1wx
tmux reconnecting
```

## Load-Bearing Verdict

M1 FAIL - Electron tmux-mode terminal panels can be created while no tmux sessions exist, leaving every panel in `tmux reconnecting`; Phase 6 default-flip remains blocked until the Electron spawn path creates or imports the tmux session before the relay attaches.

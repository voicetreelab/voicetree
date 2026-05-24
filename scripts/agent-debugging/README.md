# Agent debugging — `vtbg`

A small CLI for driving a Chrome DevTools Protocol (CDP) debugger session from
non-interactive shells (i.e. from an agent). Lets you set breakpoints, step,
inspect locals, and evaluate expressions in a running VoiceTree renderer —
without `chrome://inspect`, without VS Code, without GUI.

## Why this exists

`vt debug eval` already speaks CDP and is great for one-shot expression
evaluation. It deliberately does **not** expose `Debugger.*` verbs (breakpoint,
step, pause, inspect-on-pause). `vtbg` fills that gap.

Driving a debugger from an agent has one fundamental requirement: state must
persist across shell calls. Each tool-call is a new process, but the debugger
session (open WebSocket, set breakpoints, currently-paused frame) is inherently
stateful. `vtbg` solves this with a detached daemon: `vtbg attach` spawns the
daemon, every other subcommand is a one-shot client that talks to it.

## Install

```bash
ln -s "$PWD/scripts/agent-debugging/vtbg" ~/bin/vtbg   # if ~/bin is on PATH
# or
cp scripts/agent-debugging/vtbg ~/bin/vtbg
```

Requires Node ≥ 22 (uses built-in `WebSocket`).

## Setup: get a debuggable VoiceTree session

`vtbg` attaches to a CDP target. The easiest way to get one is `vt debug`,
which launches `npm --prefix webapp run electron:debug` and registers the CDP
port for discovery:

```bash
vt debug attach --new                    # launches Electron with CDP open
vt debug ls                              # find sessions with cdpPort > 0
# → {pid:..., cdpPort:64200, ...}

vtbg target 64200                        # list page targets at that port
# → page  Voicetree  ws://127.0.0.1:64200/devtools/page/B76848781AEEF3C0016D9FDF3ECB41FE
```

`vt debug ls` lies sometimes (stale entries). If a port shows `cdpPort:0` or
`vtbg target` returns nothing, the session is dead — use `--new`.

## Usage

```bash
vtbg attach <ws-url>                     # start daemon, hold the WS open
vtbg status                              # daemon pid, ws url, paused?, BPs

# Breakpoints (URL matched via regex, line is 1-based)
vtbg bp 'App\.tsx' 205                   # → bp id=2:204:0:App\.tsx  resolved at scriptId=20 line=206 col=28
vtbg bps                                 # list active BPs
vtbg bp-clear <bpId>

# Pause / step / inspect
vtbg paused [timeoutSec=30]              # block until pause; prints stack + ALL top-frame locals
vtbg stack                               # current call stack
vtbg vars                                # top-frame locals
vtbg step                                # step over, auto-prints new pause state
vtbg step-into
vtbg step-out
vtbg resume

# Evaluate (auto-routes: evaluateOnCallFrame if paused, Runtime.evaluate otherwise)
vtbg eval 'JSON.stringify(await window.electronAPI.main.getStartupVaultHint())'
#   ^ top-level `await` is auto-wrapped

# Page control
vtbg reload                              # Page.reload({ignoreCache:true})
vtbg navigate http://localhost:3001/

# Done
vtbg detach
```

### Trigger pattern for renderer-side BPs

Renderer breakpoints fire when the breakpointed code actually executes. For the
auto-open-on-startup investigation, the cleanest path was to install an
**instrumented function** via `eval`, then trigger it deterministically rather
than racing React's mount cycle:

```bash
# 1. Install
vtbg eval $'(function(){window.__demo = async function(label){\n  const hint = await window.electronAPI.main.getStartupVaultHint();\n  const kind = hint.kind;\n  return {label, kind};\n}; return "installed";})()\n//# sourceURL=demo.js'

# 2. BP inside it
vtbg bp 'demo\.js' 3

# 3. Trigger (fire-and-forget; result captured to a global)
vtbg eval 'void window.__demo("from-vtbg").then(r => window.__r = r)' &

# 4. Wait for pause and inspect
vtbg paused 5
vtbg step
vtbg step
vtbg resume
vtbg eval 'JSON.stringify(window.__r)'
```

The `//# sourceURL=demo.js` pragma is what lets `vtbg bp 'demo\.js'` find the
script — without it CDP names anonymous evals `VM<id>`.

## What `vtbg` does NOT do (yet)

- **Main-process Node inspector**. Electron's `electron:debug` script doesn't
  pass `--inspect-brk` to Node, so the main-process V8 inspector isn't open.
  Wiring it up needs `NODE_OPTIONS='--inspect-brk=9230'` on the launch, plus a
  small change in `vtbg` to handle Node-target WS URLs (slightly different
  shape from page targets). Adding this is a follow-up.
- **Source-map line snap-back**. `Debugger.setBreakpointByUrl` lands on the
  nearest break-able statement, which can be off by one from where you asked.
  The output shows the resolved location — adjust your line input if needed.
- **Multi-target multiplexing**. One CDP target per daemon.

## Internals

Single Node script. Two roles:

- `vtbg attach <ws>` → forks itself with `daemon-internal <ws>`, detaches.
  The daemon holds the CDP WebSocket, listens on `$TMPDIR/vtbg.sock`, tracks
  `currentPause`, `breakpoints`, and a small set of pending CDP responses.
- All other subcommands open the socket, send one JSON RPC, get one response,
  exit.

Two non-obvious correctness requirements baked into the daemon:

- `net.createServer({allowHalfOpen: true})` — without this, when the client
  sends FIN, the server's write side auto-closes and the response never lands.
- `pauseQueue` (events received while no waiter) is drained whenever
  `currentPause` is consumed or stepping starts — otherwise stale `objectId`s
  from an already-resumed pause survive into the next step and CDP returns
  `Could not find object with given id`.

State files: `$TMPDIR/vtbg.sock` (UDS), `$TMPDIR/vtbg.log` (daemon stderr).

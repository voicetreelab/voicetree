# Agent debugging reference

## Profiler output

`vtbg profile-stop` prints a self-time-ranked list:

```text
profile: 2029 nodes, 67272 samples, v8-elapsed=87957ms (wall=87933ms)
--- top by self time ---
   62392.9ms ( 70.9%)  (idle)                               :0
    4355.8ms (  5.0%)  safeReadJsonlLines                   file:///.../dist-electron/main/index.js:14999
    2708.2ms (  3.1%)  readdir                              :0
    ...
```

## Recovery-poll case study

A profile of the main process during agent spawn showed
`safeReadJsonlLines + readdir + stat + readFileSync = ~22% of CPU` over 88s.
`grep safeReadJsonlLines packages/` pointed at
`packages/systems/agent-runtime/src/application/recovery/resolvers/resolveClaudeNativeSession.ts:92`.
Tracing callers back: `recovery-session-sync.ts:5` polls every 10s, so the
resolver scanned the entire `~/.claude/projects/` tree (~1 GB, thousands of
`.jsonl` files) synchronously on the main thread.

The fix landed as lazy resolution at resume-click time only. The profiler stack
was the whole investigation: no instrumentation, no print debugging, no
guesswork.

## Current limitations

- **Source-map line snap-back**. `Debugger.setBreakpointByUrl` lands on the
  nearest break-able statement, which can be off by one from where you asked.
  The output shows the resolved location, so adjust your line input if needed.
- **Multi-target multiplexing**. One CDP target per daemon. To swap between
  main and renderer, `vtbg detach` then re-attach.

## Internals

Single Node script. Two roles:

- `vtbg attach <ws>` forks itself with `daemon-internal <ws>`, detaches, and
  keeps the CDP WebSocket open. The daemon listens on `$TMPDIR/vtbg.sock` and
  tracks `currentPause`, `breakpoints`, and pending CDP responses.
- All other subcommands open the socket, send one JSON RPC, get one response,
  then exit.

Two non-obvious correctness requirements are baked into the daemon:

- `net.createServer({allowHalfOpen: true})`: without this, when the client sends
  FIN, the server's write side auto-closes and the response never lands.
- `pauseQueue` drains whenever `currentPause` is consumed or stepping starts.
  Otherwise stale `objectId`s from an already-resumed pause can survive into the
  next step and CDP returns `Could not find object with given id`.

State files: `$TMPDIR/vtbg.sock` (UDS), `$TMPDIR/vtbg.log` (daemon stderr).

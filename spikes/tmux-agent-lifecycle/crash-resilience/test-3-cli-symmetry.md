# BF-314 Test 3: CLI symmetry

Verdict: PASS

Date: 2026-05-15

Method:
- Created real tmux session `bf314-cli-1778838801297` with `bash --noprofile --norc`.
- Mounted production `mountTmuxAttachRelay` in-process on a local HTTP server.
- Connected relay WebSocket client to `/terminals/{name}/attach`.
- Opened a second plain CLI attachment with `node-pty` spawning `tmux attach -t bf314-cli-1778838801297`.
- Sent `echo BF314_CLI_HELLO` from the CLI attach and observed it through the relay client.
- Sent `echo BF314_XTERM_HELLO` through the relay client and observed it through the CLI attach.
- Cleaned up the tmux session at the end.

Observed output:

```json
{
  "verdict": "PASS",
  "session": "bf314-cli-1778838801297",
  "port": 57995,
  "cliToRelay": true,
  "relayToCli": true
}
```

Notes:
- This validates that a plain tmux CLI attach and the xterm-side relay attach share the same live session in both directions.


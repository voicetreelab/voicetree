# BF-314 Test 1: kill relay mid operation

Verdict: PASS

Date: 2026-05-15

Method:
- Created real tmux session `bf314-relay-1778838782088` with `bash --noprofile --norc`.
- Started a separate Node process mounting the production `mountTmuxAttachRelay` WebSocket endpoint.
- Connected a WebSocket attach client, sent `echo BF314_RELAY_BEFORE`, and observed the sentinel through relay output.
- Sent `SIGKILL` to the relay process.
- Verified `tmux has-session -t bf314-relay-1778838782088` stayed alive.
- Restarted relay on the same port and reconnected to the same session.
- Sent `echo BF314_RELAY_AFTER` through the reconnected client and observed the sentinel.
- Cleaned up the tmux session at the end.

Observed output:

```json
{
  "verdict": "PASS",
  "session": "bf314-relay-1778838782088",
  "port": 57971,
  "reconnectMs": 158,
  "survived": true
}
```

Notes:
- This exercised the production relay module in a killable child process.
- The reconnect loop used the same 200 ms initial cadence as the BF-313 client policy and completed under the 5 s gate.


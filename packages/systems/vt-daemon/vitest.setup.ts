// Test-runtime tmux server lifecycle (fixes the agent-runtime tmux resource leak).
//
// Integration tests in this package spin up a REAL tmux server under this worker's
// ephemeral home (…/voicetree-agent-runtime-tmux-<pid>). tmux daemonizes its
// server, so it is detached from the worker and would otherwise survive forever as
// a `while :; do sleep …` keep-alive — the leak that accumulated 100+ orphaned
// servers on long-lived dev boxes.
//
// We bind the lifecycle here at the test shell (deliberately kept out of the
// production server module, which manages a single stable ~/.voicetree server):
//
//   1. Backstop reaper, once per worker at startup — kill servers (and remove
//      home dirs) leaked by previous workers SIGKILLed before their afterAll ran.
//   2. Deterministic teardown — fully remove THIS worker's ephemeral server and
//      home dir on normal completion of the file's suites.
import {afterAll} from 'vitest'
import {reapStaleEphemeralTmuxServers, teardownEphemeralTmuxServerForThisProcess} from './src/agent-runtime/terminals/tmux/tmux-server.ts'

await reapStaleEphemeralTmuxServers()

afterAll(async (): Promise<void> => {
    await teardownEphemeralTmuxServerForThisProcess()
})

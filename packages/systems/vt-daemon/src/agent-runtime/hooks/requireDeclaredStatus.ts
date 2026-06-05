/**
 * Finish gate: require an agent to have declared a *terminal* status before it
 * is allowed to quietly sit idle.
 *
 * PR #243 made agent status opt-in and removed the per-turn stop hook, so an
 * agent that simply stops emitting output drifts `active → idle` and sits amber
 * forever — never reaching green `completed`. This gate restores a finish-time
 * signal: when an agent goes sustained-idle without having declared a terminal
 * status this turn, the idle stop-gate audit nudges it to declare one (`vt agent
 * status done|failed|awaiting_input`, or `agentStatus` on its final node).
 *
 * Pure over the record's `lastReportedStatus` (set by `applyAgentStatus`, reset
 * to `null` when the terminal re-enters `active`). `lastReportedStatus` — not
 * `lifecycle` — because the orchestrator downgrade renders a declared
 * `done`/`awaiting_input` as `idle`, so `lifecycle` alone cannot tell a
 * deliberate close-out from a silent stop.
 *
 * `working` counts as undeclared at finish: an agent idle after reporting
 * `working` has stopped mid-declared-work — exactly the ambiguous state to
 * resolve into done/failed/awaiting.
 */

import type {AgentStatus, TerminalRecord} from '@vt/vt-daemon-protocol'
import type {StopHookResult} from './stopGateHookRunner.ts'

const TERMINAL_DECLARED_STATUSES: ReadonlySet<AgentStatus> = new Set<AgentStatus>([
    'done',
    'failed',
    'awaiting_input',
])

const NUDGE_MESSAGE: string =
    'You have stopped but not declared your status. Run `vt agent status done` '
    + '(or `failed` / `awaiting_input`) to close yourself out — or include '
    + '`agentStatus` on your final progress node.'

export function requireDeclaredStatus(record: TerminalRecord): StopHookResult {
    const declared: AgentStatus | null = record.terminalData.lastReportedStatus
    if (declared !== null && TERMINAL_DECLARED_STATUSES.has(declared)) {
        return {passed: true}
    }
    return {passed: false, message: NUDGE_MESSAGE}
}

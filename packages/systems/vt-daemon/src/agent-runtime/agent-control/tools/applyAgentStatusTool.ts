/**
 * `apply_agent_status` tool — the standalone path for an agent to declare its
 * own lifecycle status WITHOUT creating a progress node.
 *
 * `create_graph`'s `agentStatus` couples status to node creation; this tool is
 * the no-node equivalent, for when an agent simply wants to close itself out
 * (`done`/`failed`), flag that it is blocked (`awaiting_input`), or mark itself
 * back to work (`working`). Both terminate at the same `applyAgentStatus` sink,
 * so the reducer, SSE patch, and sidebar are unchanged downstream.
 *
 * It always acts on the CALLER's own terminal — an agent declares its own
 * status, never another's.
 */

import type {AgentStatus} from '@vt/vt-daemon-protocol'
import {type ToolResponse, buildJsonResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'
import {terminalExists} from '../agentControlRuntime.ts'
import {applyAgentStatus} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry'

export interface ApplyAgentStatusParams {
    readonly preset: AgentStatus
    readonly statusPhrase?: string
    readonly callerTerminalId: string
}

export function applyAgentStatusTool({
    preset,
    statusPhrase,
    callerTerminalId,
}: ApplyAgentStatusParams): ToolResponse {
    if (!terminalExists(callerTerminalId)) {
        return buildJsonResponse({success: false, error: `Unknown caller terminal: ${callerTerminalId}`})
    }

    applyAgentStatus(callerTerminalId, {preset, phrase: statusPhrase})

    return buildJsonResponse({
        success: true,
        terminalId: callerTerminalId,
        message: `Status set to "${preset}"${statusPhrase ? ` — ${statusPhrase}` : ''}`,
    })
}

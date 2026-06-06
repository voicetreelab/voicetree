// Black-box test for waitForAgentsTool's caller-validation branch.
//
// In a fresh test process the terminal registry is empty, so any
// callerTerminalId is unknown. We call the tool with an unknown caller and
// assert the observable output: the JSON error payload returned over the wire.
// The wording must match the family standard ("Unknown caller terminal: <id>")
// shared by spawnAgentTool / sendMessageTool / createGraphTool /
// readTerminalOutputTool / getUnseenNodesNearbyTool.
//
// No internal mocks: the caller-validation branch returns before the GraphBridge
// is touched, so we pass an unused bridge stub. Per CLAUDE.md we assert on the
// observable result, not on whether any internal function was called.

import {describe, expect, it} from 'vitest'

import type {GraphBridge} from '@vt/vt-daemon/config/toolBridges.ts'
import {waitForAgentsTool} from './waitForAgentsTool.ts'

// The bridge is never reached on the unknown-caller path; a stub documents that.
const unusedBridge: GraphBridge = {} as unknown as GraphBridge

function parsePayload(response: {content: Array<{text: string}>}): unknown {
    return JSON.parse(response.content[0]?.text ?? 'null')
}

describe('waitForAgentsTool — caller validation', () => {
    it('unknown caller terminal: returns an error payload with the family-standard wording', () => {
        const response = waitForAgentsTool(
            {terminalIds: ['target-1'], callerTerminalId: 'caller-does-not-exist'},
            unusedBridge,
        )

        expect(response.isError).toBe(true)
        const payload = parsePayload(response) as {success: boolean; error: string}
        expect(payload.success).toBe(false)
        expect(payload.error).toBe('Unknown caller terminal: caller-does-not-exist')
    })
})

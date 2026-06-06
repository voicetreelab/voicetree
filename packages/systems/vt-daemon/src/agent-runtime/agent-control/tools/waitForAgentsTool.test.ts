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

import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import type {GraphBridge} from '@vt/vt-daemon/config/toolBridges.ts'
import {cancelMonitor} from '../agent-completion-monitor.ts'
import {
    clearTerminalRecords,
    recordTerminalSpawn,
} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry'
import {createTerminalData} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts'
import {waitForAgentsTool} from './waitForAgentsTool.ts'

// The bridge is never reached on the unknown-caller path; a stub documents that.
const unusedBridge: GraphBridge = {} as unknown as GraphBridge
const STOP_INSTRUCTION =
    'Do not poll, inspect output, or take further action on these agents; end your turn now and wait for the automatic completion notification that will be sent back to you.'

function parsePayload(response: {content: Array<{text: string}>}): unknown {
    return JSON.parse(response.content[0]?.text ?? 'null')
}

function spawnTerminal(terminalId: string): void {
    recordTerminalSpawn(terminalId, createTerminalData({
        terminalId,
        attachedToNodeId: `/tmp/${terminalId}.md`,
        terminalCount: 1,
        title: terminalId,
        agentName: terminalId,
        parentTerminalId: null,
    }))
}

describe('waitForAgentsTool', () => {
    beforeEach(() => {
        clearTerminalRecords()
    })

    afterEach(() => {
        clearTerminalRecords()
    })

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

    it('monitoring response instructs the caller to end the turn and wait for notification', () => {
        spawnTerminal('caller')
        spawnTerminal('target')

        const response = waitForAgentsTool(
            {terminalIds: ['target'], callerTerminalId: 'caller', pollIntervalMs: 1_000_000},
            unusedBridge,
        )

        const payload = parsePayload(response) as {status: string; message: string; monitorId: string}
        cancelMonitor(payload.monitorId)
        expect(payload.status).toBe('monitoring')
        expect(payload.message).toContain(STOP_INSTRUCTION)
        expect(payload.message).not.toContain('You are free to continue other work now')
        expect(payload.message.endsWith(STOP_INSTRUCTION)).toBe(true)
    })

    it('already-waiting response repeats the same stop-and-wait instruction', () => {
        spawnTerminal('caller')
        spawnTerminal('target')

        const firstResponse = waitForAgentsTool(
            {terminalIds: ['target'], callerTerminalId: 'caller', pollIntervalMs: 1_000_000},
            unusedBridge,
        )
        const firstPayload = parsePayload(firstResponse) as {monitorId: string}

        const secondResponse = waitForAgentsTool(
            {terminalIds: ['target'], callerTerminalId: 'caller', pollIntervalMs: 1_000_000},
            unusedBridge,
        )

        cancelMonitor(firstPayload.monitorId)
        const secondPayload = parsePayload(secondResponse) as {status: string; message: string}
        expect(secondPayload.status).toBe('already_waiting')
        expect(secondPayload.message).toContain(STOP_INSTRUCTION)
    })
})

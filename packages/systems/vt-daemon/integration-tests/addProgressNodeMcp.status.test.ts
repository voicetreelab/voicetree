/**
 * Real-deps integration test for the agent-authored status reported alongside a
 * create_graph call (`agentStatus` preset + `statusPhrase`).
 *
 * Drives the daemon-side `createGraphTool` against the real agent-runtime
 * registry (the caller terminal is recorded by `setupRealDeps`), then reads the
 * caller's `TerminalRecord` back to assert that the create propagated the status
 * to the terminal's lifecycle + live status phrase. This is the path that
 * replaced the deleted CLI-hook status adapter.
 */

import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {createGraphTool} from '@vt/vt-daemon/create-graph/createGraphTool.ts'
import type {GraphBridge} from '@vt/vt-daemon/config/mcpBridges.ts'
import {getTerminalRecords} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry'
import {MAX_STATUS_PHRASE_LENGTH, type AgentStatus, type TerminalLifecycle} from '@vt/vt-daemon-protocol'
import {
    CALLER_TERMINAL_ID,
    cleanupVoicetreeHome,
    parsePayload,
    setupRealDeps,
    type BridgeState,
    type McpToolResponse,
    type SuccessPayload,
} from './__helpers__/addProgressNodeMcp.testHelpers'

let voicetreeHome: string
let state: BridgeState
let bridge: GraphBridge

beforeEach(async () => {
    ({voicetreeHome, state, bridge} = await setupRealDeps())
})

afterEach(async () => {
    await cleanupVoicetreeHome(voicetreeHome)
})

function caller() {
    return getTerminalRecords().find(r => r.terminalId === CALLER_TERMINAL_ID)
}

async function createWithStatus(over: {agentStatus?: AgentStatus; statusPhrase?: string}): Promise<SuccessPayload> {
    const response: McpToolResponse = await createGraphTool({
        callerTerminalId: CALLER_TERMINAL_ID,
        nodes: [{filename: 'progress', title: 'Progress', summary: 'Did some work.'}],
        ...over,
    }, bridge)
    return parsePayload(response) as SuccessPayload
}

describe('create_graph — agent-authored status preset → caller lifecycle', () => {
    const cases: ReadonlyArray<readonly [AgentStatus, TerminalLifecycle]> = [
        ['working', 'active'],
        ['awaiting_input', 'awaiting_input'],
        ['done', 'completed'],
        ['failed', 'errored'],
    ]

    for (const [preset, expectedLifecycle] of cases) {
        it(`agentStatus "${preset}" → lifecycle "${expectedLifecycle}"`, async () => {
            const payload = await createWithStatus({agentStatus: preset})
            expect(payload.success).toBe(true)
            expect(caller()?.terminalData.lifecycle).toBe(expectedLifecycle)
        })
    }

    it('omitting agentStatus leaves the caller lifecycle untouched (stays "spawning")', async () => {
        const payload = await createWithStatus({})
        expect(payload.success).toBe(true)
        expect(caller()?.terminalData.lifecycle).toBe('spawning')
    })
})

describe('create_graph — free-text status phrase', () => {
    it('stores the phrase on the caller record', async () => {
        await createWithStatus({agentStatus: 'working', statusPhrase: 'refactoring the spawn pipeline'})
        expect(caller()?.terminalData.statusPhrase).toBe('refactoring the spawn pipeline')
        expect(caller()?.terminalData.lifecycle).toBe('active')
    })

    it('truncates an over-long phrase to MAX_STATUS_PHRASE_LENGTH', async () => {
        await createWithStatus({statusPhrase: 'y'.repeat(MAX_STATUS_PHRASE_LENGTH + 25)})
        expect(caller()?.terminalData.statusPhrase).toHaveLength(MAX_STATUS_PHRASE_LENGTH)
    })

    it('phrase without a preset does not change lifecycle', async () => {
        await createWithStatus({statusPhrase: 'still going'})
        expect(caller()?.terminalData.statusPhrase).toBe('still going')
        expect(caller()?.terminalData.lifecycle).toBe('spawning')
    })

    it('default record has an empty status phrase before any report', async () => {
        await createWithStatus({})
        expect(caller()?.terminalData.statusPhrase).toBe('')
    })
})

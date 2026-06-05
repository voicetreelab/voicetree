/**
 * Black-box tests for the finish gate. Builds a TerminalRecord with a given
 * lastReportedStatus and asserts on the returned verdict.
 */
import {describe, it, expect} from 'vitest'
import type {AgentStatus, TerminalId, TerminalRecord} from '@vt/vt-daemon-protocol'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'
import {createTerminalData} from '../terminals/terminal-registry/types'
import {requireDeclaredStatus} from './requireDeclaredStatus'

function recordWith(lastReportedStatus: AgentStatus | null): TerminalRecord {
    const terminalData = createTerminalData({
        terminalId: 't1' as TerminalId,
        attachedToNodeId: '/tmp/ctx.md' as NodeIdAndFilePath,
        terminalCount: 1,
        title: 'test',
        agentName: 'TestAgent',
    })
    return {
        terminalId: 't1',
        terminalData: {...terminalData, lastReportedStatus},
        status: 'running',
        exitCode: null,
        exitSignal: null,
        killReason: null,
        auditRetryCount: 0,
        spawnedAt: 0,
    }
}

describe('requireDeclaredStatus', () => {
    it.each<AgentStatus>(['done', 'failed', 'awaiting_input'])(
        'passes when the agent declared a terminal status (%s)',
        (status) => {
            expect(requireDeclaredStatus(recordWith(status)).passed).toBe(true)
        },
    )

    it('fails when the agent never declared a status (null)', () => {
        const result = requireDeclaredStatus(recordWith(null))
        expect(result.passed).toBe(false)
        expect(result.message).toContain('vt agent status')
    })

    it('fails when the last declared status is "working" (stopped mid-work)', () => {
        const result = requireDeclaredStatus(recordWith('working'))
        expect(result.passed).toBe(false)
        expect(result.message).toContain('vt agent status')
    })
})

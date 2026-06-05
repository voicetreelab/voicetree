/**
 * Black-box tests for the `apply_agent_status` tool (the `vt agent status` verb
 * sink). Asserts on the observable registry state the tool mutates, not on
 * internal calls.
 */
import {describe, it, expect, beforeEach} from 'vitest'
import {createTerminalData} from '../../terminals/terminal-registry/types'
import type {TerminalId} from '../../terminals/terminal-registry/types'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'
import {
    recordTerminalSpawn,
    getTerminalRecords,
    clearTerminalRecords,
} from '../../terminals/terminal-registry'
import {applyAgentStatusTool} from './applyAgentStatusTool'

function spawn(id: string, parentId: string | null = null): void {
    recordTerminalSpawn(id, createTerminalData({
        terminalId: id as TerminalId,
        attachedToNodeId: '/tmp/ctx.md' as NodeIdAndFilePath,
        terminalCount: 1,
        title: 'test',
        agentName: 'TestAgent',
        parentTerminalId: parentId as TerminalId | null,
    }))
}

function recordOf(id: string) {
    return getTerminalRecords().find(r => r.terminalId === id)
}

describe('applyAgentStatusTool', () => {
    beforeEach(() => clearTerminalRecords())

    it('maps each preset to the caller\'s lifecycle', () => {
        spawn('t1')
        applyAgentStatusTool({preset: 'working', callerTerminalId: 't1'})
        expect(recordOf('t1')?.terminalData.lifecycle).toBe('active')

        applyAgentStatusTool({preset: 'awaiting_input', callerTerminalId: 't1'})
        expect(recordOf('t1')?.terminalData.lifecycle).toBe('awaiting_input')

        applyAgentStatusTool({preset: 'done', callerTerminalId: 't1'})
        expect(recordOf('t1')?.terminalData.lifecycle).toBe('completed')
    })

    it('records lastReportedStatus on the caller', () => {
        spawn('t1')
        applyAgentStatusTool({preset: 'done', callerTerminalId: 't1'})
        expect(recordOf('t1')?.terminalData.lastReportedStatus).toBe('done')
    })

    it('stores the optional status phrase', () => {
        spawn('t1')
        applyAgentStatusTool({preset: 'working', statusPhrase: 'running the e2e suite', callerTerminalId: 't1'})
        expect(recordOf('t1')?.terminalData.statusPhrase).toBe('running the e2e suite')
    })

    it('records done on an orchestrator even though lifecycle shows idle', () => {
        spawn('parent-1')
        spawn('child-1', 'parent-1')
        applyAgentStatusTool({preset: 'done', callerTerminalId: 'parent-1'})
        expect(recordOf('parent-1')?.terminalData.lifecycle).toBe('idle')
        expect(recordOf('parent-1')?.terminalData.lastReportedStatus).toBe('done')
    })

    it('returns an error for an unknown caller terminal', () => {
        const res = applyAgentStatusTool({preset: 'done', callerTerminalId: 'ghost'})
        const parsed = JSON.parse((res.content[0] as {type: 'text'; text: string}).text)
        expect(parsed.success).toBe(false)
        expect(parsed.error).toContain('Unknown caller terminal')
    })
})

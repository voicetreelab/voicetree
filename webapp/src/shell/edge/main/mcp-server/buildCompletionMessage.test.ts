import {describe, it, expect} from 'vitest'
import {buildCompletionMessage, type AgentResult} from './buildCompletionMessage'

describe('buildCompletionMessage', () => {
    it('prefixes with [WaitForAgents]', () => {
        const result: string = buildCompletionMessage([])
        expect(result).toMatch(/^\[WaitForAgents\]/)
    })

    it('lists agents with status and node titles', () => {
        const agents: AgentResult[] = [
            {
                terminalId: 't1',
                agentName: 'Alice',
                status: 'exited',
                exitCode: 0,
                nodes: [
                    {nodeId: 'n1', title: 'Design doc'},
                    {nodeId: 'n2', title: 'Implementation'},
                ],
            },
            {
                terminalId: 't2',
                agentName: 'Bob',
                status: 'idle',
                exitCode: null,
                nodes: [{nodeId: 'n3', title: 'Progress update'}],
            },
        ]
        const msg: string = buildCompletionMessage(agents)
        expect(msg).toContain('[WaitForAgents] All agents completed.')
        expect(msg).toContain('- Alice [exited:0]: Design doc, Implementation')
        expect(msg).toContain('- Bob [idle]: Progress update')
    })

    it('falls back to terminalId when agentName is undefined', () => {
        const agents: AgentResult[] = [
            {
                terminalId: 'term-42',
                agentName: undefined,
                status: 'exited',
                exitCode: null,
                nodes: [],
            },
        ]
        const msg: string = buildCompletionMessage(agents)
        expect(msg).toContain('- term-42 [exited]: (no nodes created)')
    })

    it('shows "(no nodes created)" for agents without nodes', () => {
        const agents: AgentResult[] = [
            {
                terminalId: 't1',
                agentName: 'Carol',
                status: 'exited',
                exitCode: 0,
                nodes: [],
            },
        ]
        const msg: string = buildCompletionMessage(agents)
        expect(msg).toContain('- Carol [exited:0]: (no nodes created)')
    })

    it('shows exit code for non-zero exits (crash detection)', () => {
        const agents: AgentResult[] = [
            {
                terminalId: 't1',
                agentName: 'Dave',
                status: 'exited',
                exitCode: 1,
                nodes: [],
            },
        ]
        const msg: string = buildCompletionMessage(agents)
        expect(msg).toContain('- Dave [exited:1]: (no nodes created)')
    })

    it('includes tip about closing agents', () => {
        const msg: string = buildCompletionMessage([])
        expect(msg).toContain('close_agent')
        expect(msg).toContain('human review')
    })
})

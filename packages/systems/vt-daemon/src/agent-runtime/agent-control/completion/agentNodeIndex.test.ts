import {describe, it, expect, beforeEach} from 'vitest'
import {registerAgentNodes, getAgentNodes, clearAgentNodes, type AgentNodeEntry} from './agentNodeIndex'

describe('agentNodeIndex', () => {
    beforeEach(() => {
        clearAgentNodes()
    })

    it('returns empty array for unknown agent', () => {
        expect(getAgentNodes('unknown-agent-xyz')).toEqual([])
    })

    it('registers and retrieves nodes for an agent', () => {
        registerAgentNodes('test-agent-1', [
            {nodeId: '/project/node-a.md', title: 'Node A'},
            {nodeId: '/project/node-b.md', title: 'Node B'},
        ])
        const nodes: readonly AgentNodeEntry[] = getAgentNodes('test-agent-1')
        expect(nodes).toEqual([
            {nodeId: '/project/node-a.md', title: 'Node A'},
            {nodeId: '/project/node-b.md', title: 'Node B'},
        ])
    })

    it('accumulates nodes across multiple create_graph calls', () => {
        registerAgentNodes('test-agent-2', [{nodeId: '/project/first.md', title: 'First'}])
        registerAgentNodes('test-agent-2', [{nodeId: '/project/second.md', title: 'Second'}])
        const nodes: readonly AgentNodeEntry[] = getAgentNodes('test-agent-2')
        expect(nodes).toHaveLength(2)
        expect(nodes[0].title).toBe('First')
        expect(nodes[1].title).toBe('Second')
    })

    it('keeps agents isolated from each other', () => {
        registerAgentNodes('agent-iso-a', [{nodeId: '/project/a.md', title: 'A'}])
        registerAgentNodes('agent-iso-b', [{nodeId: '/project/b.md', title: 'B'}])
        expect(getAgentNodes('agent-iso-a')).toHaveLength(1)
        expect(getAgentNodes('agent-iso-a')[0].title).toBe('A')
        expect(getAgentNodes('agent-iso-b')[0].title).toBe('B')
    })
})

import {describe, it, expect} from 'vitest'
import {registerAgentNodes, getAgentNodes, type AgentNodeEntry} from './agentNodeIndex'

describe('agentNodeIndex', () => {
    it('returns empty array for unknown agent', () => {
        expect(getAgentNodes('unknown-agent-xyz')).toEqual([])
    })

    it('registers and retrieves nodes for an agent', () => {
        registerAgentNodes('test-agent-1', [
            {nodeId: '/vault/node-a.md', title: 'Node A'},
            {nodeId: '/vault/node-b.md', title: 'Node B'},
        ])
        const nodes: readonly AgentNodeEntry[] = getAgentNodes('test-agent-1')
        expect(nodes).toEqual([
            {nodeId: '/vault/node-a.md', title: 'Node A'},
            {nodeId: '/vault/node-b.md', title: 'Node B'},
        ])
    })

    it('accumulates nodes across multiple create_graph calls', () => {
        registerAgentNodes('test-agent-2', [{nodeId: '/vault/first.md', title: 'First'}])
        registerAgentNodes('test-agent-2', [{nodeId: '/vault/second.md', title: 'Second'}])
        const nodes: readonly AgentNodeEntry[] = getAgentNodes('test-agent-2')
        expect(nodes).toHaveLength(2)
        expect(nodes[0].title).toBe('First')
        expect(nodes[1].title).toBe('Second')
    })

    it('keeps agents isolated from each other', () => {
        registerAgentNodes('agent-iso-a', [{nodeId: '/vault/a.md', title: 'A'}])
        registerAgentNodes('agent-iso-b', [{nodeId: '/vault/b.md', title: 'B'}])
        expect(getAgentNodes('agent-iso-a')).toHaveLength(1)
        expect(getAgentNodes('agent-iso-a')[0].title).toBe('A')
        expect(getAgentNodes('agent-iso-b')[0].title).toBe('B')
    })
})

import {describe, expect, it} from 'vitest'
import {executeScript, type ExecutorEnv} from './executor.js'
import type {McpClient} from './mcp-client.js'
import type {AgentStatus, FakeAgentScript} from './types.js'

type CreateGraphCall = {
    nodes: ReadonlyArray<{filename: string; title: string; summary: string}>
    outputPath?: string
    status?: {agentStatus?: AgentStatus; statusPhrase?: string}
}

function captureClient(): {client: McpClient; calls: CreateGraphCall[]} {
    const calls: CreateGraphCall[] = []
    const client: McpClient = {
        async createGraph(_id, nodes, outputPath, status) {
            calls.push({nodes, outputPath, status})
            return {}
        },
        async spawnAgent() { return {terminalId: 'child'} },
        async waitForAgents() { return {status: 'ok'} },
        async sendMessage() { return {} },
        async listAgents() { return [] },
        async closeAgent() { return {} },
        async disconnect() { /* no-op */ },
    }
    return {client, calls}
}

const env: ExecutorEnv = {terminalId: 't1', taskNodePath: '/task.md'}

async function run(script: FakeAgentScript, client: McpClient): Promise<void> {
    await executeScript(script, client, env, new AbortController())
}

const NODE = {title: 'Progress', summary: 'did a thing'} as const

describe('fake-agent executor — agent status on create_nodes', () => {
    const presets: readonly AgentStatus[] = ['working', 'awaiting_input', 'done', 'failed']

    for (const preset of presets) {
        it(`forwards status preset "${preset}" to create_graph`, async () => {
            const {client, calls} = captureClient()
            await run({actions: [{type: 'create_nodes', nodes: [NODE], status: preset}]}, client)
            expect(calls).toHaveLength(1)
            expect(calls[0].status?.agentStatus).toBe(preset)
        })
    }

    it('forwards the free-text status phrase to create_graph', async () => {
        const {client, calls} = captureClient()
        await run({actions: [{
            type: 'create_nodes', nodes: [NODE], status: 'working', statusPhrase: 'wiring it up',
        }]}, client)
        expect(calls[0].status?.agentStatus).toBe('working')
        expect(calls[0].status?.statusPhrase).toBe('wiring it up')
    })

    it('omits status when the action carries none (backward-compatible create)', async () => {
        const {client, calls} = captureClient()
        await run({actions: [{type: 'create_nodes', nodes: [NODE]}]}, client)
        expect(calls).toHaveLength(1)
        expect(calls[0].status?.agentStatus).toBeUndefined()
        expect(calls[0].status?.statusPhrase).toBeUndefined()
    })
})

describe('fake-agent executor — inactivity + state changes', () => {
    it('honors a delay between status reports (simulated inactivity)', async () => {
        // The `delay` action is how a scripted fake agent goes quiet — a real
        // run passes a large ms (e.g. 5 min) so the daemon's idle timer fires.
        const {client, calls} = captureClient()
        await run({actions: [
            {type: 'create_nodes', nodes: [NODE], status: 'working', statusPhrase: 'starting'},
            {type: 'delay', ms: 5},
            {type: 'create_nodes', nodes: [NODE], status: 'awaiting_input', statusPhrase: 'need input'},
        ]}, client)
        expect(calls.map(c => c.status?.agentStatus)).toEqual(['working', 'awaiting_input'])
        expect(calls.map(c => c.status?.statusPhrase)).toEqual(['starting', 'need input'])
    })

    it('an aborted delay returns promptly without blocking subsequent runs', async () => {
        const {client} = captureClient()
        const controller = new AbortController()
        controller.abort()
        // Pre-aborted: the executor must not hang on the delay.
        await executeScript({actions: [{type: 'delay', ms: 300_000}]}, client, env, controller)
        expect(true).toBe(true)
    })
})

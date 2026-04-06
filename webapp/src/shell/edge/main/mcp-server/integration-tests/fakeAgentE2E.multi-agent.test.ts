/**
 * E2E: vt-fake-agent CLI — multi-agent orchestration scenarios.
 * Tests parent-child spawn, fan-out, progress-node gate across agents,
 * and recursive wait depth (A→B→C transitive completion).
 */

import {describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll} from 'vitest'
import {execSync} from 'child_process'
import type {Server} from 'http'

const sendTextState: {callerTerminalId: string; messages: Array<{terminalId: string; text: string}>} = vi.hoisted(() => ({
    callerTerminalId: 'test-caller',
    messages: [] as Array<{terminalId: string; text: string}>,
}))

// ─── Mock leaf UI/Electron dependencies (hoisted before real imports) ────────

vi.mock('@/shell/edge/main/state/graph-store', () => ({
    getGraph: vi.fn(() => ({
        nodes: {}, incomingEdgesIndex: new Map(), nodeByBaseName: new Map(), unresolvedLinksIndex: new Map()
    })),
    setGraph: vi.fn()
}))

vi.mock('@/shell/edge/main/terminals/send-text-to-terminal', async (importOriginal) => {
    const actual: typeof import('@/shell/edge/main/terminals/send-text-to-terminal') = await importOriginal<typeof import('@/shell/edge/main/terminals/send-text-to-terminal')>()
    return {
        ...actual,
        sendTextToTerminal: vi.fn(async (terminalId: string, text: string) => {
            if (terminalId === sendTextState.callerTerminalId) {
                sendTextState.messages.push({terminalId, text})
                return {success: true}
            }
            return actual.sendTextToTerminal(terminalId, text)
        })
    }
})

vi.mock('@/shell/edge/main/ui-api-proxy', () => ({uiAPI: {syncTerminals: vi.fn()}}))
vi.mock('@/shell/edge/main/settings/settings_IO', () => ({
    loadSettings: vi.fn().mockResolvedValue({autoNotifyUnseenNodes: false, agents: []})
}))
vi.mock('@/shell/edge/main/graph/context-nodes/getUnseenNodesAroundContextNode', () => ({
    getUnseenNodesAroundContextNode: vi.fn().mockResolvedValue([])
}))
vi.mock('@/shell/edge/main/terminals/stopGateHookRunner', () => ({
    runStopHooks: vi.fn().mockResolvedValue({passed: true})
}))

// ─── Imports ────────────────────────────────────────────────────────────────

import {startMonitor, cancelMonitor} from '@/shell/edge/main/mcp-server/agent-completion-monitor'
import {sendTextToTerminal} from '@/shell/edge/main/terminals/send-text-to-terminal'

import {
    FAKE_AGENT_DIR, CALLER_TERMINAL_ID, SUSTAINED_IDLE_MS,
    findAvailablePort, getTerminalManager, getTerminalRecords, getAgentNodes,
    clearAgentNodes, clearTerminalRecords,
    createActivityHarness, spawnInteractiveFakeAgent,
    waitForCondition, waitForIdle, waitForTerminalExit, wait,
    startStubMcpServer, stubCtx, type ActivityHarness,
} from './fakeAgentE2E.helpers'

// ─── Test-specific helpers (depend on sendTextState mock) ──────────────────

function getCompletionMessages(): string[] {
    return sendTextState.messages
        .map(({text}) => text)
        .filter((text: string) => text.includes('[WaitForAgents] Agent(s) completed.'))
}

async function waitForCompletionMessage(timeoutMs: number): Promise<string> {
    await waitForCondition(
        () => getCompletionMessages().length > 0,
        timeoutMs,
        'Timed out waiting for wait_for_agents completion message',
    )
    return getCompletionMessages().at(-1) as string
}

async function sendActionToAgent(terminalId: string, action: object): Promise<void> {
    const result: {success: boolean; error?: string} = await sendTextToTerminal(terminalId, JSON.stringify(action))
    expect(result).toEqual({success: true})
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Fake agent E2E: multi-agent orchestration', () => {
    let stubServer: Server
    let testPort: number

    beforeAll(async () => {
        console.log('[fakeAgentE2E:multi] Building vt-fake-agent...')
        execSync('npm run build', {cwd: FAKE_AGENT_DIR, stdio: 'pipe'})
        console.log('[fakeAgentE2E:multi] Build complete')
        testPort = await findAvailablePort(14600)
        stubServer = await startStubMcpServer(testPort)
    }, 30_000)

    afterAll(() => {
        stubServer?.close()
        getTerminalManager().cleanup()
        clearAgentNodes()
        clearTerminalRecords()
    })

    beforeEach(() => {
        sendTextState.messages.length = 0
        clearAgentNodes()
        clearTerminalRecords()
        stubCtx.harness = null
        stubCtx.childCounter = 0
        vi.clearAllMocks()
    })

    afterEach(() => {
        getTerminalManager().cleanup()
        stubCtx.harness = null
    })

    it('flat fan-out: parent waits for all children before completion fires', async () => {
        const harness: ActivityHarness = createActivityHarness()
        stubCtx.harness = harness
        const parentId: string = 'fanout-parent'
        const script: {actions: Array<Record<string, unknown>>} = {
            actions: [
                {type: 'spawn_child', task: 'fast-child', childScript: {
                    actions: [
                        {type: 'delay', ms: 500},
                        {type: 'create_node', title: 'Child1 Done', summary: 'fast child'},
                        {type: 'exit'},
                    ]
                }},
                {type: 'spawn_child', task: 'slow-child', childScript: {
                    actions: [
                        {type: 'delay', ms: 3000},
                        {type: 'create_node', title: 'Child2 Done', summary: 'slow child'},
                        {type: 'exit'},
                    ]
                }},
                {type: 'wait_for_children'},
                {type: 'create_node', title: 'Parent Done', summary: 'all children complete'},
                {type: 'exit'},
            ]
        }

        try {
            await spawnInteractiveFakeAgent(parentId, CALLER_TERMINAL_ID, script, testPort, harness)
            const monitorId: string = startMonitor(CALLER_TERMINAL_ID, [parentId], 200)

            try {
                // Wait for both children to appear in registry
                await waitForCondition(
                    () => getTerminalRecords().filter(r => r.terminalData.parentTerminalId === parentId).length === 2,
                    10_000,
                    'Both children never spawned',
                )

                // Wait for at least one child to exit (fast child finishes first)
                await waitForCondition(
                    () => getTerminalRecords().some(r =>
                        r.terminalData.parentTerminalId === parentId && r.status === 'exited'
                    ),
                    10_000,
                    'No child ever exited',
                )

                // Fast child exited but slow child still running → no completion yet
                await wait(500)
                expect(getCompletionMessages()).toHaveLength(0)

                // Wait for full cascading completion
                const completionMessage: string = await waitForCompletionMessage(25_000)
                expect(completionMessage).toContain('Parent Done')
                expect(completionMessage).toContain('Child1 Done')
                expect(completionMessage).toContain('Child2 Done')
            } finally {
                cancelMonitor(monitorId)
            }
        } finally {
            harness.cleanup()
            stubCtx.harness = null
        }
    }, 45_000)

    it('parent-child: child idle without progress nodes blocks completion', async () => {
        const harness: ActivityHarness = createActivityHarness()
        stubCtx.harness = harness
        const parentId: string = 'gate-parent'
        const script: {actions: Array<Record<string, unknown>>} = {
            actions: [
                {type: 'spawn_child', task: 'gate-child', childScript: {
                    actions: [{type: 'delay', ms: 200}]
                }},
                {type: 'wait_for_children'},
                {type: 'create_node', title: 'Parent Done', summary: 'parent work'},
                {type: 'exit'},
            ]
        }

        try {
            await spawnInteractiveFakeAgent(parentId, CALLER_TERMINAL_ID, script, testPort, harness)
            const monitorId: string = startMonitor(CALLER_TERMINAL_ID, [parentId], 200)

            try {
                // Wait for child to be spawned
                await waitForCondition(
                    () => getTerminalRecords().filter(r => r.terminalData.parentTerminalId === parentId).length === 1,
                    10_000,
                    'Child never spawned',
                )
                const childId: string = getTerminalRecords().find(
                    r => r.terminalData.parentTerminalId === parentId
                )!.terminalId

                await waitForIdle(childId, 10_000)

                // Child is idle with no progress nodes → parent must still be blocked
                await wait(SUSTAINED_IDLE_MS + 2_000)
                expect(getCompletionMessages()).toHaveLength(0)
                expect(getAgentNodes(childId)).toHaveLength(0)
                expect(getTerminalRecords().find(r => r.terminalId === parentId)?.status).toBe('running')

                // Wake child: create a node and exit
                await sendActionToAgent(childId, {type: 'create_node', title: 'Child Done', summary: 'work'})
                await waitForCondition(
                    () => getAgentNodes(childId).length === 1, 8_000,
                    'Child node never registered',
                )
                await sendActionToAgent(childId, {type: 'exit'})

                await waitForTerminalExit(parentId, 25_000)

                // Now completion should fire
                const completionMessage: string = await waitForCompletionMessage(10_000)
                expect(completionMessage).toContain('Parent Done')
                expect(completionMessage).toContain('Child Done')
            } finally {
                cancelMonitor(monitorId)
            }
        } finally {
            harness.cleanup()
            stubCtx.harness = null
        }
    }, 50_000)

    it('recursive depth: A→B→C — completion waits for deepest child', async () => {
        const harness: ActivityHarness = createActivityHarness()
        stubCtx.harness = harness
        const agentA: string = 'depth-A'
        const script: {actions: Array<Record<string, unknown>>} = {
            actions: [
                {type: 'spawn_child', task: 'B-task', childScript: {
                    actions: [
                        {type: 'spawn_child', task: 'C-task', childScript: {
                            actions: [
                                {type: 'delay', ms: 3000},
                                {type: 'create_node', title: 'C Done', summary: 'deepest child'},
                                {type: 'exit'},
                            ]
                        }},
                        {type: 'wait_for_children'},
                        {type: 'create_node', title: 'B Done', summary: 'middle child'},
                        {type: 'exit'},
                    ]
                }},
                {type: 'wait_for_children'},
                {type: 'create_node', title: 'A Done', summary: 'root agent'},
                {type: 'exit'},
            ]
        }

        try {
            await spawnInteractiveFakeAgent(agentA, CALLER_TERMINAL_ID, script, testPort, harness)
            const monitorId: string = startMonitor(CALLER_TERMINAL_ID, [agentA], 200)

            try {
                // Wait for all 3 agents to appear (A + child B + grandchild C)
                await waitForCondition(
                    () => getTerminalRecords().length >= 3, 15_000,
                    'Not all 3 agents spawned (A→B→C)',
                )

                // C is still in its 3s delay — no completion yet
                await wait(1_000)
                expect(getCompletionMessages()).toHaveLength(0)

                // Wait for cascading completion: C→B→A
                const completionMessage: string = await waitForCompletionMessage(30_000)
                expect(completionMessage).toContain('A Done')
                expect(completionMessage).toContain('B Done')
                expect(completionMessage).toContain('C Done')
            } finally {
                cancelMonitor(monitorId)
            }
        } finally {
            harness.cleanup()
            stubCtx.harness = null
        }
    }, 45_000)
})

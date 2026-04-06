/**
 * E2E: vt-fake-agent CLI + interactive PTY — single-agent scenarios.
 * Tests idle detection, progress-node gate, and sendTextToTerminal wake-up.
 *
 * See fakeAgentE2E.multi-agent.test.ts for recursive/fan-out orchestration tests.
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
import {getIdleSince} from '@/shell/edge/main/terminals/terminal-registry'

import {
    FAKE_AGENT_DIR, CALLER_TERMINAL_ID, SUSTAINED_IDLE_MS,
    findAvailablePort, getTerminalManager, getAgentNodes, clearAgentNodes, clearTerminalRecords,
    createActivityHarness, spawnInteractiveFakeAgent, waitForAgentOutput,
    waitForCondition, waitForIdle, waitForResume, wait,
    startStubMcpServer, type ActivityHarness, type AgentNodeEntry,
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

describe('Fake agent E2E: interactive PTY orchestration', () => {
    let stubServer: Server
    let testPort: number

    beforeAll(async () => {
        console.log('[fakeAgentE2E] Building vt-fake-agent...')
        execSync('npm run build', {cwd: FAKE_AGENT_DIR, stdio: 'pipe'})
        console.log('[fakeAgentE2E] Build complete')
        testPort = await findAvailablePort(14567)
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
        vi.clearAllMocks()
    })

    afterEach(() => {
        getTerminalManager().cleanup()
    })

    it('idle without progress nodes stays incomplete until a wake-up message creates a node and exits', async () => {
        const harness: ActivityHarness = createActivityHarness()
        const terminalId: string = 'fake-interactive-no-progress'
        const script: {actions: Array<Record<string, unknown>>} = {actions: [{type: 'delay', ms: 500}]}

        try {
            await spawnInteractiveFakeAgent(terminalId, CALLER_TERMINAL_ID, script, testPort, harness)
            const monitorId: string = startMonitor(CALLER_TERMINAL_ID, [terminalId], 200)

            try {
                await waitForAgentOutput(harness, terminalId, '[fake-agent] Script complete. Entering REPL mode.', 10_000)
                await waitForIdle(terminalId, 10_000)
                await wait(SUSTAINED_IDLE_MS + 1_500)

                expect(getCompletionMessages()).toHaveLength(0)
                expect(getAgentNodes(terminalId)).toHaveLength(0)
                expect(getIdleSince(terminalId)).not.toBeNull()

                await sendActionToAgent(terminalId, {type: 'create_node', title: 'Done', summary: 'work'})
                await waitForCondition(
                    () => getAgentNodes(terminalId).length === 1,
                    8_000,
                    'Timed out waiting for wake-up progress node',
                )

                await sendActionToAgent(terminalId, {type: 'exit'})
                const completionMessage: string = await waitForCompletionMessage(10_000)

                expect(completionMessage).toContain(terminalId)
                expect(completionMessage).toContain('Done')
                expect(getAgentNodes(terminalId)[0].title).toBe('Done')

                const transitions: boolean[] = harness.transitionsByTerminal.get(terminalId) ?? []
                expect(transitions).toContain(true)
                expect(transitions).toContain(false)
            } finally {
                cancelMonitor(monitorId)
            }
        } finally {
            harness.cleanup()
        }
    }, 30_000)

    it('temporary idle does not complete early when the interactive agent resumes work', async () => {
        const harness: ActivityHarness = createActivityHarness()
        const terminalId: string = 'fake-interactive-resume'
        const script: {actions: Array<Record<string, unknown>>} = {
            actions: [
                {type: 'delay', ms: 500},
                {type: 'create_node', title: 'First Node', summary: 'before idle'},
                {type: 'delay', ms: 8_000},
                {type: 'create_node', title: 'Second Node', summary: 'after idle'},
                {type: 'exit', code: 0},
            ]
        }

        try {
            await spawnInteractiveFakeAgent(terminalId, CALLER_TERMINAL_ID, script, testPort, harness)
            const monitorId: string = startMonitor(CALLER_TERMINAL_ID, [terminalId], 200)

            try {
                await waitForCondition(
                    () => getAgentNodes(terminalId).length >= 1, 8_000,
                    'Timed out waiting for first progress node',
                )
                await waitForIdle(terminalId, 12_000)
                expect(getCompletionMessages()).toHaveLength(0)

                await waitForResume(harness, terminalId, 8_000)

                const completionMessage: string = await waitForCompletionMessage(10_000)
                const nodeTitles: string[] = getAgentNodes(terminalId).map((n: AgentNodeEntry) => n.title)

                expect(nodeTitles).toEqual(['First Node', 'Second Node'])
                expect(completionMessage).toContain('First Node')
                expect(completionMessage).toContain('Second Node')

                const transitions: boolean[] = harness.transitionsByTerminal.get(terminalId) ?? []
                const idleIndex: number = transitions.indexOf(true)
                const resumeIndex: number = transitions.indexOf(false)
                expect(idleIndex).toBeGreaterThan(-1)
                expect(resumeIndex).toBeGreaterThan(idleIndex)
            } finally {
                cancelMonitor(monitorId)
            }
        } finally {
            harness.cleanup()
        }
    }, 30_000)

    it('sendTextToTerminal interrupts an idle interactive agent and its new node appears in completion', async () => {
        const harness: ActivityHarness = createActivityHarness()
        const terminalId: string = 'fake-interactive-interrupt'
        const script: {actions: Array<Record<string, unknown>>} = {
            actions: [
                {type: 'delay', ms: 500},
                {type: 'create_node', title: 'Initial', summary: 'before interrupt'},
            ]
        }

        try {
            await spawnInteractiveFakeAgent(terminalId, CALLER_TERMINAL_ID, script, testPort, harness)
            const monitorId: string = startMonitor(CALLER_TERMINAL_ID, [terminalId], 200)

            try {
                await waitForCondition(
                    () => getAgentNodes(terminalId).length === 1, 8_000,
                    'Timed out waiting for initial progress node',
                )
                await waitForIdle(terminalId, 12_000)
                expect(getCompletionMessages()).toHaveLength(0)

                await sendActionToAgent(terminalId, {type: 'create_node', title: 'Interrupted', summary: 'from message'})
                await waitForCondition(
                    () => getAgentNodes(terminalId).length === 2, 8_000,
                    'Timed out waiting for interrupted progress node',
                )
                await waitForResume(harness, terminalId, 8_000)

                await sendActionToAgent(terminalId, {type: 'exit'})
                const completionMessage: string = await waitForCompletionMessage(10_000)

                const nodeTitles: string[] = getAgentNodes(terminalId).map((n: AgentNodeEntry) => n.title)
                expect(nodeTitles).toEqual(['Initial', 'Interrupted'])
                expect(completionMessage).toContain('Initial')
                expect(completionMessage).toContain('Interrupted')
            } finally {
                cancelMonitor(monitorId)
            }
        } finally {
            harness.cleanup()
        }
    }, 30_000)
})

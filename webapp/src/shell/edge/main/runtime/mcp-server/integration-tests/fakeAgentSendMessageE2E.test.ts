/**
 * E2E: send_message between two fake agents
 *
 * Closes the DOVL-3-class blind spot where every existing test either:
 *  - stubs send_message as a no-op (fakeAgentE2E.helpers.ts pre-patch), or
 *  - only asserts the headless-rejection branch (electron-headless-agent).
 *
 * Wires two real tmux-backed fake-agent terminals through the real production sendMessageTool
 * (helpers' stub now proxies to @vt/voicetree-mcp's sendMessageTool) and
 * asserts an action sent from A actually reaches B's stdin and is processed.
 *
 * Coverage: sendMessageTool's tmux-backed interactive path.
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type {Server} from 'http'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import {initGraphModel} from '@vt/graph-model'
import {configureAgentRuntime} from '@vt/agent-runtime'

import {
    clearAgentNodes,
    clearTerminalRecords,
    createActivityHarness,
    findAvailablePort,
    getAgentNodes,
    getTerminalManager,
    spawnInteractiveFakeAgent,
    startStubMcpServer,
    stubCtx,
    waitForAgentOutput,
    type ActivityHarness,
    type AgentNodeEntry,
} from './fakeAgentE2E.helpers'

const TEST_TIMEOUT_MS: number = 90_000
// Setup waits for the fake agent's stdin REPL banner ("Entering REPL mode").
// Isolated runs hit it in ~6s, but the pre-push hook runs this test in parallel
// with the full vitest suite — fork startup under that contention has been
// observed >30s. 90s leaves headroom without masking real regressions (a real
// bug would still keep the agent from booting in any timeframe).
const SETUP_WAIT_MS: number = 90_000

describe('fake-agent send_message: A → B', () => {
    let mcpPort: number
    let stubServer: Server
    let harness: ActivityHarness
    let tempAppSupportPath: string

    beforeAll(async () => {
        tempAppSupportPath = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-fake-send-msg-'))
        initGraphModel({appSupportPath: tempAppSupportPath})
        clearTerminalRecords()
        clearAgentNodes()
        mcpPort = await findAvailablePort(40000 + Math.floor(Math.random() * 1000))
        configureAgentRuntime({
            env: {
                getAppSupportPath: () => tempAppSupportPath,
                getMcpPort: () => mcpPort,
                getProjectRoot: async () => tempAppSupportPath,
            },
        })
        stubServer = await startStubMcpServer(mcpPort)
        harness = createActivityHarness()
        stubCtx.harness = harness
    }, SETUP_WAIT_MS)

    afterAll(async () => {
        harness.cleanup()
        getTerminalManager().cleanup()
        await new Promise<void>(resolve => stubServer.close(() => resolve()))
        stubCtx.harness = null
        clearAgentNodes()
        clearTerminalRecords()
        try { fs.rmSync(tempAppSupportPath, {recursive: true, force: true}) } catch { /* ignore */ }
    })

    it('delivers a create_nodes action from agent A to agent B, B creates the node', async () => {
        const agentA: string = 'fake-send-A'
        const agentB: string = 'fake-send-B'
        const nodeTitle: string = `msg-from-A-${Date.now()}`

        // B: empty script. Boots, connects MCP, enters REPL waiting for messages.
        // When A's message arrives via PTY stdin, the executor's REPL loop will
        // pick it up, parse the embedded JSON action, and run create_nodes.
        const scriptB: object = {actions: [{type: 'log', message: 'B ready, awaiting messages'}]}

        // A: brief delay so B is in REPL, then send_message carrying a
        // create_nodes action, then exit. The action JSON is what we expect B
        // to execute on receipt.
        const createNodeAction: string = JSON.stringify({
            type: 'create_nodes',
            nodes: [{
                title: nodeTitle,
                summary: 'sent from A via real send_message tool',
                color: 'green',
            }],
        })
        const scriptA: object = {
            actions: [
                {type: 'log', message: `A sending action to ${agentB}`},
                {type: 'delay', ms: 1500},
                {type: 'send_message', targetTerminalId: agentB, message: createNodeAction},
                {type: 'log', message: 'A sent message, exiting'},
                {type: 'exit', code: 0},
            ],
        }

        await spawnInteractiveFakeAgent(agentB, agentA, scriptB, mcpPort, harness, tempAppSupportPath)
        await waitForAgentOutput(harness, agentB, 'Entering REPL mode', SETUP_WAIT_MS)

        // Spawn A. A's executor invokes the stub MCP server's send_message,
        // which now proxies to the real sendMessageTool → agentRuntime.sendTextToTerminal
        // → tmux send-keys → B's stdin → readline → executor → create_graph on the stub server.
        await spawnInteractiveFakeAgent(agentA, agentB, scriptA, mcpPort, harness, tempAppSupportPath)

        // Observe B receiving the message at the PTY level.
        await waitForAgentOutput(harness, agentB, '[fake-agent] Received message:', TEST_TIMEOUT_MS)

        // Observe B executing the embedded action.
        await waitForAgentOutput(harness, agentB, 'Executing message action: create_nodes', TEST_TIMEOUT_MS)

        // The observable side effect: B's MCP create_graph call registered the
        // node title in the stub's agent-nodes registry, keyed by callerTerminalId=B.
        await expect.poll(
            () => getAgentNodes(agentB).map((n: AgentNodeEntry) => n.title),
            {timeout: TEST_TIMEOUT_MS, interval: 250},
        ).toContain(nodeTitle)
    }, TEST_TIMEOUT_MS)
})

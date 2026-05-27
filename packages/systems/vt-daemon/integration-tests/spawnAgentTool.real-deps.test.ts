/**
 * Real-deps integration test for spawnAgentTool.
 *
 * Exercises the full spawnAgentTool path with REAL loadSettings, terminal-registry,
 * and global-budget-registry. Only stubs the boundary effects: spawnTerminalWithContextNode
 * (would spawn child_process) and the configured graph bridge (would talk to the daemon).
 *
 * Designed to catch integration-glue regressions like the Tier 1 smoke failure where
 * spawnAgentTool calls postDeltaThroughDaemonWithEditors without importing it: every
 * existing unit test mocks at least one of these three real systems, so they never
 * exercise the import boundary.
 */

import {describe, it, expect, beforeEach, beforeAll, vi} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import {promises as fs} from 'fs'
import os from 'os'
import path from 'path'

import type {Graph, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph'
import type {VTSettings} from '@vt/graph-model/settings'
import {DEFAULT_SETTINGS} from '@vt/graph-model/settings'
import {initGraphModel} from '@vt/graph-model'
import {clearSettingsCache} from '@vt/app-config/settings'
import {recordTerminalSpawn} from '../src/terminals/terminal-registry/spawn.ts'
import {clearTerminalRecords} from '../src/terminals/terminal-registry/queries.ts'
import {clearAllBudgets, setTerminalBudget} from '../src/terminals/global-budget-registry.ts'
import type {TerminalData, TerminalId} from '../src/terminals/terminal-registry/types.ts'
import {createTerminalData} from '../src/terminals/terminal-registry/types.ts'

vi.mock('../src/tools/agent-control/agentControlRuntime', async (importOriginal) => {
    const actual: typeof import('../src/tools/agent-control/agentControlRuntime')
        = await importOriginal()
    let spawnCounter: number = 0
    return {
        ...actual,
        spawnContextTerminal: vi.fn().mockImplementation(async () => {
            spawnCounter += 1
            return {terminalId: `child-${spawnCounter}`, contextNodeId: `/ctx/child-${spawnCounter}.md`}
        }),
    }
})

import {spawnAgentTool} from '../src/tools/agent-control/spawnAgentTool'
import {configureMcpServer, type GraphBridge} from '../src/config/mcp-config'

const TMP_ROOT: string = path.join(os.tmpdir(), `vt-mcp-real-deps-${process.pid}`)

const PARENT_NODE_ID: NodeIdAndFilePath = '/vault/parent.md' as NodeIdAndFilePath
const CALLER_TERMINAL_ID: string = 'caller-real-deps'

function buildParentGraphNode(): GraphNode {
    return {
        outgoingEdges: [],
        absoluteFilePathIsID: PARENT_NODE_ID,
        contentWithoutYamlOrLinks: 'Parent content',
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: {},
            isContextNode: false,
        },
    }
}

function buildGraphWithParent(): Graph {
    return {
        nodes: {[PARENT_NODE_ID]: buildParentGraphNode()},
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map([['parent.md', [PARENT_NODE_ID]]]),
        unresolvedLinksIndex: new Map(),
    }
}

function configureGraphBridge(writeFolder: string): void {
    const bridge: GraphBridge = {
        getGraph: vi.fn(async () => buildGraphWithParent()),
        getVaultPaths: vi.fn(async () => [writeFolder]),
        getWriteFolder: vi.fn(async () => writeFolder),
        getProjectRoot: vi.fn(async () => writeFolder),
        getUnseenNodesAroundContextNode: vi.fn(async () => []),
        applyGraphDelta: vi.fn(async () => undefined),
    }
    configureMcpServer({graph: bridge})
}

async function writeSettingsFile(appSupportPath: string, settings: VTSettings): Promise<void> {
    await fs.mkdir(appSupportPath, {recursive: true})
    await fs.writeFile(path.join(appSupportPath, 'settings.json'), JSON.stringify(settings, null, 2), 'utf-8')
}

function recordCaller(envVars?: Record<string, string>): void {
    const callerData: TerminalData = createTerminalData({
        terminalId: CALLER_TERMINAL_ID as TerminalId,
        attachedToNodeId: '/ctx/caller.md',
        terminalCount: 0,
        title: 'Real-Deps Caller',
        executeCommand: false,
        agentName: 'caller',
        initialEnvVars: envVars,
    })
    recordTerminalSpawn(CALLER_TERMINAL_ID, callerData)
}

beforeAll(() => {
    initGraphModel({appSupportPath: TMP_ROOT})
})

describe('spawnAgentTool real-deps integration', () => {
    let testTmpDir: string

    beforeEach(async () => {
        testTmpDir = path.join(TMP_ROOT, `t-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        await fs.mkdir(testTmpDir, {recursive: true})
        initGraphModel({appSupportPath: testTmpDir})

        clearSettingsCache()
        clearTerminalRecords()
        clearAllBudgets()
        configureGraphBridge(testTmpDir)
    })

    it('resolves a custom agent name from a written settings.json (catches settings cache/path regressions)', async () => {
        // Write a settings file containing an agent name that does NOT exist in DEFAULT_SETTINGS.
        // If loadSettings reads from the wrong path or the cache returns defaults, the agent
        // lookup will fail and spawnAgentTool will return success=false.
        const customSettings: VTSettings = {
            ...DEFAULT_SETTINGS,
            agents: [{name: 'PhoenixAgent', command: 'phoenix --prompt "$AGENT_PROMPT"'}],
        }
        await writeSettingsFile(testTmpDir, customSettings)

        recordCaller()

        const response = await spawnAgentTool({
            nodeId: PARENT_NODE_ID,
            callerTerminalId: CALLER_TERMINAL_ID,
            agentName: 'PhoenixAgent',
        })

        const payload = JSON.parse(response.content[0].text) as {success: boolean; terminalId?: string; error?: string}
        expect(payload.error).toBeUndefined()
        expect(payload.success).toBe(true)
        expect(payload.terminalId).toMatch(/^child-/)
    })

    it('auto-decrements depthBudget by reading DEPTH_BUDGET env var from real terminal record', async () => {
        await writeSettingsFile(testTmpDir, DEFAULT_SETTINGS)
        recordCaller({DEPTH_BUDGET: '5'})

        const response = await spawnAgentTool({
            nodeId: PARENT_NODE_ID,
            callerTerminalId: CALLER_TERMINAL_ID,
        })

        const payload = JSON.parse(response.content[0].text) as {success: boolean; depthBudget?: number; error?: string}
        expect(payload.error).toBeUndefined()
        expect(payload.success).toBe(true)
        expect(payload.depthBudget).toBe(4)
    })

    it('persists global-budget state across consecutive spawns until the budget is exhausted', async () => {
        await writeSettingsFile(testTmpDir, DEFAULT_SETTINGS)
        recordCaller()
        // Caller has a budget of 1: only one child can be spawned, the second must be rejected.
        setTerminalBudget(CALLER_TERMINAL_ID, 1)

        const response1 = await spawnAgentTool({
            nodeId: PARENT_NODE_ID,
            callerTerminalId: CALLER_TERMINAL_ID,
        })
        const payload1 = JSON.parse(response1.content[0].text) as {success: boolean; error?: string}
        expect(payload1.success).toBe(true)

        const response2 = await spawnAgentTool({
            nodeId: PARENT_NODE_ID,
            callerTerminalId: CALLER_TERMINAL_ID,
        })
        const payload2 = JSON.parse(response2.content[0].text) as {success: boolean; error?: string}
        expect(payload2.success).toBe(false)
        expect(payload2.error).toMatch(/budget/i)
    })
})

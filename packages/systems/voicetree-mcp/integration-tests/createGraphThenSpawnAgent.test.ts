/**
 * Reproduction test for: create_graph + spawn_agent "node not found" bug.
 *
 * Symptom (from bug_report_create_graph_node_not_found): create_graph or
 * spawn_agent rejects a node it just wrote to disk, with "not found in graph"
 * errors — even when the file demonstrably exists at the supplied path.
 *
 * Root cause: spawnAgentTool and createGraphTool's parentNodeId lookup
 * short-circuits with "not found" before delegating downstream. The downstream
 * spawnTerminalWithContextNode already self-heals from disk
 * (tryReloadNodeFromDisk at agent-runtime/spawnTerminalWithContextNode.ts:99-108),
 * but the MCP tool's upfront in-memory check never gets there. When the
 * in-memory graph is briefly out of sync with disk (the condition the bug
 * reporter observed), the tool returns a misleading error and the agent
 * cannot proceed even though the file is right there.
 *
 * The tests below set up exactly that out-of-sync state: write a node file to
 * disk, leave the in-memory graph empty for that node, then call the MCP tool.
 * Pre-fix: returns "not found" / "not found in graph". Post-fix: succeeds via
 * a disk fallback that mirrors the existing self-heal.
 */

import {describe, it, expect, beforeEach, beforeAll, vi} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import {promises as fs} from 'fs'
import os from 'os'
import path from 'path'

import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {initGraphModel} from '@vt/graph-model'
import {setGraph, getGraph} from '@vt/graph-db-server/state/graph-store'
import {clearSettingsCache} from '@vt/app-config/settings'
import {
    recordTerminalSpawn,
    clearTerminalRecords,
    clearAllBudgets,
} from '@vt/agent-runtime'
import type {TerminalData, TerminalId} from '@vt/agent-runtime'
import {createTerminalData} from '@vt/agent-runtime'

vi.mock('@vt/graph-db-server/watch-folder/vault-allowlist', async (importOriginal) => {
    const actual: typeof import('@vt/graph-db-server/watch-folder/vault-allowlist') =
        await importOriginal()
    return {
        ...actual,
        getWritePath: vi.fn(),
        getVaultPaths: vi.fn(),
    }
})

// Route writes through real applyGraphDeltaToMemState so create_graph's
// in-memory updates land in the graph store; skip only the disk effect.
vi.mock('@vt/graph-db-server/graph/applyGraphDelta', async (importOriginal) => {
    const actual: typeof import('@vt/graph-db-server/graph/applyGraphDelta') =
        await importOriginal()
    return {
        ...actual,
        applyGraphDeltaToDBThroughMemAndUIAndEditors: vi.fn().mockImplementation(
            async (delta: GraphDelta): Promise<void> => {
                await actual.applyGraphDeltaToMemState(delta)
            },
        ),
    }
})

vi.mock('@vt/agent-runtime', async (importOriginal) => {
    const actual: typeof import('@vt/agent-runtime') = await importOriginal()
    let counter: number = 0
    return {
        ...actual,
        spawnTerminalWithContextNode: vi.fn().mockImplementation(async () => {
            counter += 1
            return {terminalId: `child-${counter}`, contextNodeId: `/ctx/child-${counter}.md`}
        }),
    }
})

import {createGraphTool} from '../src/createGraphTool'
import {spawnAgentTool} from '../src/spawnAgentTool'
import {getWritePath, getVaultPaths} from '@vt/graph-db-server/watch-folder/vault-allowlist'

const TMP_ROOT: string = path.join(os.tmpdir(), `vt-create-spawn-${process.pid}`)
const CALLER_TERMINAL_ID: string = 'aki-terminal'
const CALLER_CONTEXT_NODE_ID: NodeIdAndFilePath = '/vault/ctx-nodes/caller.md' as NodeIdAndFilePath

function buildGraphNode(nodeId: NodeIdAndFilePath, content: string, isContextNode: boolean = false): GraphNode {
    return {
        outgoingEdges: [],
        absoluteFilePathIsID: nodeId,
        contentWithoutYamlOrLinks: content,
        nodeUIMetadata: {
            color: O.none,
            position: O.some({x: 0, y: 0}),
            additionalYAMLProps: new Map(),
            isContextNode,
            ...(isContextNode ? {containedNodeIds: []} : {}),
        },
    }
}

/**
 * Build an "out-of-sync" graph: only the caller's context node, no parent
 * or progress nodes — even though the test has just written those nodes
 * to disk. This mirrors the bug-report state where create_graph wrote
 * files but a follow-up MCP call sees a graph that doesn't know about
 * them.
 */
function buildOutOfSyncGraph(): Graph {
    return {
        nodes: {
            [CALLER_CONTEXT_NODE_ID]: buildGraphNode(CALLER_CONTEXT_NODE_ID, '# Context', true),
        },
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map([
            ['caller', [CALLER_CONTEXT_NODE_ID]],
        ]),
        unresolvedLinksIndex: new Map(),
    }
}

function recordCaller(): void {
    const callerData: TerminalData = createTerminalData({
        terminalId: CALLER_TERMINAL_ID as TerminalId,
        attachedToNodeId: CALLER_CONTEXT_NODE_ID,
        terminalCount: 0,
        title: 'Aki',
        executeCommand: false,
        agentName: 'aki',
    })
    recordTerminalSpawn(CALLER_TERMINAL_ID, callerData)
}

async function writeNodeFile(filePath: string, title: string): Promise<void> {
    const markdown: string = `# ${title}\n\nbody\n`
    await fs.mkdir(path.dirname(filePath), {recursive: true})
    await fs.writeFile(filePath, markdown, 'utf-8')
}

beforeAll(() => {
    initGraphModel({appSupportPath: TMP_ROOT})
})

describe('out-of-sync graph state: file on disk, missing from in-memory graph', () => {
    let vaultDir: string

    beforeEach(async () => {
        vaultDir = path.join(TMP_ROOT, `t-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        await fs.mkdir(vaultDir, {recursive: true})

        clearSettingsCache()
        clearTerminalRecords()
        clearAllBudgets()
        setGraph(buildOutOfSyncGraph())

        vi.mocked(getWritePath).mockResolvedValue(O.some(vaultDir))
        vi.mocked(getVaultPaths).mockResolvedValue([vaultDir])
    })

    it('spawn_agent finds an existing on-disk node even when the in-memory graph is out of sync', async () => {
        recordCaller()

        // Pre-condition: a real .md file exists in the vault at this path.
        // This mirrors the bug-report state: create_graph wrote the file,
        // but the in-memory graph (for whatever reason — watcher race,
        // deltas dropped, fresh MCP child process) doesn't have it.
        const trackPath: NodeIdAndFilePath = path.join(vaultDir, 'track1testcoverageplan.md') as NodeIdAndFilePath
        await writeNodeFile(trackPath, 'Track 1')

        // Sanity: graph store does NOT have it.
        expect(getGraph().nodes[trackPath]).toBeUndefined()

        // spawn_agent on that node ID. The downstream spawnTerminalWithContextNode
        // self-heals from disk (tryReloadNodeFromDisk), so the only thing
        // standing between the user and a successful spawn is the upfront
        // "Node not found" rejection in spawnAgentTool.
        const response = await spawnAgentTool({
            callerTerminalId: CALLER_TERMINAL_ID,
            nodeId: trackPath,
        })
        const payload = JSON.parse(response.content[0].text) as {
            success: boolean
            error?: string
        }

        // Pre-fix: payload.error === "Node /.../track1testcoverageplan.md not found."
        // Post-fix: success.
        expect(payload.error).toBeUndefined()
        expect(payload.success).toBe(true)
    })

    it('create_graph accepts an existing on-disk node as parentNodeId even when the in-memory graph is out of sync', async () => {
        recordCaller()

        // Pre-condition: a parent task node exists on disk but isn't in the
        // in-memory graph. This is the sub-agent symptom from the bug report:
        // create_graph(task+parentNodeId) wrote the task node, the sub-agent's
        // own MCP request looked it up, and got "Parent node ... not found
        // in graph".
        const parentPath: NodeIdAndFilePath = path.join(vaultDir, 'subagent-task.md') as NodeIdAndFilePath
        await writeNodeFile(parentPath, 'Sub-agent task')

        expect(getGraph().nodes[parentPath]).toBeUndefined()

        const response = await createGraphTool({
            callerTerminalId: CALLER_TERMINAL_ID,
            parentNodeId: parentPath,
            nodes: [
                {filename: 'subagent-progress', title: 'Sub progress', summary: 's'},
            ],
        })
        const payload = JSON.parse(response.content[0].text) as {
            success: boolean
            error?: string
        }

        // Pre-fix: "Parent node /.../subagent-task.md not found in graph."
        // Post-fix: success — disk fallback adopts the on-disk node.
        expect(payload.error).toBeUndefined()
        expect(payload.success).toBe(true)
    })
})

import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import * as O from 'fp-ts/lib/Option.js'
import {afterEach, describe, expect, it} from 'vitest'
import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph'
import type {UnseenNode} from '@vt/graph-db-protocol'
import type {VTSettings} from '@vt/graph-model/settings'
import {configureAgentRuntime} from '../../runtime/runtime-config'
import {prepareTerminalDataInMain} from '../terminalData'

function graphNode(nodeId: NodeIdAndFilePath, content: string): GraphNode {
    return {
        kind: 'leaf',
        outgoingEdges: [],
        absoluteFilePathIsID: nodeId,
        contentWithoutYamlOrLinks: content,
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map(),
            isContextNode: false,
        },
    }
}

function graphWithOnlyTask(taskNodeId: NodeIdAndFilePath): Graph {
    return {
        nodes: {
            [taskNodeId]: graphNode(taskNodeId, '# Task title'),
        },
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map(),
    }
}

const settings = {
    agents: [{name: 'Fake Agent', command: 'node fake-agent.js "$AGENT_PROMPT"'}],
    defaultAgent: 'Fake Agent',
    INJECT_ENV_VARS: {AGENT_PROMPT: 'task body'},
} as VTSettings

describe('prepareTerminalDataInMain', () => {
    afterEach(() => {
        configureAgentRuntime({})
    })

    it('does not fail when the freshly-created context node is not visible in the graph snapshot yet', async () => {
        const appSupportPath = await mkdtemp(join(tmpdir(), 'vt-terminal-data-'))
        const taskNodeId = '/vault/task.md' as NodeIdAndFilePath
        const contextNodeId = '/vault/ctx-nodes/task-context.md' as NodeIdAndFilePath

        try {
            configureAgentRuntime({
                env: {
                    getAppSupportPath: () => appSupportPath,
                    getMcpPort: () => 4242,
                    getVaultSnapshot: async () => ({
                        projectRoot: '/project',
                        readPaths: ['/project/voicetree-25-5'],
                        writeFolder: '/project/voicetree-25-5',
                    }),
                    getProjectRoot: async () => '/project',
                    getWriteFolder: async () => '/project/voicetree-25-5',
                },
                graph: {
                    getGraph: async () => graphWithOnlyTask(taskNodeId),
                    getVaultPaths: async () => ['/project/voicetree-25-5'],
                    getWriteFolder: async () => O.some('/project/voicetree-25-5'),
                    getProjectRoot: async () => '/project',
                    getWatchStatus: async () => ({isWatching: false, directory: undefined}),
                    applyGraphDelta: async (_delta: GraphDelta) => undefined,
                    createContextNode: async () => contextNodeId,
                    createContextNodeFromSelectedNodes: async () => contextNodeId,
                    getUnseenNodesAroundContextNode: async () => [] as readonly UnseenNode[],
                    updateContextNodeContainedIds: async () => undefined,
                },
            })

            const terminalData = await prepareTerminalDataInMain(
                contextNodeId,
                taskNodeId,
                0,
                'node fake-agent.js "$AGENT_PROMPT"',
                settings,
                false,
                undefined,
                undefined,
                undefined,
                true,
                undefined,
                undefined,
                'Aki',
            )

            expect(terminalData.contextContent).toBe('')
            expect(terminalData.title).toBe('Task title')
            expect(terminalData.initialEnvVars?.VOICETREE_VAULT_PATH).toBe('/project/voicetree-25-5')
        } finally {
            await rm(appSupportPath, {recursive: true, force: true})
        }
    })
})

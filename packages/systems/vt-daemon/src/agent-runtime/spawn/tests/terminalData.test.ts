import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import * as O from 'fp-ts/lib/Option.js'
import {afterEach, describe, expect, it} from 'vitest'
import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph'
import type {UnseenNode} from '@vt/graph-db-protocol'
import type {VTSettings} from '@vt/graph-model/settings'
import {configureAgentRuntime} from '@vt/vt-daemon/agent-runtime/runtime/runtime-config.ts'
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
        delete process.env.VOICETREE_HOME_PATH
    })

    it('does not fail when the freshly-created context node is not visible in the graph snapshot yet', async () => {
        const voicetreeHomePath = await mkdtemp(join(tmpdir(), 'vt-terminal-data-'))
        const taskNodeId = '/project/task.md' as NodeIdAndFilePath
        const contextNodeId = '/project/ctx-nodes/task-context.md' as NodeIdAndFilePath

        try {
            process.env.VOICETREE_HOME_PATH = voicetreeHomePath
            configureAgentRuntime({
                env: {
                    getProjectRoot: async () => '/project',
                    getWriteFolderPath: async () => '/project/voicetree-25-5',
                    getProjectPaths: async () => ['/project/voicetree-25-5'],
                },
                graph: {
                    getGraph: async () => graphWithOnlyTask(taskNodeId),
                    getProjectPaths: async () => ['/project/voicetree-25-5'],
                    getWriteFolderPath: async () => O.some('/project/voicetree-25-5'),
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
            // VOICETREE_PROJECT_PATH is the canonical project root (where `.voicetree/`
            // lives), not the daemon's writeFolderPath subfolder. See
            // buildTerminalEnvVarsProjectPath.test.ts for the dedicated regression.
            expect(terminalData.initialEnvVars?.VOICETREE_PROJECT_PATH).toBe('/project')
        } finally {
            await rm(voicetreeHomePath, {recursive: true, force: true})
        }
    })

    it('disables Codex project-doc injection for VoiceTree-spawned Codex sessions', async () => {
        const voicetreeHomePath = await mkdtemp(join(tmpdir(), 'vt-terminal-data-'))
        const projectRoot = await mkdtemp(join(tmpdir(), 'vt-terminal-project-'))
        const taskNodeId = join(projectRoot, 'task.md') as NodeIdAndFilePath
        const contextNodeId = join(projectRoot, 'ctx-nodes/task-context.md') as NodeIdAndFilePath
        const codexSettings = {
            agents: [{name: 'Codex', command: 'codex "$AGENT_PROMPT" --yolo'}],
            defaultAgent: 'Codex',
            INJECT_ENV_VARS: {AGENT_PROMPT: 'task body'},
        } as VTSettings

        try {
            process.env.VOICETREE_HOME_PATH = voicetreeHomePath
            configureAgentRuntime({
                env: {
                    getProjectRoot: async () => projectRoot,
                    getWriteFolderPath: async () => join(projectRoot, 'voicetree-25-5'),
                    getProjectPaths: async () => [join(projectRoot, 'voicetree-25-5')],
                },
                graph: {
                    getGraph: async () => graphWithOnlyTask(taskNodeId),
                    getProjectPaths: async () => [join(projectRoot, 'voicetree-25-5')],
                    getWriteFolderPath: async () => O.some(join(projectRoot, 'voicetree-25-5')),
                    getProjectRoot: async () => projectRoot,
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
                'codex "$AGENT_PROMPT" --yolo',
                codexSettings,
                false,
                undefined,
                undefined,
                undefined,
                false,
                undefined,
                undefined,
                'Aki',
            )

            expect(terminalData.initialCommand).toContain('codex -c project_doc_max_bytes=0')
            expect(terminalData.initialCommand).toContain('"$AGENT_PROMPT" --yolo')
        } finally {
            await rm(voicetreeHomePath, {recursive: true, force: true})
            await rm(projectRoot, {recursive: true, force: true})
        }
    })
})

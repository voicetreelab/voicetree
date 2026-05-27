import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {
    clearTerminalRecords,
    configureAgentRuntime,
    createTerminalData,
    getTerminalRecords,
    spawnTmuxBackedTerminal,
    subscribeToRegistry,
    type TerminalData,
    type TerminalId,
} from '@vt/agent-runtime'
import {hasSession, killSession} from '@vt/agent-runtime/terminals/tmux/tmux-session-manager'
import {configureMcpServer} from '../../config/mcp-config'
import {closeAgentTool} from './closeAgentTool'

const tempDirs: Set<string> = new Set<string>()
const terminalIds: Set<string> = new Set<string>()

function makeTerminalId(): TerminalId {
    return `close-ui-${Date.now()}-${Math.random().toString(16).slice(2)}` as TerminalId
}

async function makeTempVault(): Promise<string> {
    const dir: string = await mkdtemp(join(tmpdir(), 'close-agent-ui-'))
    tempDirs.add(dir)
    return dir
}

function makeGraph(progressNodeId: NodeIdAndFilePath, agentName: string): Graph {
    const progressNode: GraphNode = {
        kind: 'leaf',
        outgoingEdges: [],
        absoluteFilePathIsID: progressNodeId,
        contentWithoutYamlOrLinks: '# progress',
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map([['agent_name', agentName]]),
            isContextNode: false,
        },
    }
    return {
        nodes: {[progressNodeId]: progressNode},
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map(),
    }
}

function parsePayload(response: Awaited<ReturnType<typeof closeAgentTool>>): {
    readonly success: boolean
    readonly terminalId?: string
    readonly message?: string
} {
    return JSON.parse(response.content[0]?.text ?? '{}') as {
        readonly success: boolean
        readonly terminalId?: string
        readonly message?: string
    }
}

async function cleanup(): Promise<void> {
    for (const terminalId of terminalIds) {
        await killSession(terminalId).catch(() => undefined)
    }
    terminalIds.clear()
    for (const dir of tempDirs) {
        await rm(dir, {recursive: true, force: true})
    }
    tempDirs.clear()
    clearTerminalRecords()
    configureAgentRuntime({})
    configureMcpServer({})
}

describe('closeAgentTool', () => {
    afterEach(cleanup)

    it('closes the renderer window before cleaning up a tmux-backed interactive agent', async () => {
        const terminalId: TerminalId = makeTerminalId()
        terminalIds.add(terminalId)
        const projectRoot: string = await makeTempVault()
        const contextNodeId: NodeIdAndFilePath = join(projectRoot, 'context.md') as NodeIdAndFilePath
        const progressNodeId: NodeIdAndFilePath = join(projectRoot, 'progress.md') as NodeIdAndFilePath
        const events: string[] = []

        configureAgentRuntime({
            ui: {
                closeTerminalById: (id: string): void => {
                    events.push(`ui-close:${id}`)
                },
            },
        })
        configureMcpServer({
            graph: {
                getSnapshot: async () => ({
                    graph: makeGraph(progressNodeId, terminalId),
                    projectRoot: null,
                    vaultPaths: [],
                    writeFolder: null,
                }),
                applyGraphDelta: async (): Promise<void> => {},
            },
        })

        const terminalData: TerminalData = createTerminalData({
            terminalId,
            attachedToNodeId: contextNodeId,
            terminalCount: 0,
            title: 'interactive close regression',
            agentName: terminalId,
            isHeadless: false,
            executeCommand: true,
            initialEnvVars: {
                VOICETREE_TERMINAL_ID: terminalId,
                VOICETREE_VAULT_PATH: projectRoot,
            },
        })

        await spawnTmuxBackedTerminal(
            terminalId,
            terminalData,
            `bash -lc 'sleep 30'`,
            projectRoot,
            {VOICETREE_TERMINAL_ID: terminalId, VOICETREE_VAULT_PATH: projectRoot},
        )
        expect(await hasSession(terminalId)).toBe(true)

        const unsubscribe: () => void = subscribeToRegistry((records) => {
            events.push(`registry:${records.map((record) => record.terminalId).join(',')}`)
        })
        const response = await closeAgentTool({
            callerTerminalId: 'reviewer',
            terminalId,
            forceWithReason: 'test closes a running interactive agent',
        })
        unsubscribe()

        expect(parsePayload(response)).toMatchObject({success: true, terminalId})
        expect(events[0]).toBe(`ui-close:${terminalId}`)
        expect(events).toContain('registry:')
        expect(getTerminalRecords().some((record) => record.terminalId === terminalId)).toBe(false)
    }, 15000)
})

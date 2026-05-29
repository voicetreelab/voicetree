import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {clearTerminalRecords, getTerminalRecords} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry'
import {createTerminalData} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts'
import type {TerminalData, TerminalId} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts'
import {configureAgentRuntime} from '@vt/vt-daemon/agent-runtime/runtime/runtime-config.ts'
import {spawnTmuxBackedTerminal} from '@vt/vt-daemon/agent-runtime/headless/headlessAgentManager.ts'
import {hasSession, killSession} from '@vt/vt-daemon/agent-runtime/terminals/tmux/tmux-session-manager'
import type {TerminalRegistryEvent} from '@vt/vt-daemon-protocol'
import type {GraphBridge} from '@vt/vt-daemon/config/mcpBridges.ts'
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
            additionalYAMLProps: {agent_name: agentName},
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
}

describe('closeAgentTool', () => {
    afterEach(cleanup)

    it('publishes terminal-removed and drops the registry row when closing a tmux-backed interactive agent', async () => {
        const terminalId: TerminalId = makeTerminalId()
        terminalIds.add(terminalId)
        const projectRoot: string = await makeTempVault()
        const contextNodeId: NodeIdAndFilePath = join(projectRoot, 'context.md') as NodeIdAndFilePath
        const progressNodeId: NodeIdAndFilePath = join(projectRoot, 'progress.md') as NodeIdAndFilePath
        const events: TerminalRegistryEvent[] = []

        // Capture the publish sink as agent-runtime fires it — this is the
        // single observable boundary the daemon publishes terminal-registry
        // events onto. With BF-376's design, the renderer's UI close is
        // derived from `terminal-removed` on this topic (no separate
        // closeTerminalById callback exists post-cutover).
        configureAgentRuntime({
            publishTerminalRegistryEvent: (event: TerminalRegistryEvent): void => {
                events.push(event)
            },
        })
        const bridge: GraphBridge = {
            getGraph: async (): Promise<Graph> => makeGraph(progressNodeId, terminalId),
            getVaultPaths: async (): Promise<readonly string[]> => [],
            getWriteFolder: async (): Promise<string | null> => null,
            applyGraphDelta: async (): Promise<void> => {},
        }

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
                VOICETREE_PROJECT_PATH: projectRoot,
            },
        })

        await spawnTmuxBackedTerminal(
            terminalId,
            terminalData,
            `bash -lc 'sleep 30'`,
            projectRoot,
            {VOICETREE_TERMINAL_ID: terminalId, VOICETREE_PROJECT_PATH: projectRoot},
        )
        expect(await hasSession(terminalId)).toBe(true)

        const response = await closeAgentTool({
            callerTerminalId: 'reviewer',
            terminalId,
            forceWithReason: 'test closes a running interactive agent',
        }, bridge)

        expect(parsePayload(response)).toMatchObject({success: true, terminalId})

        // The close must publish exactly one `terminal-removed` event for
        // this terminal; receivers (renderer, monitors) drop their state on
        // that event alone.
        const removedEvents: readonly TerminalRegistryEvent[] = events.filter(
            (e: TerminalRegistryEvent) => e.type === 'terminal-removed' && e.terminalId === terminalId,
        )
        expect(removedEvents).toHaveLength(1)

        expect(getTerminalRecords().some((record) => record.terminalId === terminalId)).toBe(false)
        expect(await hasSession(terminalId)).toBe(false)
    }, 15000)
})

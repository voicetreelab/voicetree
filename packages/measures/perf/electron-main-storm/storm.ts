import { agentRuntime, configureAgentRuntime } from '@vt/agent-runtime'
import {
    createTerminalData,
    type TerminalData,
    type TerminalId,
} from '@vt/agent-runtime/types'
import { initGraphModel } from '@vt/graph-model'

import { resolveFakeAgentEntrypoint, resolveTsxImportPath } from './paths.ts'
import type { AgentResult } from './types.ts'

function buildFakeAgentScript(nodesPerAgent: number): object {
    const actions: object[] = []
    for (let i = 0; i < nodesPerAgent; i++) {
        actions.push({
            type: 'create_node',
            title: `Perf Node ${i}`,
            summary: `Synthetic node ${i} from electron-main-storm.`,
            content: `Node body ${i}.`,
        })
    }
    actions.push({ type: 'exit', code: 0 })
    return { actions }
}

async function waitForExit(
    terminalId: string,
    exitedTerminals: Map<string, { code: number; atMs: number }>,
    timeoutMs: number,
): Promise<{ code: number; atMs: number } | null> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const found = exitedTerminals.get(terminalId)
        if (found) return found
        const record = agentRuntime.getTerminalRecords().find((r) => r.terminalId === terminalId)
        if (record?.status === 'exited') {
            const entry = { code: 0, atMs: Date.now() }
            exitedTerminals.set(terminalId, entry)
            return entry
        }
        await new Promise((r) => setTimeout(r, 200))
    }
    return null
}

export async function runStorm(args: {
    mcpPort: number
    vault: string
    appSupport: string
    agents: number
    nodesPerAgent: number
    perAgentTimeoutMs: number
}): Promise<readonly AgentResult[]> {
    const { dir: fakeAgentDir, entry: fakeAgentEntrypoint } = resolveFakeAgentEntrypoint()
    const tsxImportPath = resolveTsxImportPath()

    // graph-model is initialised by `startDaemon` in the daemon-only harness;
    // here Electron owns the daemon, so init it locally for the in-process
    // agentRuntime (`loadSettings` -> `getSettingsPath` -> `getConfig`).
    initGraphModel({ appSupportPath: args.appSupport })

    configureAgentRuntime({
        env: {
            getAppSupportPath: (): string => args.appSupport,
            getMcpPort: (): number => args.mcpPort,
        },
    })

    await agentRuntime.ensureTmuxAvailable()
    await agentRuntime.ensureTmuxServer()

    const script = buildFakeAgentScript(args.nodesPerAgent)
    const agentPrompt = `### FAKE_AGENT_SCRIPT ###\n${JSON.stringify(script)}\n### END_FAKE_AGENT_SCRIPT ###`

    const exitedTerminals = new Map<string, { code: number; atMs: number }>()
    const onData = (_id: string, _data: string): void => { /* drop; profile is the artifact */ }
    const onExit = (id: string, exitCode: number): void => {
        if (!exitedTerminals.has(id)) exitedTerminals.set(id, { code: exitCode, atMs: Date.now() })
    }

    const launches: Promise<AgentResult>[] = []
    for (let i = 0; i < args.agents; i++) {
        const terminalId = `perf-agent-${i}` as TerminalId
        const initialEnvVars: Record<string, string> = {
            VOICETREE_TERMINAL_ID: terminalId,
            VOICETREE_MCP_PORT: String(args.mcpPort),
            VOICETREE_VAULT_PATH: args.vault,
            TASK_NODE_PATH: `${args.vault}/${terminalId}-task.md`,
            AGENT_PROMPT: agentPrompt,
        }
        const td: TerminalData = createTerminalData({
            terminalId,
            attachedToNodeId: args.vault,
            terminalCount: i,
            title: terminalId,
            agentName: terminalId,
            isHeadless: true,
            initialEnvVars,
            initialCommand: `${JSON.stringify(process.execPath)} --import ${JSON.stringify(tsxImportPath)} ${JSON.stringify(fakeAgentEntrypoint)}; exit`,
            executeCommand: true,
            initialSpawnDirectory: fakeAgentDir,
        })

        launches.push((async (): Promise<AgentResult> => {
            const spawnRes = await agentRuntime.getTerminalManager().spawnTmuxBacked({
                terminalData: td,
                getToolsDirectory: () => fakeAgentDir,
                onData,
                onExit,
            })
            if (!spawnRes.success) {
                return {
                    terminalId,
                    spawnSuccess: false,
                    exitCode: -1,
                    exitedAtMs: Date.now(),
                    errorMessage: spawnRes.error ?? 'spawn failed',
                }
            }
            const exit = await waitForExit(terminalId, exitedTerminals, args.perAgentTimeoutMs)
            return {
                terminalId,
                spawnSuccess: true,
                exitCode: exit?.code ?? null,
                exitedAtMs: exit?.atMs ?? null,
            }
        })())
    }

    return Promise.all(launches)
}

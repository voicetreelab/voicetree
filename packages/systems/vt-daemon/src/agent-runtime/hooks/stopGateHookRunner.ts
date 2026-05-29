/**
 * Stop Gate Hook Runner — BF-047
 *
 * Public API:
 * - runStopHooks(terminalId, graph, records) → Promise<StopHookResult>
 *
 * Reads ~/brain/automation/hooks.json, runs each hook, and aggregates results.
 * Legacy built-ins are skipped with a warning. Falls back to DEFAULT_HOOKS if
 * config is missing.
 */

import * as fs from 'fs'
import * as O from 'fp-ts/lib/Option.js'
import {spawnSync, type SpawnSyncReturns} from 'child_process'
import type {Graph} from '@vt/graph-model/graph'
import type {TerminalRecord} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/index.ts'

// ─── Types ───────────────────────────────────────────────────────────────────

export type StopHookContext = {
    terminalId: string
    agentName: string
    taskNodePath: string
    projectRoot: string
    parentTerminalId: string | null
    childAgents: Array<{
        terminalId: string
        agentName: string
        taskNodePath: string
        status: 'running' | 'idle' | 'exited'
    }>
}

export type StopHookResult = { passed: boolean; message?: string }

type HookEntry =
    | { type: 'builtin'; name: string }
    | { type: 'command'; command: string }

type HookConfig = { Stop: HookEntry[] }

export type StopGateHookRunnerDeps = {
    readonly homeDir: string
    readonly readHookConfigFile: (path: string) => string
    readonly runShellCommand: (command: string, input: string, timeoutMs: number) => SpawnSyncReturns<Buffer>
    readonly warn: (message: string) => void
}

const defaultStopGateHookRunnerDeps: StopGateHookRunnerDeps = {
    homeDir: process.env.HOME ?? '',
    readHookConfigFile: (path: string): string => fs.readFileSync(path, 'utf-8'),
    runShellCommand: (command: string, input: string, timeoutMs: number): SpawnSyncReturns<Buffer> => spawnSync(command, {
        shell: true,
        input,
        timeout: timeoutMs
    }),
    warn: (message: string): void => console.warn(message)
}

// ─── Default config ───────────────────────────────────────────────────────────

const DEFAULT_HOOKS: HookConfig = {
    Stop: [
        { type: 'command', command: 'npx tsx ~/brain/automation/stop-gate-audit.ts' }
    ]
}

// ─── Config loading ───────────────────────────────────────────────────────────

function loadHookConfig(deps: StopGateHookRunnerDeps): HookConfig {
    const configPath: string = `${deps.homeDir}/brain/automation/hooks.json`
    try {
        const content: string = deps.readHookConfigFile(configPath)
        return JSON.parse(content) as HookConfig
    } catch {
        return DEFAULT_HOOKS
    }
}

// ─── Hook runners ─────────────────────────────────────────────────────────────

function runBuiltinHook(
    entry: { type: 'builtin'; name: string },
    deps: StopGateHookRunnerDeps
): StopHookResult {
    deps.warn(
        `[stopGateHookRunner] builtin hook "${entry.name}" is no longer supported; skipping.`
    )
    return { passed: true }
}

function runShellHook(
    entry: { type: 'command'; command: string },
    context: StopHookContext,
    deps: StopGateHookRunnerDeps
): StopHookResult {
    const command: string = entry.command.replace('~', deps.homeDir)
    const result: SpawnSyncReturns<Buffer> = deps.runShellCommand(command, JSON.stringify(context), 30_000)
    if (result.status === 2) {
        const message: string = result.stderr?.toString().trim() || 'Shell hook blocked stop'
        return { passed: false, message }
    }
    return { passed: true }
}

// ─── Context builder ──────────────────────────────────────────────────────────

function buildContext(
    terminalId: string,
    records: readonly TerminalRecord[]
): StopHookContext | null {
    const record: TerminalRecord | undefined = records.find(r => r.terminalId === terminalId)
    if (!record) return null

    const taskNodePath: string = O.isSome(record.terminalData.anchoredToNodeId)
        ? record.terminalData.anchoredToNodeId.value
        : ''

    const childAgents: StopHookContext['childAgents'] = records
        .filter(r => r.terminalData.parentTerminalId === terminalId)
        .map(r => ({
            terminalId: r.terminalId,
            agentName: r.terminalData.agentName,
            taskNodePath: O.isSome(r.terminalData.anchoredToNodeId)
                ? r.terminalData.anchoredToNodeId.value
                : '',
            status: (r.status === 'exited'
                ? 'exited'
                : r.terminalData.isDone
                    ? 'idle'
                    : 'running') as 'running' | 'idle' | 'exited'
        }))

    return {
        terminalId,
        agentName: record.terminalData.agentName,
        taskNodePath,
        projectRoot: record.terminalData.initialEnvVars?.VOICETREE_PROJECT_PATH ?? '',
        parentTerminalId: record.terminalData.parentTerminalId,
        childAgents
    }
}

// ─── Progress node gate ──────────────────────────────────────────────────────

function hasProgressNodes(agentName: string, graph: Graph): boolean {
    if (!agentName) return false
    for (const nodeId of Object.keys(graph.nodes)) {
        const node = graph.nodes[nodeId]
        if (node.nodeUIMetadata.isContextNode) continue
        if (node.nodeUIMetadata.additionalYAMLProps['agent_name'] === agentName) return true
    }
    return false
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function runStopHooks(
    terminalId: string,
    graph: Graph,
    records: readonly TerminalRecord[],
    deps: StopGateHookRunnerDeps = defaultStopGateHookRunnerDeps
): Promise<StopHookResult> {
    const context: StopHookContext | null = buildContext(terminalId, records)
    if (!context) return { passed: true }

    // Gate: skip hooks for agents with no progress nodes (VT internal logic)
    if (!hasProgressNodes(context.agentName, graph)) {
        return { passed: true }
    }

    const config: HookConfig = loadHookConfig(deps)
    const messages: string[] = []
    let anyFailed: boolean = false

    for (const entry of config.Stop) {
        const result: StopHookResult = entry.type === 'builtin'
            ? runBuiltinHook(entry, deps)
            : runShellHook(entry, context, deps)

        if (!result.passed) {
            anyFailed = true
            if (result.message) messages.push(result.message)
        }
    }

    return anyFailed
        ? { passed: false, message: messages.join('\n\n') || undefined }
        : { passed: true }
}

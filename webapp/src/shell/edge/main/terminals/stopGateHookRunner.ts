/**
 * Stop Gate Hook Runner — BF-047
 *
 * Public API:
 * - runStopHooks(terminalId, graph, records) → Promise<StopHookResult>
 *
 * Reads ~/brain/automation/hooks.json, runs each hook (built-in or shell command),
 * and aggregates results. Falls back to DEFAULT_HOOKS if config is missing.
 */

import * as fs from 'fs'
import * as O from 'fp-ts/lib/Option.js'
import {spawnSync, type SpawnSyncReturns} from 'child_process'
import type {Graph} from '@/pure/graph'
import type {TerminalRecord} from './terminal-registry'
import {auditAgent, buildDeficiencyPrompt, type ComplianceResult} from './stopGateAudit'
import {getNewNodesForAgent} from '@/shell/edge/main/mcp-server/getNewNodesForAgent'

// ─── Types ───────────────────────────────────────────────────────────────────

export type StopHookContext = {
    terminalId: string
    agentName: string
    taskNodePath: string
    vaultPath: string
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

type BuiltinHookFn = (
    context: StopHookContext,
    graph: Graph,
    records: readonly TerminalRecord[]
) => StopHookResult

// ─── Default config ───────────────────────────────────────────────────────────

const DEFAULT_HOOKS: HookConfig = {
    Stop: [
        { type: 'builtin', name: 'skill-obligation-audit' },
        { type: 'builtin', name: 'progress-node-check' }
    ]
}

// ─── Built-in hooks ───────────────────────────────────────────────────────────

function skillObligationAudit(
    context: StopHookContext,
    graph: Graph,
    records: readonly TerminalRecord[]
): StopHookResult {
    const result: ComplianceResult | null = auditAgent(context.terminalId, graph, records)
    if (result === null) return { passed: true }
    if (result.passed) return { passed: true }
    return { passed: false, message: buildDeficiencyPrompt(result) }
}

function progressNodeCheck(
    context: StopHookContext,
    graph: Graph,
    records: readonly TerminalRecord[]
): StopHookResult {
    const record: TerminalRecord | undefined = records.find(r => r.terminalId === context.terminalId)
    const spawnedAt: number = record?.spawnedAt ?? 0
    const hasNodes: boolean = getNewNodesForAgent(graph, context.agentName, spawnedAt).length > 0
    if (hasNodes) return { passed: true }
    return { passed: false, message: 'No progress nodes created — agent produced no visible work' }
}

const builtinHooks: Map<string, BuiltinHookFn> = new Map([
    ['skill-obligation-audit', skillObligationAudit],
    ['progress-node-check', progressNodeCheck]
])

// ─── Config loading ───────────────────────────────────────────────────────────

function loadHookConfig(): HookConfig {
    const home: string = process.env.HOME ?? ''
    const configPath: string = `${home}/brain/automation/hooks.json`
    try {
        const content: string = fs.readFileSync(configPath, 'utf-8')
        return JSON.parse(content) as HookConfig
    } catch {
        return DEFAULT_HOOKS
    }
}

// ─── Hook runners ─────────────────────────────────────────────────────────────

function runBuiltinHook(
    entry: { type: 'builtin'; name: string },
    context: StopHookContext,
    graph: Graph,
    records: readonly TerminalRecord[]
): StopHookResult {
    const fn: BuiltinHookFn | undefined = builtinHooks.get(entry.name)
    if (!fn) return { passed: true } // unknown builtin — skip
    return fn(context, graph, records)
}

function runShellHook(
    entry: { type: 'command'; command: string },
    context: StopHookContext
): StopHookResult {
    const home: string = process.env.HOME ?? ''
    const command: string = entry.command.replace('~', home)
    const result: SpawnSyncReturns<Buffer> = spawnSync(command, {
        shell: true,
        input: JSON.stringify(context),
        timeout: 30_000
    })
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
        vaultPath: record.terminalData.initialEnvVars?.VOICETREE_VAULT_PATH ?? '',
        parentTerminalId: record.terminalData.parentTerminalId,
        childAgents
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function runStopHooks(
    terminalId: string,
    graph: Graph,
    records: readonly TerminalRecord[]
): Promise<StopHookResult> {
    const context: StopHookContext | null = buildContext(terminalId, records)
    if (!context) return { passed: true }

    const config: HookConfig = loadHookConfig()
    const messages: string[] = []
    let anyFailed: boolean = false

    for (const entry of config.Stop) {
        const result: StopHookResult = entry.type === 'builtin'
            ? runBuiltinHook(entry, context, graph, records)
            : runShellHook(entry, context)

        if (!result.passed) {
            anyFailed = true
            if (result.message) messages.push(result.message)
        }
    }

    return anyFailed
        ? { passed: false, message: messages.join('\n\n') || undefined }
        : { passed: true }
}

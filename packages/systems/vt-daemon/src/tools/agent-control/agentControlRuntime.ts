import {terminalRuntimeSurface as agentRuntime} from './terminalRuntimeSurface.ts'
import type {TerminalId} from '@vt/vt-daemon/terminals/terminal-registry/types.ts'
import type {TerminalRecord} from '@vt/vt-daemon/terminals/terminal-registry'
import {
    closeHeadlessAgent,
    getHeadlessAgentOutput,
    isTmuxHeadlessAgent,
} from '@vt/vt-daemon/agents/headless/headlessAgentManager.ts'
import {runStopHooks, type StopHookResult} from '@vt/vt-daemon/agents/hooks/stopGateHookRunner.ts'
import {sendTextToTerminal} from '@vt/vt-daemon/agents/inject/send-text-to-terminal.ts'

export type {StopHookResult, TerminalId, TerminalRecord}

export type PendingTerminalState = {
    readonly isHeadless: boolean
}

export type PendingTerminalRecord = PendingTerminalState & {
    readonly terminalId: string
}

export function listTerminalRecords(): TerminalRecord[] {
    return agentRuntime.getTerminalRecords()
}

export function findTerminalRecord(terminalId: string, records: readonly TerminalRecord[] = listTerminalRecords()): TerminalRecord | undefined {
    return records.find((record: TerminalRecord) => record.terminalId === terminalId)
}

export function terminalExists(terminalId: string, records: readonly TerminalRecord[] = listTerminalRecords()): boolean {
    return findTerminalRecord(terminalId, records) !== undefined
}

export function getPendingTerminalState(terminalId: string): PendingTerminalState | undefined {
    return agentRuntime.getPendingTerminal(terminalId)
}

export function listPendingTerminalStates(): PendingTerminalRecord[] {
    const runtime = agentRuntime as typeof agentRuntime & {
        readonly getPendingTerminals?: () => PendingTerminalRecord[]
    }
    return runtime.getPendingTerminals?.() ?? []
}

export function enqueuePendingTerminalMessage(terminalId: string, message: string): void {
    agentRuntime.enqueuePendingMessage(terminalId, message)
}

export function readHeadlessTerminalOutput(terminalId: string): string {
    return getHeadlessAgentOutput(terminalId)
}

export function isTmuxHeadlessTerminal(terminalId: string): boolean {
    return isTmuxHeadlessAgent(terminalId)
}

export function readInteractiveTerminalOutput(terminalId: string, nChars: number): string | undefined {
    return agentRuntime.getOutput(terminalId, nChars)
}

export function sendTerminalText(terminalId: string, message: string): ReturnType<typeof sendTextToTerminal> {
    return sendTextToTerminal(terminalId, message)
}

export const consumeSpawnBudget = agentRuntime.tryConsumeAndSplitBudget
export const rememberChildTerminal = agentRuntime.registerChild
export const spawnContextTerminal = agentRuntime.spawnTerminalWithContextNode

export async function closeHeadlessTerminal(terminalId: TerminalId): Promise<{closed: true; wasRunning: boolean} | {closed: false}> {
    return closeHeadlessAgent(terminalId)
}

export function runTerminalStopHooks(
    terminalId: string,
    graph: Parameters<typeof runStopHooks>[1],
    records: readonly TerminalRecord[],
): Promise<StopHookResult> {
    return runStopHooks(terminalId, graph, records)
}

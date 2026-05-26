import {
    agentRuntime,
    type StopHookResult,
    type TerminalId,
    type TerminalRecord,
} from '@vt/agent-runtime'

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
    return agentRuntime.getHeadlessAgentOutput(terminalId)
}

export function isTmuxHeadlessTerminal(terminalId: string): boolean {
    return agentRuntime.isTmuxHeadlessAgent(terminalId)
}

export function readInteractiveTerminalOutput(terminalId: string, nChars: number): string | undefined {
    return agentRuntime.getOutput(terminalId, nChars)
}

export function sendTerminalText(terminalId: string, message: string): ReturnType<typeof agentRuntime.sendTextToTerminal> {
    return agentRuntime.sendTextToTerminal(terminalId, message)
}

export const consumeSpawnBudget = agentRuntime.tryConsumeAndSplitBudget
export const rememberChildTerminal = agentRuntime.registerChild
export const spawnContextTerminal = agentRuntime.spawnTerminalWithContextNode

export function closeHeadlessTerminal(terminalId: TerminalId): {closed: true; wasRunning: boolean} | {closed: false} {
    return agentRuntime.closeHeadlessAgent(terminalId)
}

export function runTerminalStopHooks(
    terminalId: string,
    graph: Parameters<typeof agentRuntime.runStopHooks>[1],
    records: readonly TerminalRecord[],
): Promise<StopHookResult> {
    return agentRuntime.runStopHooks(terminalId, graph, records)
}

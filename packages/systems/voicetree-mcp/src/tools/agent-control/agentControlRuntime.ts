import {
    agentRuntime,
    enqueuePendingMessage,
    getHeadlessAgentOutput,
    getOutput,
    getPendingTerminal,
    getTerminalRecords,
    registerChild,
    sendTextToTerminal,
    spawnTerminalWithContextNode,
    tryConsumeAndSplitBudget,
    type StopHookResult,
    type TerminalId,
    type TerminalRecord,
} from '@vt/agent-runtime'

export type {StopHookResult, TerminalId, TerminalRecord}

export type PendingTerminalState = {
    readonly isHeadless: boolean
}

export function listTerminalRecords(): TerminalRecord[] {
    return getTerminalRecords()
}

export function findTerminalRecord(terminalId: string, records: readonly TerminalRecord[] = listTerminalRecords()): TerminalRecord | undefined {
    return records.find((record: TerminalRecord) => record.terminalId === terminalId)
}

export function terminalExists(terminalId: string, records: readonly TerminalRecord[] = listTerminalRecords()): boolean {
    return findTerminalRecord(terminalId, records) !== undefined
}

export function getPendingTerminalState(terminalId: string): PendingTerminalState | undefined {
    return getPendingTerminal(terminalId)
}

export function enqueuePendingTerminalMessage(terminalId: string, message: string): void {
    enqueuePendingMessage(terminalId, message)
}

export function readHeadlessTerminalOutput(terminalId: string): string {
    return getHeadlessAgentOutput(terminalId)
}

export function readInteractiveTerminalOutput(terminalId: string, nChars: number): string | undefined {
    return getOutput(terminalId, nChars)
}

export function sendTerminalText(terminalId: string, message: string): ReturnType<typeof sendTextToTerminal> {
    return sendTextToTerminal(terminalId, message)
}

export const consumeSpawnBudget = tryConsumeAndSplitBudget
export const rememberChildTerminal = registerChild
export const spawnContextTerminal = spawnTerminalWithContextNode

export function closeHeadlessTerminal(terminalId: TerminalId): {closed: true; wasRunning: boolean} | {closed: false} {
    return agentRuntime.closeHeadlessAgent(terminalId)
}

export function closeInteractiveTerminal(terminalId: string): void {
    agentRuntime.getRuntimeUI().closeTerminalById?.(terminalId)
}

export function runTerminalStopHooks(
    terminalId: string,
    graph: Parameters<typeof agentRuntime.runStopHooks>[1],
    records: readonly TerminalRecord[],
): Promise<StopHookResult> {
    return agentRuntime.runStopHooks(terminalId, graph, records)
}

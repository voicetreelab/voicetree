import type {ChildProcess} from 'child_process'
import type {Graph} from '@vt/graph-model/graph'
import type {SupportedHeadlessCli} from '../spawn/headlessCli'
import type {TerminalData, TerminalId} from '../terminals/terminal-registry/types'
import type {StopHookResult} from '../hooks/stopGateHookRunner'
import type {HeadlessAgentDeps} from './headlessAgentManager'
import type {TerminalRecord} from '../terminals/terminal-registry'

export type HeadlessLifecycleState = {
    readonly headlessProcesses: Map<TerminalId, ChildProcess>
    readonly lastOutputByTerminal: Map<TerminalId, string>
    readonly outputRingSize: number
    readonly appendRingBuffer: (previous: string, chunk: Buffer, size: number) => string
}

function appendChildOutput(
    terminalId: TerminalId,
    state: HeadlessLifecycleState,
): (d: Buffer) => void {
    return (d: Buffer): void => {
        const prev: string = state.lastOutputByTerminal.get(terminalId) ?? ''
        state.lastOutputByTerminal.set(terminalId, state.appendRingBuffer(prev, d, state.outputRingSize))
    }
}

function hasActiveChildren(terminalId: TerminalId, records: readonly TerminalRecord[]): boolean {
    return records.some(
        (r: TerminalRecord) => r.terminalData.parentTerminalId === terminalId && r.status !== 'exited'
    )
}

/**
 * Shared exit handler for both initial spawn and resumed agents.
 * Runs stop gate audit on successful exit and resumes with deficiency if needed.
 */
export async function handleAgentExit(
    terminalId: TerminalId,
    code: number | null,
    deps: HeadlessAgentDeps,
    state: HeadlessLifecycleState,
): Promise<void> {
    const output: string = state.lastOutputByTerminal.get(terminalId) ?? ''
    const hasOutput: boolean = output.trim().length > 0
    if (code !== 0 && code !== null) {
        deps.writeLog({ level: 'error', message: `[headlessAgentManager] Agent ${terminalId} exited with code ${code}. Last output: ${output.slice(-500)}` })
    } else if (!hasOutput) {
        deps.writeLog({ level: 'warn', message: `[headlessAgentManager] Agent ${terminalId} exited code=${code} with ZERO output - likely silent failure` })
    }

    const spawnedChildren: boolean = deps.getTerminalRecords().some(
        r => r.terminalData.parentTerminalId === terminalId
    )
    if (hasOutput && !spawnedChildren && code === 0) {
        deps.writeLog({ level: 'warn', message: `[headlessAgentManager] Agent ${terminalId} exited without spawning a successor - possible missed handover` })
    }

    deps.markTerminalExited(terminalId, code)

    // Stop gate audit derives SKILL.md from graph at audit time.
    // Skip audit if active child agents may still satisfy the parent's obligations.
    if (code === 0 || code === null) {
        const graph: Graph = await deps.getGraph()
        const records: readonly TerminalRecord[] = deps.getTerminalRecords()
        if (!hasActiveChildren(terminalId, records)) {
            const hookResult: StopHookResult = await deps.runStopHooks(terminalId, graph, records)
            const record: TerminalRecord | undefined = records.find(r => r.terminalId === terminalId)
            if (!hookResult.passed && record && record.auditRetryCount < 2) {
                resumeWithDeficiency(terminalId, record, hookResult.message ?? 'Stop gate hooks failed', deps, state)
                return
            }
            if (!hookResult.passed) {
                deps.writeLog({ level: 'warn', message: `[headlessAgentManager] Agent ${terminalId} FAILED audit after 2 retries` })
            }
        }
    }

    state.headlessProcesses.delete(terminalId)
}

/**
 * Build CLI-specific resume command. Derives cliType and sessionId at resume time
 * from agent command string + spawn conventions.
 */
export function buildResumeCommand(cliType: SupportedHeadlessCli): string {
    switch (cliType) {
        case 'claude':
            return `claude --continue -p "$RESUME_PROMPT" --dangerously-skip-permissions`
        case 'codex':
            return `codex exec resume --last -p "$RESUME_PROMPT" --full-auto`
        case 'gemini':
            return `gemini --resume latest -p "$RESUME_PROMPT" --yolo`
    }
}

/**
 * Resume an agent with a deficiency prompt after failed stop gate audit.
 * Derives cliType from initialCommand and sessionId from spawn convention.
 */
function resumeWithDeficiency(
    terminalId: TerminalId,
    record: TerminalRecord,
    deficiency: string,
    deps: HeadlessAgentDeps,
    state: HeadlessLifecycleState,
): void {
    const baseCommand: string = (record.terminalData.initialCommand ?? '').replace('"$AGENT_PROMPT"', '').replace("'$AGENT_PROMPT'", '').trim()
    const cliType: SupportedHeadlessCli | null = deps.detectCliType(baseCommand)
    if (!cliType) {
        deps.writeLog({ level: 'warn', message: `[headlessAgentManager] Cannot resume agent ${terminalId}: unknown CLI type from command "${baseCommand}"` })
        return
    }
    const resumeCommand: string = buildResumeCommand(cliType)

    deps.incrementAuditRetryCount(terminalId)

    deps.writeLog({ level: 'info', message: `[headlessAgentManager] Resuming agent ${terminalId} (${cliType}, retry ${record.auditRetryCount + 1}/2) with deficiency prompt` })

    const shell: string = deps.getPlatform() === 'win32' ? 'powershell.exe' : (deps.getShellEnv() ?? '/bin/bash')
    const {CLAUDECODE: _cc, ...parentEnvResume} = deps.getProcessEnv()
    const terminalData: TerminalData = record.terminalData

    const child: ChildProcess = deps.spawnProcess(shell, ['-c', resumeCommand], {
        cwd: terminalData.initialSpawnDirectory ?? deps.getHomeDir() ?? deps.getCurrentDirectory(),
        env: { ...parentEnvResume, ...(terminalData.initialEnvVars ?? {}), RESUME_PROMPT: deficiency },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false
    })

    state.headlessProcesses.set(terminalId, child)
    const appendOutput: (d: Buffer) => void = appendChildOutput(terminalId, state)
    child.stdout?.on('data', appendOutput)
    child.stderr?.on('data', appendOutput)
    child.on('exit', (code: number | null) => void handleAgentExit(terminalId, code, deps, state))
}

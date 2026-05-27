import type {ChildProcess} from 'child_process'
import type {Graph} from '@vt/graph-model/graph'
import type {SupportedHeadlessCli} from '@vt/vt-daemon/agent-runtime/spawn/cli/headlessCli.ts'
import type {TerminalData, TerminalId} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts'
import type {StopHookResult} from '../hooks/stopGateHookRunner'
import type {HeadlessAgentDeps, HeadlessLogEntry} from './headlessAgentDeps'
import type {TerminalRecord} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/index.ts'

export type HeadlessLifecycleState = {
    readonly headlessProcesses: Map<TerminalId, ChildProcess>
    readonly lastOutputByTerminal: Map<TerminalId, string>
    readonly outputRingSize: number
    readonly appendRingBuffer: (previous: string, chunk: Buffer, size: number) => string
}

export type ExitFacts = {
    readonly code: number | null
    readonly output: string
    readonly spawnedChildren: boolean
    readonly terminalId: TerminalId
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
 * Pure decision function: derive diagnostic log entries from exit facts.
 * 0–2 entries. Black-box testable via table-driven cases.
 */
export function classifyExit(facts: ExitFacts): readonly HeadlessLogEntry[] {
    const {code, output, spawnedChildren, terminalId} = facts
    const hasOutput: boolean = output.trim().length > 0
    const entries: HeadlessLogEntry[] = []

    if (code !== 0 && code !== null) {
        entries.push({
            level: 'error',
            message: `[headlessAgentManager] Agent ${terminalId} exited with code ${code}. Last output: ${output.slice(-500)}`,
        })
    } else if (!hasOutput) {
        entries.push({
            level: 'warn',
            message: `[headlessAgentManager] Agent ${terminalId} exited code=${code} with ZERO output - likely silent failure`,
        })
    }

    if (hasOutput && !spawnedChildren && code === 0) {
        entries.push({
            level: 'warn',
            message: `[headlessAgentManager] Agent ${terminalId} exited without spawning a successor - possible missed handover`,
        })
    }

    return entries
}

/**
 * Side-effect-at-edge: run stop gate audit; resume with deficiency if hooks fail
 * and we're still under the retry budget. Returns whether the caller's lifecycle
 * has been "consumed" by a resume (caller must NOT delete process state).
 *
 * Retry semantics: resume only if record exists AND auditRetryCount < 2 (strict).
 */
async function runAuditAndMaybeResume(
    terminalId: TerminalId,
    deps: HeadlessAgentDeps,
    state: HeadlessLifecycleState,
): Promise<{readonly resumed: boolean}> {
    const graph: Graph = await deps.getGraph()
    const records: readonly TerminalRecord[] = deps.getTerminalRecords()
    if (hasActiveChildren(terminalId, records)) return {resumed: false}

    const hookResult: StopHookResult = await deps.runStopHooks(terminalId, graph, records)
    if (hookResult.passed) return {resumed: false}

    const record: TerminalRecord | undefined = records.find(r => r.terminalId === terminalId)
    if (record && record.auditRetryCount < 2) {
        resumeWithDeficiency(terminalId, record, hookResult.message ?? 'Stop gate hooks failed', deps, state)
        return {resumed: true}
    }

    deps.writeLog({level: 'warn', message: `[headlessAgentManager] Agent ${terminalId} FAILED audit after 2 retries`})
    return {resumed: false}
}

/**
 * Shared exit handler for both initial spawn and resumed agents.
 * Pipeline: gather facts → log decisions → mark exited → audit/resume → cleanup.
 */
export async function handleAgentExit(
    terminalId: TerminalId,
    code: number | null,
    deps: HeadlessAgentDeps,
    state: HeadlessLifecycleState,
): Promise<void> {
    const output: string = state.lastOutputByTerminal.get(terminalId) ?? ''
    const spawnedChildren: boolean = deps.getTerminalRecords().some(
        r => r.terminalData.parentTerminalId === terminalId
    )
    for (const entry of classifyExit({code, output, spawnedChildren, terminalId})) {
        deps.writeLog(entry)
    }
    deps.markTerminalExited(terminalId, code)

    if (code === 0 || code === null) {
        const {resumed} = await runAuditAndMaybeResume(terminalId, deps, state)
        if (resumed) return
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
            return `claude --continue --dangerously-skip-permissions`
        case 'codex':
            return `codex exec resume --last --full-auto`
        case 'gemini':
            return `gemini --resume latest --yolo`
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
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false
    })

    if (child.stdin) {
        child.stdin.write(deficiency)
        child.stdin.end()
    }

    state.headlessProcesses.set(terminalId, child)
    const appendOutput: (d: Buffer) => void = appendChildOutput(terminalId, state)
    child.stdout?.on('data', appendOutput)
    child.stderr?.on('data', appendOutput)
    child.on('exit', (code: number | null) => void handleAgentExit(terminalId, code, deps, state))
}

import type {ChildProcess} from 'child_process'
import type {TerminalData, TerminalId} from '../terminals/terminal-registry/types'
import {handleAgentExit, type HeadlessLifecycleState} from './headlessAgentLifecycle'
import {
    defaultHeadlessAgentDeps,
    envWithoutClaudeCode,
    resolveHeadlessShell,
    resolveSpawnCwd,
    type HeadlessAgentDeps,
} from './headlessAgentDeps'

const OUTPUT_RING_SIZE: number = 8000

const headlessProcesses: Map<TerminalId, ChildProcess> = new Map()
const lastOutputByTerminal: Map<TerminalId, string> = new Map()

function appendRingBuffer(previous: string, chunk: Buffer, size: number): string {
    return (previous + chunk.toString()).slice(-size)
}

const headlessLifecycleState: HeadlessLifecycleState = {
    headlessProcesses,
    lastOutputByTerminal,
    outputRingSize: OUTPUT_RING_SIZE,
    appendRingBuffer,
}

function captureChildOutput(terminalId: TerminalId): (d: Buffer) => void {
    return (d: Buffer): void => {
        const prev: string = lastOutputByTerminal.get(terminalId) ?? ''
        lastOutputByTerminal.set(terminalId, appendRingBuffer(prev, d, OUTPUT_RING_SIZE))
    }
}

export function stripPromptVarFromCommand(command: string): string {
    return command
        .replace(/\s+-p\s+"\$AGENT_PROMPT"/g, '')
        .replace(/\s+-p\s+'\$AGENT_PROMPT'/g, '')
        .replace(/\s+"\$AGENT_PROMPT"/g, '')
        .replace(/\s+'\$AGENT_PROMPT'/g, '')
        .trim()
}

export function spawnNodeBackedHeadlessAgent(
    terminalId: TerminalId,
    terminalData: TerminalData,
    command: string,
    cwd: string | undefined,
    env: Record<string, string>,
    deps: HeadlessAgentDeps = defaultHeadlessAgentDeps,
): void {
    const shell: string = resolveHeadlessShell(deps.getPlatform(), deps.getShellEnv())
    const parentEnv: NodeJS.ProcessEnv = envWithoutClaudeCode(deps.getProcessEnv())
    const prompt: string | undefined = env.AGENT_PROMPT
    const spawnCommand: string = prompt ? stripPromptVarFromCommand(command) : command

    const child: ChildProcess = deps.spawnProcess(shell, ['-c', spawnCommand], {
        cwd: resolveSpawnCwd(cwd, deps.getHomeDir(), deps.getCurrentDirectory()),
        env: {...parentEnv, ...env},
        stdio: [prompt ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        detached: false,
    })

    if (prompt && child.stdin) {
        child.stdin.write(prompt)
        child.stdin.end()
    }

    headlessProcesses.set(terminalId, child)
    deps.recordTerminalSpawn(terminalId, terminalData)
    deps.writeLog({level: 'info', message: `[headlessAgentManager] Spawned agent ${terminalId} (pid=${child.pid}) cwd=${cwd ?? 'HOME'}`})

    const appendOutput: (d: Buffer) => void = captureChildOutput(terminalId)
    child.stdout?.on('data', appendOutput)
    child.stderr?.on('data', appendOutput)
    child.on('exit', (code: number | null) => void handleAgentExit(terminalId, code, deps, headlessLifecycleState))
}

export function killNodeBackedHeadlessAgent(
    terminalId: TerminalId,
    deps: Pick<HeadlessAgentDeps, 'markTerminalExited'> = defaultHeadlessAgentDeps,
): boolean {
    const child: ChildProcess | undefined = headlessProcesses.get(terminalId)
    if (!child) return false

    child.kill('SIGTERM')
    deps.markTerminalExited(terminalId)
    headlessProcesses.delete(terminalId)
    return true
}

export function isNodeBackedHeadlessAgent(terminalId: TerminalId | string): boolean {
    return headlessProcesses.has(terminalId as TerminalId)
}

export function getNodeBackedHeadlessAgentOutput(terminalId: TerminalId | string): string {
    return lastOutputByTerminal.get(terminalId as TerminalId) ?? ''
}

export function hasNodeBackedHeadlessAgentOutput(terminalId: TerminalId | string): boolean {
    return lastOutputByTerminal.has(terminalId as TerminalId)
}

export function cleanupNodeBackedHeadlessAgents(
    deps: Pick<HeadlessAgentDeps, 'writeLog'> = defaultHeadlessAgentDeps,
): void {
    for (const [terminalId, child] of headlessProcesses) {
        try {
            child.kill('SIGTERM')
        } catch (e) {
            deps.writeLog({level: 'error', message: `[headlessAgentManager] Error killing headless agent ${terminalId}:`, error: e})
        }
    }
    headlessProcesses.clear()
    lastOutputByTerminal.clear()
}

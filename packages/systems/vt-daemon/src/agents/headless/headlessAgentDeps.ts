import {spawn} from 'child_process'
import {
    getTerminalRecords,
    incrementAuditRetryCount,
    markTerminalExited,
    recordTerminalSpawn,
    removeTerminalFromRegistry,
} from '@vt/vt-daemon/terminals/terminal-registry/index.ts'
import {runStopHooks} from '../hooks/stopGateHookRunner'
import {getRuntimeGraph} from '@vt/vt-daemon/runtime/graph-bridge.ts'
import {detectCliType} from '@vt/vt-daemon/spawn/cli/headlessCli.ts'

export type HeadlessLogEntry = {
    readonly level: 'info' | 'warn' | 'error'
    readonly message: string
    readonly error?: unknown
}

export type HeadlessAgentDeps = {
    readonly getPlatform: () => NodeJS.Platform
    readonly getShellEnv: () => string | undefined
    readonly getHomeDir: () => string | undefined
    readonly getCurrentDirectory: () => string
    readonly getProcessEnv: () => NodeJS.ProcessEnv
    /** Shell-supplied writer pid used as a unique-suffix for tmp-file
     * atomic renames. Threaded in (rather than read from `process.pid`)
     * so writeMetadata + its callers stay free of the transitive-purity
     * gate; the value only needs to be unique-per-writer. */
    readonly processPid: number
    readonly spawnProcess: typeof spawn
    readonly writeLog: (entry: HeadlessLogEntry) => void
    readonly recordTerminalSpawn: typeof recordTerminalSpawn
    readonly markTerminalExited: typeof markTerminalExited
    readonly getTerminalRecords: typeof getTerminalRecords
    readonly incrementAuditRetryCount: typeof incrementAuditRetryCount
    readonly removeTerminalFromRegistry: typeof removeTerminalFromRegistry
    readonly runStopHooks: typeof runStopHooks
    readonly getGraph: typeof getRuntimeGraph
    readonly detectCliType: typeof detectCliType
}

function writeHeadlessLog(entry: HeadlessLogEntry): void {
    if (entry.level === 'error') {
        entry.error === undefined ? console.error(entry.message) : console.error(entry.message, entry.error)
    } else if (entry.level === 'warn') {
        console.warn(entry.message)
    } else {
        console.log(entry.message)
    }
}

export const defaultHeadlessAgentDeps: HeadlessAgentDeps = {
    getPlatform: (): NodeJS.Platform => process.platform,
    getShellEnv: (): string | undefined => process.env.SHELL,
    getHomeDir: (): string | undefined => process.env.HOME,
    getCurrentDirectory: (): string => process.cwd(),
    getProcessEnv: (): NodeJS.ProcessEnv => process.env,
    processPid: process.pid,
    spawnProcess: spawn,
    writeLog: writeHeadlessLog,
    recordTerminalSpawn,
    markTerminalExited,
    getTerminalRecords,
    incrementAuditRetryCount,
    removeTerminalFromRegistry,
    runStopHooks,
    getGraph: getRuntimeGraph,
    detectCliType,
}

export function resolveHeadlessShell(platform: NodeJS.Platform, shellEnv: string | undefined): string {
    return platform === 'win32' ? 'powershell.exe' : (shellEnv ?? '/bin/bash')
}

export function envWithoutClaudeCode(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const {CLAUDECODE: _cc, ...parentEnv} = env
    return parentEnv
}

export function resolveSpawnCwd(cwd: string | undefined, homeDir: string | undefined, currentDirectory: string): string {
    return cwd ?? homeDir ?? currentDirectory
}

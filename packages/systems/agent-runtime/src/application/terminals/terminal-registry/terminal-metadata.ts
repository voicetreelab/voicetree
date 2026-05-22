import {randomUUID} from 'node:crypto'
import {readFileSync, renameSync, writeFileSync} from 'node:fs'
import type {TerminalData} from './types'

export type NativeRecoveryHandle = {
    readonly cli: 'claude' | 'codex'
    readonly mode: 'interactive' | 'headless'
    readonly sessionId: string
    readonly capturedAt: string  // ISO timestamp
    readonly source: 'claude-project-transcript' | 'codex-state-index'
    readonly providerStorePath?: string
}

export type TmuxTerminalMetadata = {
    readonly name: string
    readonly status: 'running' | 'exited'
    readonly pid?: number
    readonly session?: string
    readonly startedAt?: string
    readonly endedAt?: string
    readonly exitCode?: number | null
    readonly exitCodeFile?: string
    readonly logFile?: string
    readonly terminalData?: TerminalData
    readonly recovery?: {
        readonly native?: NativeRecoveryHandle
    }
}

export function readMetadata(path: string): TmuxTerminalMetadata | null {
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as TmuxTerminalMetadata
    } catch {
        return null
    }
}

export function writeMetadata(path: string, metadata: TmuxTerminalMetadata): void {
    const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`
    writeFileSync(tempPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
    renameSync(tempPath, path)
}

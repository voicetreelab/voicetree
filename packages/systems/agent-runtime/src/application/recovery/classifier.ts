import type {TerminalId} from '../terminals/terminal-registry/types'
import type {TmuxTerminalMetadata} from '../terminals/terminal-registry/terminal-metadata'
import {detectCliType} from '../spawn/headlessCli'
import {buildTmuxSessionName} from '../terminals/tmux/tmux-session-manager'
import {parseVoicetreeTmuxSessionName} from '../terminals/tmux/unclaimed-tmux'
import type {RecoveryClassification} from './types'

export type ClassifierInput = {
    /**
     * Raw parsed JSON objects (already JSON.parse'd) with their source file paths.
     * The classifier validates shape and returns `invalid` for malformed records.
     */
    readonly metadataRecords: readonly MetadataRecord[]
    /**
     * All live tmux session names visible from `listSessions`.
     */
    readonly liveTmuxSessionNames: ReadonlySet<string>
    /**
     * Terminal ids currently registered in the in-memory terminal registry.
     */
    readonly registryTerminalIds: ReadonlySet<string>
    /**
     * Namespace hash for the current vault, from `getCurrentTmuxNamespaceHash()`.
     * Null if the current vault namespace could not be resolved.
     */
    readonly currentNamespaceHash: string | null
}

export type MetadataRecord = {
    readonly path: string
    readonly data: unknown
}

function validateMetadata(data: unknown): TmuxTerminalMetadata | null {
    if (typeof data !== 'object' || data === null) return null
    const obj = data as Record<string, unknown>
    if (typeof obj.name !== 'string' || !obj.name) return null
    if (obj.status !== 'running' && obj.status !== 'exited') return null
    return data as TmuxTerminalMetadata
}

function resolveSessionName(metadata: TmuxTerminalMetadata): string {
    return metadata.session
        ?? buildTmuxSessionName(metadata.name, metadata.terminalData?.initialEnvVars ?? {})
}

function extractNamespaceHash(metadata: TmuxTerminalMetadata): string | null {
    const sessionName = resolveSessionName(metadata)
    return parseVoicetreeTmuxSessionName(sessionName)?.hash ?? null
}

function classifyRecord(record: MetadataRecord, input: ClassifierInput): RecoveryClassification {
    const metadata = validateMetadata(record.data)
    if (!metadata) return {kind: 'invalid', metadataPath: record.path}

    const terminalId = metadata.name as TerminalId

    if (metadata.status === 'exited') {
        return {kind: 'exited', terminalId, metadataPath: record.path}
    }

    if (input.registryTerminalIds.has(metadata.name)) {
        return {kind: 'claimed', terminalId, metadataPath: record.path}
    }

    if (input.currentNamespaceHash !== null) {
        const metadataHash = extractNamespaceHash(metadata)
        if (metadataHash !== null && metadataHash !== input.currentNamespaceHash) {
            return {kind: 'foreign-vault', terminalId, metadataPath: record.path}
        }
    }

    const sessionName = resolveSessionName(metadata)
    if (input.liveTmuxSessionNames.has(sessionName)) {
        return {kind: 'attachable-live-tmux', terminalId, sessionName, metadataPath: record.path}
    }

    const initialCommand = metadata.terminalData?.initialCommand
    if (!initialCommand) {
        return {kind: 'unsupported-cli', terminalId, metadataPath: record.path}
    }

    const cliType = detectCliType(initialCommand)
    if (cliType !== 'claude' && cliType !== 'codex') {
        return {kind: 'unsupported-cli', terminalId, metadataPath: record.path}
    }

    const nativeSessionId = metadata.recovery?.native?.sessionId
    if (!nativeSessionId) {
        return {kind: 'missing-native-handle', terminalId, metadataPath: record.path}
    }

    // terminalData is non-null here: initialCommand is accessed via terminalData?.initialCommand,
    // so if initialCommand is non-null, terminalData must be non-null.
    const terminalData = metadata.terminalData!

    return {
        kind: 'resumable-missing-tmux',
        terminalId,
        agentName: terminalData.agentName,
        cliType,
        nativeSessionId,
        metadataPath: record.path,
        terminalData,
    }
}

/**
 * Pure classifier for terminal metadata recovery candidates.
 *
 * Takes already-loaded inputs (no IO) and returns a classification per record.
 * Discovery (Phase 2c) is responsible for reading metadata files, listing tmux sessions,
 * and querying the registry before calling this function.
 */
export function classifyRecoveryCandidates(input: ClassifierInput): readonly RecoveryClassification[] {
    return input.metadataRecords.map((record) => classifyRecord(record, input))
}

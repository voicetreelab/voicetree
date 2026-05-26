import type {TerminalId} from '../terminals/terminal-registry/types'
import type {TmuxTerminalMetadata} from '../terminals/terminal-registry/terminal-metadata'
import type {UnclaimedTmuxSession} from '../terminals/tmux/unclaimed-tmux'
import {detectCliType} from '../spawn/cli/headlessCli'
import {buildTmuxSessionName} from '../terminals/tmux/tmux-session-manager'
import {parseVoicetreeTmuxSessionName} from '../terminals/tmux/unclaimed-tmux'
import type {AttachCapability, RecoverableAgentSession, RecoveryClassification, ResumeCapability} from './types'

export type ClassifierInput = {
    /**
     * Raw parsed JSON objects (already JSON.parse'd) with their source file paths.
     * The classifier validates shape and drops malformed records.
     */
    readonly metadataRecords: readonly MetadataRecord[]
    /**
     * Live tmux sessions visible from the unclaimed-tmux scan, keyed by session
     * name. Includes the full UnclaimedTmuxSession payload so attach rows can
     * carry it.
     */
    readonly liveTmuxSessionsByName: ReadonlyMap<string, UnclaimedTmuxSession>
    /**
     * Terminal ids currently registered in the in-memory terminal registry.
     */
    readonly registryTerminalIds: ReadonlySet<string>
    /**
     * Namespace hash for the current vault, from `getCurrentTmuxNamespaceHash()`.
     * Null if the current vault namespace could not be resolved.
     */
    readonly currentNamespaceHash: string | null
    /**
     * Resume handles already resolved by discovery (one call per supported-CLI
     * record). Map keyed by terminal id. Records absent from the map have no
     * resume capability (resolver returned not-found, or the record's CLI is
     * unsupported, or the metadata had no initialCommand).
     */
    readonly resumeHandleByTerminalId: ReadonlyMap<string, ResumeCapability>
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

function extractNamespaceHash(sessionName: string): string | null {
    return parseVoicetreeTmuxSessionName(sessionName)?.hash ?? null
}

function classifyRecord(record: MetadataRecord, input: ClassifierInput): RecoveryClassification {
    const metadata = validateMetadata(record.data)
    if (!metadata) return {kind: 'dropped', reason: 'invalid', metadataPath: record.path}

    const terminalId = metadata.name as TerminalId
    const sessionName: string = resolveSessionName(metadata)

    if (input.currentNamespaceHash !== null) {
        const metadataHash: string | null = extractNamespaceHash(sessionName)
        if (metadataHash !== null && metadataHash !== input.currentNamespaceHash) {
            return {kind: 'dropped', reason: 'foreign-vault', metadataPath: record.path}
        }
    }

    if (!metadata.terminalData) {
        // Without terminalData we can't surface a useful row — the UI needs it
        // for context node, env vars, and initial command. Treat as invalid.
        return {kind: 'dropped', reason: 'invalid', metadataPath: record.path}
    }

    const liveSession: UnclaimedTmuxSession | undefined = input.liveTmuxSessionsByName.get(sessionName)
    const attach: AttachCapability | undefined = liveSession ? {session: liveSession} : undefined
    const resume: ResumeCapability | undefined = input.resumeHandleByTerminalId.get(terminalId)

    const recoverable: RecoverableAgentSession = {
        terminalId,
        agentName: metadata.terminalData.agentName ?? metadata.name,
        metadataPath: record.path,
        terminalData: metadata.terminalData,
        isClaimed: input.registryTerminalIds.has(metadata.name),
        ...(attach ? {attach} : {}),
        ...(resume ? {resume} : {}),
    }

    return {kind: 'recoverable', record: recoverable}
}

/**
 * Pure classifier for terminal metadata recovery candidates.
 *
 * Takes already-loaded inputs (no IO) and returns one classification per
 * record. Discovery is responsible for reading metadata files, listing tmux
 * sessions, querying the registry, and resolving native session handles before
 * calling this function.
 *
 * Capabilities (`attach`, `resume`) are independent: a single record can carry
 * neither, one, or both. The classifier no longer filters records by status
 * (`exited` is fine — capabilities answer actionability) or by registry
 * membership (`isClaimed: true` is exposed so the UI can route the record to
 * the regular tab strip rather than the Surviving Agents section).
 */
export function classifyRecoveryCandidates(input: ClassifierInput): readonly RecoveryClassification[] {
    return input.metadataRecords.map((record) => classifyRecord(record, input))
}

/**
 * Convenience: which supported CLI does this metadata target (if any)?
 *
 * Used by discovery to decide whether to spend a resolver call on a record.
 * Returns null for unsupported CLIs, missing initialCommand, or invalid metadata.
 */
export function detectSupportedCliFromMetadata(metadata: TmuxTerminalMetadata): 'claude' | 'codex' | null {
    const initialCommand: string | undefined = metadata.terminalData?.initialCommand
    if (!initialCommand) return null
    const cliType = detectCliType(initialCommand)
    return cliType === 'claude' || cliType === 'codex' ? cliType : null
}

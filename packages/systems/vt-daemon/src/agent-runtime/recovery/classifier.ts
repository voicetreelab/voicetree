<<<<<<<< HEAD:packages/systems/vt-daemon/src/agent-runtime/recovery/classifier/classifier.ts
import * as O from 'fp-ts/lib/Option.js'
import {createTerminalData, type TerminalData, type TerminalId} from '../terminals/terminal-registry/types'
import type {TmuxTerminalMetadata} from '../terminals/terminal-registry/terminal-metadata'
import type {UnclaimedTmuxSession} from '../terminals/tmux/unclaimed-tmux'
import {detectCliType} from '../spawn/headlessCli'
import {buildTmuxSessionName} from '../terminals/tmux/tmux-session-manager'
import {parseVoicetreeTmuxSessionName} from '../terminals/tmux/unclaimed-tmux'
import {isoToMsOrZero} from './horizon'
========
import type {TerminalId} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts'
import type {TmuxTerminalMetadata} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/terminal-metadata.ts'
import type {UnclaimedTmuxSession} from '@vt/vt-daemon/agent-runtime/terminals/tmux/unclaimed-tmux.ts'
import {detectCliType} from '@vt/vt-daemon/agent-runtime/spawn/cli/headlessCli.ts'
import {buildTmuxSessionName} from '@vt/vt-daemon/agent-runtime/terminals/tmux/tmux-session-manager.ts'
import {parseVoicetreeTmuxSessionName} from '@vt/vt-daemon/agent-runtime/terminals/tmux/unclaimed-tmux.ts'
>>>>>>>> origin/dev:packages/systems/vt-daemon/src/agent-runtime/recovery/classifier.ts
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
    if (obj.status !== 'running' && obj.status !== 'exited' && obj.status !== 'killed') return null
    return data as TmuxTerminalMetadata
}

function stringField(obj: Record<string, unknown>, field: string): string | undefined {
    const value: unknown = obj[field]
    return typeof value === 'string' && value.length > 0 ? value : undefined
}

function booleanField(obj: Record<string, unknown>, field: string): boolean | undefined {
    const value: unknown = obj[field]
    return typeof value === 'boolean' ? value : undefined
}

function numberField(obj: Record<string, unknown>, field: string): number | undefined {
    const value: unknown = obj[field]
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringRecordField(obj: Record<string, unknown>, field: string): Record<string, string> | undefined {
    const value: unknown = obj[field]
    if (typeof value !== 'object' || value === null) return undefined
    const entries: [string, string][] = []
    for (const [key, entryValue] of Object.entries(value)) {
        if (typeof entryValue === 'string') entries.push([key, entryValue])
    }
    return Object.fromEntries(entries)
}

function dimensionsField(obj: Record<string, unknown>): {readonly width: number; readonly height: number} | undefined {
    const value: unknown = obj.shadowNodeDimensions
    if (typeof value !== 'object' || value === null) return undefined
    const dimensions = value as Record<string, unknown>
    const width: number | undefined = numberField(dimensions, 'width')
    const height: number | undefined = numberField(dimensions, 'height')
    return width !== undefined && height !== undefined ? {width, height} : undefined
}

function anchoredNodeIdField(obj: Record<string, unknown>, env: Record<string, string> | undefined): string | undefined {
    const value: unknown = obj.anchoredToNodeId
    if (typeof value === 'object' && value !== null) {
        const option = value as O.Option<string>
        if (O.isSome(option)) return option.value
    }
    return env?.TASK_NODE_PATH
}

function parentTerminalIdField(obj: Record<string, unknown>): TerminalId | null | undefined {
    if (obj.parentTerminalId === null) return null
    const value: unknown = obj.parentTerminalId
    return typeof value === 'string' ? value as TerminalId : undefined
}

function normalizeMetadataTerminalData(metadata: TmuxTerminalMetadata): TerminalData | null {
    const raw: unknown = metadata.terminalData
    if (typeof raw !== 'object' || raw === null) return null
    const obj = raw as Record<string, unknown>
    const env: Record<string, string> | undefined = stringRecordField(obj, 'initialEnvVars')
    const attachedToNodeId: string | undefined =
        stringField(obj, 'attachedToContextNodeId')
        ?? env?.CONTEXT_NODE_PATH
        ?? env?.TASK_NODE_PATH
    if (!attachedToNodeId) return null

    const terminalId: TerminalId = (stringField(obj, 'terminalId') ?? metadata.name) as TerminalId
    return createTerminalData({
        terminalId,
        attachedToNodeId,
        terminalCount: numberField(obj, 'terminalCount') ?? 0,
        title: stringField(obj, 'title') ?? stringField(obj, 'agentName') ?? metadata.name,
        anchoredToNodeId: anchoredNodeIdField(obj, env),
        initialEnvVars: env,
        initialSpawnDirectory: stringField(obj, 'initialSpawnDirectory'),
        initialCommand: stringField(obj, 'initialCommand'),
        executeCommand: booleanField(obj, 'executeCommand'),
        resizable: booleanField(obj, 'resizable'),
        shadowNodeDimensions: dimensionsField(obj),
        isPinned: booleanField(obj, 'isPinned'),
        parentTerminalId: parentTerminalIdField(obj),
        agentName: stringField(obj, 'agentName') ?? metadata.name,
        worktreeName: stringField(obj, 'worktreeName'),
        isHeadless: booleanField(obj, 'isHeadless'),
        isMinimized: booleanField(obj, 'isMinimized'),
        contextContent: stringField(obj, 'contextContent'),
        agentTypeName: stringField(obj, 'agentTypeName'),
    })
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

    const terminalData: TerminalData | null = normalizeMetadataTerminalData(metadata)
    if (!terminalData) {
        // Without terminalData we can't surface a useful row — the UI needs it
        // for context node, env vars, and initial command. Treat as invalid.
        return {kind: 'dropped', reason: 'invalid', metadataPath: record.path}
    }

    const liveSession: UnclaimedTmuxSession | undefined = input.liveTmuxSessionsByName.get(sessionName)
    const attach: AttachCapability | undefined = liveSession ? {session: liveSession} : undefined
    const resume: ResumeCapability | undefined = input.resumeHandleByTerminalId.get(terminalId)

    const worktreeName: string | undefined = terminalData.worktreeName
    const title: string | undefined = terminalData.title && terminalData.title.length > 0 ? terminalData.title : undefined
    const agentTypeName: string | undefined = terminalData.agentTypeName && terminalData.agentTypeName.length > 0 ? terminalData.agentTypeName : undefined
    const killReason: string | undefined = typeof metadata.killReason === 'string' && metadata.killReason.length > 0 ? metadata.killReason : undefined
    const endedAtMs: number = isoToMsOrZero(metadata.endedAt)

    const recoverable: RecoverableAgentSession = {
        terminalId,
        agentName: terminalData.agentName ?? metadata.name,
        metadataPath: record.path,
        terminalData,
        isClaimed: input.registryTerminalIds.has(metadata.name),
        status: metadata.status,
        ...(attach ? {attach} : {}),
        ...(resume ? {resume} : {}),
        ...(worktreeName ? {worktreeName} : {}),
        ...(title ? {title} : {}),
        ...(agentTypeName ? {agentTypeName} : {}),
        ...(metadata.startedAt ? {startedAt: metadata.startedAt} : {}),
        ...(metadata.endedAt ? {endedAt: metadata.endedAt} : {}),
        ...(endedAtMs > 0 ? {closedAt: endedAtMs} : {}),
        ...(killReason ? {killReason} : {}),
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

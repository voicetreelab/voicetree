import {existsSync, readFileSync, renameSync, rmSync, writeFileSync} from 'fs'
import type {NodeSearchHit} from '@vt/graph-model'
import type {
    FilesystemAuthoringFix,
    FilesystemAuthoringReportEntry,
    FilesystemAuthoringValidationError,
    StructureManifest,
} from '@vt/graph-tools/node'

export type GraphCreateNode = Record<string, unknown> & {
    filename: string
    title: string
    summary: string
    content?: string
    color?: string
}

export type GraphCreateResult = {
    id: string
    path: string
    status: 'ok' | 'warning'
    warning?: string
}

export type GraphCreateSuccess = {
    success: true
    nodes: GraphCreateResult[]
    hint?: string
}

export type FilesystemCreateSuccess = {
    success: true
    mode: 'filesystem'
    validateOnly?: true
    nodes: Array<{
        path: string
        status: 'ok'
        fixes?: readonly FilesystemAuthoringFix[]
    }>
}

export type FilesystemCreateFailure = {
    success: false
    mode: 'filesystem'
    errors: readonly FilesystemAuthoringValidationError[]
    reports: readonly FilesystemAuthoringReportEntry[]
}

export type GraphUnseenNode = {
    nodeId: string
    title: string
}

export type GraphUnseenSuccess = {
    success: true
    contextNodeId: string
    unseenNodes: GraphUnseenNode[]
}

export type ToolFailure = {
    success: false
    error: string
}

export type GraphIndexSuccess = {
    success: true
    vaultPath: string
    indexPath: string
}

export type GraphSearchSuccess = {
    success: true
    vaultPath: string
    query: string
    topK: number
    hits: readonly NodeSearchHit[]
}

export type GraphCreatePayload = {
    callerTerminalId?: string
    parentNodeId?: string
    nodes?: unknown
    override_with_rationale?: unknown
}

export type ParsedFilesystemCreateArgs = {
    inputFilePaths: string[]
    parentPath?: string
    color?: string
    manifest?: StructureManifest
}

export type ParsedLiveCreateArgs = {
    mode: 'live'
    nodesFile?: string
    inlineNodeSpecs: string[]
    parentNodeId?: string
    color?: string
    validateOnly: boolean
}

export type ParsedFilesystemModeArgs = ParsedFilesystemCreateArgs & {
    mode: 'filesystem'
    validateOnly: boolean
}

export type ParsedGraphCreateArgs = ParsedLiveCreateArgs | ParsedFilesystemModeArgs

export type GraphFilesystemOps = {
    existsSync: typeof existsSync
    readFileSync: typeof readFileSync
    renameSync: typeof renameSync
    rmSync: typeof rmSync
    writeFileSync: typeof writeFileSync
}

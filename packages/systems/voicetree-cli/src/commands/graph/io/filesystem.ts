import {existsSync, readFileSync, renameSync, rmSync, writeFileSync} from 'fs'
import type {
    FilesystemAuthoringFix,
    FilesystemAuthoringInput,
    FilesystemAuthoringPlanEntry,
} from '@vt/graph-tools/node-runtime'
import {error} from '../cliDeps'
import type {
    GraphCreateNode,
    GraphFilesystemOps,
} from '../core/types'
import {getErrorMessage, isRecord, normalizeRef} from '../core/util'

const defaultGraphFilesystemOps: GraphFilesystemOps = {
    existsSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
}

let graphFilesystemOps: GraphFilesystemOps = defaultGraphFilesystemOps

export function readGraphFileUtf8(filePath: string): string {
    return graphFilesystemOps.readFileSync(filePath, 'utf8')
}

export function loadNodesFromFile(filePath: string, color?: string): GraphCreateNode[] {
    let fileContents: string
    try {
        fileContents = readGraphFileUtf8(filePath)
    } catch (readError: unknown) {
        if (isRecord(readError) && readError.code === 'ENOENT') {
            error(`Nodes file not found: ${filePath}`)
        }

        error(`Failed to read nodes file ${filePath}: ${getErrorMessage(readError)}`)
    }

    let parsed: unknown
    try {
        parsed = JSON.parse(fileContents)
    } catch (parseError: unknown) {
        error(`Nodes file is not valid JSON: ${getErrorMessage(parseError)}`)
    }

    if (!Array.isArray(parsed)) {
        error(`Nodes file must contain a JSON array: ${filePath}`)
    }

    return parsed.map((node: unknown, index: number): GraphCreateNode => {
        if (!isRecord(node)) {
            error(`Node at index ${index} in ${filePath} must be a JSON object`)
        }

        const result: GraphCreateNode = node as GraphCreateNode
        if (color && result.color === undefined) {
            return {
                ...result,
                color,
            }
        }

        return result
    })
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function appendParentRef(markdown: string, parentRef: string): string {
    const parentLine: string = `- parent [[${parentRef}]]`
    const existingParentPattern: RegExp = new RegExp(`^${escapeRegExp(parentLine)}$`, 'm')
    if (existingParentPattern.test(markdown)) {
        return markdown
    }

    const trimmedMarkdown: string = markdown.trimEnd()
    if (!trimmedMarkdown) {
        return `${parentLine}\n`
    }

    return `${trimmedMarkdown}\n\n${parentLine}\n`
}

export function loadFilesystemInputs(inputFilePaths: readonly string[]): FilesystemAuthoringInput[] {
    return inputFilePaths.map((filePath: string) => {
        let markdown: string
        try {
            markdown = readGraphFileUtf8(filePath)
        } catch (readError: unknown) {
            error(`Failed to read markdown input ${filePath}: ${getErrorMessage(readError)}`)
        }

        return {
            filename: filePath,
            markdown,
        }
    })
}

export function validateExternalParent(parentPath: string, inputFilePaths: readonly string[]): string {
    const parentRef: string = normalizeRef(parentPath)
    const inputRefs: Set<string> = new Set(inputFilePaths.map(normalizeRef))

    if (!inputRefs.has(parentRef) && !graphFilesystemOps.existsSync(parentPath)) {
        error(`Parent file not found: ${parentPath}`)
    }

    return parentRef
}

export type AppliedNode = {
    readonly path: string
    readonly fixes: readonly FilesystemAuthoringFix[]
}

export function applyFilesystemPlan(
    writePlan: readonly FilesystemAuthoringPlanEntry[],
    externalParentRef: string | undefined
): readonly AppliedNode[] {
    const finalEntries: Array<{
        path: string
        markdown: string
        fixes: readonly FilesystemAuthoringFix[]
    }> = writePlan.map((entry) => {
        const shouldAttachExternalParent: boolean =
            externalParentRef !== undefined &&
            entry.parentFilenames.length === 0 &&
            normalizeRef(entry.filename) !== externalParentRef

        return {
            path: entry.filename,
            fixes: entry.fixes,
            markdown:
                shouldAttachExternalParent && externalParentRef
                    ? appendParentRef(entry.markdown, externalParentRef)
                    : entry.markdown,
        }
    })

    const operationId: string = `${process.pid}-${Date.now()}`
    const stagedEntries: Array<{
        path: string
        markdown: string
        fixes: readonly FilesystemAuthoringFix[]
        stagePath: string
        backupPath?: string
    }> = finalEntries.map((entry, index) => ({
        ...entry,
        stagePath: `${entry.path}.vt-graph-create-stage-${operationId}-${index}`,
        ...(graphFilesystemOps.existsSync(entry.path)
            ? {backupPath: `${entry.path}.vt-graph-create-backup-${operationId}-${index}`}
            : {}),
    }))

    const cleanupTempArtifacts: (entries: readonly {stagePath: string; backupPath?: string}[]) => void = (entries) => {
        for (const entry of entries) {
            graphFilesystemOps.rmSync(entry.stagePath, {force: true})
            if (entry.backupPath) {
                graphFilesystemOps.rmSync(entry.backupPath, {force: true})
            }
        }
    }

    const rollbackAppliedEntries: (entries: readonly {path: string; backupPath?: string}[]) => void = (entries) => {
        for (const entry of [...entries].reverse()) {
            if (entry.backupPath) {
                graphFilesystemOps.renameSync(entry.backupPath, entry.path)
                continue
            }

            graphFilesystemOps.rmSync(entry.path, {force: true})
        }
    }

    try {
        for (const entry of stagedEntries) {
            graphFilesystemOps.writeFileSync(entry.stagePath, entry.markdown, 'utf8')
            if (entry.backupPath) {
                graphFilesystemOps.writeFileSync(
                    entry.backupPath,
                    readGraphFileUtf8(entry.path),
                    'utf8'
                )
            }
        }

        const appliedEntries: typeof stagedEntries = []

        try {
            for (const entry of stagedEntries) {
                graphFilesystemOps.renameSync(entry.stagePath, entry.path)
                appliedEntries.push(entry)
            }
        } catch (writeError: unknown) {
            rollbackAppliedEntries(appliedEntries)
            throw writeError
        }

        cleanupTempArtifacts(stagedEntries)
    } catch (writeError: unknown) {
        cleanupTempArtifacts(stagedEntries)
        throw new Error(`Failed to apply filesystem authoring plan: ${getErrorMessage(writeError)}`)
    }

    return finalEntries.map(({path, fixes}) => ({path, fixes}))
}

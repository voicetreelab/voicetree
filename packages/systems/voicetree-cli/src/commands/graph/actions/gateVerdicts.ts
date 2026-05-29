import {dirname, isAbsolute, join, relative as relativePath, resolve as resolvePath} from 'node:path'
import {buildMarkdownBody, type FilesystemAuthoringInput} from '@vt/graph-tools/node'
import {runSchemaGate, type SchemaGateResult} from '../core/schemaGate'
import {detectProjectFromCwd} from '../cliDeps'
import type {GraphCreateNode, NodeVerdict} from '../core/types'

/**
 * `path` is the user-facing relative-to-cwd path that appears in the emitted
 * verdict (and in `verdict.path`). `absoluteTargetForMerge` is the absolute
 * filesystem path the MCP response keys off of in live mode — held separately
 * so the merge step doesn't need to round-trip through the display string.
 */
export type GatedInput = {
    readonly path: string
    readonly absoluteTargetForMerge: string | undefined
    readonly verdict: NodeVerdict
}

function absoluteFromCwd(targetPath: string): string {
    return isAbsolute(targetPath) ? targetPath : resolvePath(process.cwd(), targetPath)
}

function relativeToCwd(absoluteTarget: string): string {
    return relativePath(process.cwd(), absoluteTarget)
}

function verdictFromGateResult(displayPath: string, result: SchemaGateResult): NodeVerdict {
    if (result.status === 'ok') {
        // `typeName`/`schemaPath` are only present when the gate actually ran
        // against an upstream folder-note Type. A silent `ok` (typeless folder)
        // omits them so the emitted verdict stays minimal — no spurious empty
        // fields in the JSON envelope.
        return {
            path: displayPath,
            status: 'ok',
            ...(result.typeName ? {typeName: result.typeName} : {}),
            ...(result.schemaPath ? {schemaPath: result.schemaPath} : {}),
        }
    }

    if (result.status === 'skipped') {
        return {path: displayPath, status: 'skipped', skipReason: result.reason}
    }

    return {
        path: displayPath,
        status: 'rejected',
        typeName: result.violation.typeName,
        schemaPath: result.violation.schemaPath,
        ruleIds: result.violation.violations.map((v) => v.ruleId),
    }
}

export async function collectFilesystemGateVerdicts(
    inputs: readonly FilesystemAuthoringInput[],
): Promise<readonly GatedInput[]> {
    const verdicts: GatedInput[] = []
    for (const fileInput of inputs) {
        const absoluteTarget: string = absoluteFromCwd(fileInput.filename)
        const projectRoot: string | null = detectProjectFromCwd(dirname(absoluteTarget))

        if (projectRoot === null) {
            verdicts.push({
                path: fileInput.filename,
                absoluteTargetForMerge: absoluteTarget,
                verdict: {
                    path: fileInput.filename,
                    status: 'skipped',
                    skipReason: 'no_project_detected',
                },
            })
            continue
        }

        const result: SchemaGateResult = await runSchemaGate({
            targetPath: absoluteTarget,
            rawBody: fileInput.markdown,
            projectRoot,
        })
        verdicts.push({
            path: fileInput.filename,
            absoluteTargetForMerge: absoluteTarget,
            verdict: verdictFromGateResult(fileInput.filename, result),
        })
    }

    return verdicts
}

function assembleLiveBody(node: GraphCreateNode, defaultColor: string | undefined): string {
    const color: string = typeof node.color === 'string' && node.color.length > 0
        ? node.color
        : defaultColor ?? 'blue'

    return buildMarkdownBody({
        title: String(node.title ?? ''),
        summary: String(node.summary ?? ''),
        ...(typeof node.content === 'string' ? {content: node.content} : {}),
        color,
        agentName: process.env.AGENT_NAME ?? '',
        parentLinks: [],
    })
}

function liveTargetFilename(node: GraphCreateNode): string {
    const filename: string = typeof node.filename === 'string' && node.filename.length > 0
        ? node.filename
        : 'node'
    return filename.endsWith('.md') ? filename : `${filename}.md`
}

/**
 * Live-mode verdict paths are relative-to-cwd so they unify with filesystem-mode
 * verdicts (which carry the user-typed path). When no parentNodeId is supplied,
 * there is no resolvable absolute target — display the bare filename and leave
 * `absoluteTargetForMerge` undefined (these verdicts always end up `skipped`).
 */
type LivePaths = {
    readonly displayPath: string
    readonly absoluteTarget: string | undefined
}

function resolveLivePaths(node: GraphCreateNode, parentNodeId: string | undefined): LivePaths {
    const fileWithExt: string = liveTargetFilename(node)
    if (parentNodeId === undefined) {
        return {displayPath: fileWithExt, absoluteTarget: undefined}
    }
    const absoluteTarget: string = join(dirname(parentNodeId), fileWithExt)
    return {displayPath: relativeToCwd(absoluteTarget), absoluteTarget}
}

export async function collectLiveGateVerdicts(
    nodes: readonly GraphCreateNode[],
    parentNodeId: string | undefined,
    defaultColor: string | undefined,
): Promise<readonly GatedInput[]> {
    const projectRoot: string | null = detectProjectFromCwd(process.cwd())
    const verdicts: GatedInput[] = []

    for (const node of nodes) {
        const {displayPath, absoluteTarget} = resolveLivePaths(node, parentNodeId)

        if (projectRoot === null) {
            verdicts.push({
                path: displayPath,
                absoluteTargetForMerge: absoluteTarget,
                verdict: {path: displayPath, status: 'skipped', skipReason: 'no_project_detected'},
            })
            continue
        }

        if (absoluteTarget === undefined) {
            verdicts.push({
                path: displayPath,
                absoluteTargetForMerge: undefined,
                verdict: {
                    path: displayPath,
                    status: 'skipped',
                    skipReason: 'no_parent_for_live_node',
                },
            })
            continue
        }

        const result: SchemaGateResult = await runSchemaGate({
            targetPath: absoluteTarget,
            rawBody: assembleLiveBody(node, defaultColor),
            projectRoot,
        })
        verdicts.push({
            path: displayPath,
            absoluteTargetForMerge: absoluteTarget,
            verdict: verdictFromGateResult(displayPath, result),
        })
    }

    return verdicts
}

export function anyGateRejected(verdicts: readonly GatedInput[]): boolean {
    return verdicts.some((g) => g.verdict.status === 'rejected')
}

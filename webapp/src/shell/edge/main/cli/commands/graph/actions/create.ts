import {dirname, isAbsolute, join, resolve as resolvePath} from 'node:path'
import {buildFilesystemAuthoringPlan, buildMarkdownBody, type FilesystemAuthoringInput} from '@vt/graph-tools/node'
import {callMcpTool} from '@/shell/edge/main/cli/commands/graph/core/graphCliDependencies'
import {error, output} from '@/shell/edge/main/cli/commands/graph/core/graphCliDependencies'
import {
    getErrorMessage,
    parseGraphCreateArgs,
    parseInlineNode,
    requireTerminalId,
} from '@/shell/edge/main/cli/commands/graph/core/args'
import {detectVaultFromCwd} from '@/shell/edge/main/cli/util/detectVault'
import {emitSchemaViolation, runSchemaGate, type SchemaGateResult} from '@/shell/edge/main/cli/commands/graph/core/schemaGate'
import {
    applyFilesystemPlan,
    failFilesystemCreateValidation,
    formatFilesystemCreateSuccessHuman,
    loadFilesystemInputs,
    loadNodesFromFile,
    validateExternalParent,
} from '@/shell/edge/main/cli/commands/graph/io/filesystem'
import {readCreateGraphPayloadFromStdin} from '@/shell/edge/main/cli/commands/graph/io/stdin'
import type {
    FilesystemCreateSuccess,
    GraphCreateNode,
    GraphCreateSuccess,
    ParsedGraphCreateArgs,
    ToolFailure,
} from '@/shell/edge/main/cli/commands/graph/core/types'

function absoluteFromCwd(targetPath: string): string {
    return isAbsolute(targetPath) ? targetPath : resolvePath(process.cwd(), targetPath)
}

async function gateOrExit(input: {targetPath: string; rawBody: string; vaultRoot: string}): Promise<void> {
    const result: SchemaGateResult = await runSchemaGate(input)
    if (result.status === 'rejected') {
        emitSchemaViolation(result.violation)
        process.exit(1)
    }
}

async function gateFilesystemInputs(inputs: readonly FilesystemAuthoringInput[]): Promise<void> {
    for (const fileInput of inputs) {
        const absoluteTarget: string = absoluteFromCwd(fileInput.filename)
        const vaultRoot: string | null = detectVaultFromCwd(dirname(absoluteTarget))
        if (vaultRoot === null) continue

        await gateOrExit({
            targetPath: absoluteTarget,
            rawBody: fileInput.markdown,
            vaultRoot,
        })
    }
}

function assembleLiveBody(node: GraphCreateNode, defaultColor: string | undefined): string {
    const color: string = typeof node.color === 'string' && node.color.length > 0
        ? node.color
        : defaultColor ?? 'blue'

    return buildMarkdownBody({
        title: String(node.title ?? ''),
        summary: String(node.summary ?? ''),
        content: typeof node.content === 'string' ? node.content : undefined,
        codeDiffs: undefined,
        filesChanged: undefined,
        diagram: undefined,
        notes: undefined,
        linkedArtifacts: undefined,
        complexityScore: undefined,
        complexityExplanation: undefined,
        color,
        agentName: process.env.AGENT_NAME ?? '',
        parentLinks: [],
    })
}

function liveTargetPath(node: GraphCreateNode, parentNodeId: string | undefined): string | undefined {
    if (parentNodeId === undefined) return undefined

    const filename: string = typeof node.filename === 'string' && node.filename.length > 0
        ? node.filename
        : 'node'
    const filenameWithExt: string = filename.endsWith('.md') ? filename : `${filename}.md`
    const parentDir: string = dirname(parentNodeId)
    return join(parentDir, filenameWithExt)
}

async function gateLiveNodes(
    nodes: readonly GraphCreateNode[],
    parentNodeId: string | undefined,
    defaultColor: string | undefined
): Promise<void> {
    const vaultRoot: string | null = detectVaultFromCwd()
    if (vaultRoot === null) return

    for (const node of nodes) {
        const targetPath: string | undefined = liveTargetPath(node, parentNodeId)
        if (targetPath === undefined) continue

        await gateOrExit({
            targetPath,
            rawBody: assembleLiveBody(node, defaultColor),
            vaultRoot,
        })
    }
}

export async function graphCreate(port: number, terminalId: string | undefined, args: string[]): Promise<void> {
    const parsedArgs: ParsedGraphCreateArgs = parseGraphCreateArgs(args)

    if (parsedArgs.mode === 'live' && parsedArgs.validateOnly) {
        error('The --validate-only flag is only supported for filesystem markdown inputs')
    }

    if (
        parsedArgs.mode === 'live' &&
        !process.stdin.isTTY &&
        !parsedArgs.nodesFile &&
        parsedArgs.inlineNodeSpecs.length === 0
    ) {
        const payload = await readCreateGraphPayloadFromStdin(terminalId)
        await gateLiveNodes(payload.nodes, payload.parentNodeId, parsedArgs.color)

        try {
            const response: unknown = await callMcpTool(port, 'create_graph', payload)
            const result: GraphCreateSuccess | ToolFailure = response as GraphCreateSuccess | ToolFailure
            if (!result.success) {
                error(result.error)
            }

            output(result)
        } catch (toolError: unknown) {
            error(`create_graph failed: ${getErrorMessage(toolError)}`)
        }

        return
    }

    if (parsedArgs.mode === 'filesystem') {
        const filesystemInputs: FilesystemAuthoringInput[] = loadFilesystemInputs(parsedArgs.inputFilePaths)
        await gateFilesystemInputs(filesystemInputs)

        const externalParentRef: string | undefined = parsedArgs.parentPath
            ? validateExternalParent(parsedArgs.parentPath, parsedArgs.inputFilePaths)
            : undefined
        const planResult: ReturnType<typeof buildFilesystemAuthoringPlan> = buildFilesystemAuthoringPlan({
            inputs: filesystemInputs,
            ...(parsedArgs.manifest ? {manifest: parsedArgs.manifest} : {}),
            agentName: process.env.AGENT_NAME,
            defaultColor: parsedArgs.color ?? 'blue',
        })

        if (planResult.status !== 'ok') {
            failFilesystemCreateValidation(planResult.errors, planResult.reports)
        }

        if (parsedArgs.validateOnly) {
            const result: FilesystemCreateSuccess = {
                success: true,
                mode: 'filesystem',
                validateOnly: true,
                nodes: planResult.writePlan.map(({filename, fixes}) => ({
                    path: filename,
                    status: 'ok',
                    ...(fixes.length > 0 ? {fixes} : {}),
                })),
            }

            output(result, formatFilesystemCreateSuccessHuman)
            return
        }

        let result: FilesystemCreateSuccess
        try {
            result = applyFilesystemPlan(planResult.writePlan, externalParentRef)
        } catch (writeError: unknown) {
            error(getErrorMessage(writeError))
        }

        output(result, formatFilesystemCreateSuccessHuman)
        return
    }

    const callerTerminalId: string = requireTerminalId(terminalId)

    if (parsedArgs.nodesFile && parsedArgs.inlineNodeSpecs.length > 0) {
        error('Use either --nodes-file or --node, not both')
    }

    if (!parsedArgs.nodesFile && parsedArgs.inlineNodeSpecs.length === 0) {
        error('graph create requires filesystem markdown inputs, --nodes-file FILE, or at least one --node value')
    }

    const nodes: GraphCreateNode[] = parsedArgs.nodesFile
        ? loadNodesFromFile(parsedArgs.nodesFile, parsedArgs.color)
        : parsedArgs.inlineNodeSpecs.map((spec: string) => parseInlineNode(spec, parsedArgs.color))

    if (nodes.length === 0) {
        error('graph create requires at least one node')
    }

    await gateLiveNodes(nodes, parsedArgs.parentNodeId, parsedArgs.color)

    try {
        const response: unknown = await callMcpTool(port, 'create_graph', {
            callerTerminalId,
            ...(parsedArgs.parentNodeId ? {parentNodeId: parsedArgs.parentNodeId} : {}),
            nodes,
        })
        const result: GraphCreateSuccess | ToolFailure = response as GraphCreateSuccess | ToolFailure
        if (!result.success) {
            error(result.error)
        }

        output(result)
    } catch (toolError: unknown) {
        error(`create_graph failed: ${getErrorMessage(toolError)}`)
    }
}

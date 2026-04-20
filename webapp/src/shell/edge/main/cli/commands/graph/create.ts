import {buildFilesystemAuthoringPlan, type FilesystemAuthoringInput} from '@vt/graph-tools/node'
import {callMcpTool} from '../../mcp-client.ts'
import {error, output} from '../../output.ts'
import {
    getErrorMessage,
    parseGraphCreateArgs,
    parseInlineNode,
    requireTerminalId,
} from './args.ts'
import {
    applyFilesystemPlan,
    failFilesystemCreateValidation,
    formatFilesystemCreateSuccessHuman,
    loadFilesystemInputs,
    loadNodesFromFile,
    validateExternalParent,
} from './filesystem.ts'
import {readCreateGraphPayloadFromStdin} from './stdin.ts'
import type {
    FilesystemCreateSuccess,
    GraphCreateNode,
    GraphCreateSuccess,
    ParsedGraphCreateArgs,
    ToolFailure,
} from './types.ts'

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

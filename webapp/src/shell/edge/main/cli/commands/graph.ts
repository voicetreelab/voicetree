import {readFileSync} from 'fs'
import {callMcpTool} from '@/shell/edge/main/cli/mcp-client'
import {error, output, isJsonMode} from '@/shell/edge/main/cli/output'
import {getGraphStructure, lintGraph, formatLintReportHuman, formatLintReportJson, DEFAULT_LINT_CONFIG} from '@vt/graph-tools'
import type {LintConfig} from '@vt/graph-tools'

type GraphCreateNode = Record<string, unknown> & {
    filename: string
    title: string
    summary: string
    content?: string
    color?: string
}

type GraphCreateResult = {
    id: string
    path: string
    status: 'ok' | 'warning'
    warning?: string
}

type GraphCreateSuccess = {
    success: true
    nodes: GraphCreateResult[]
    hint?: string
}

type GraphUnseenNode = {
    nodeId: string
    title: string
}

type GraphUnseenSuccess = {
    success: true
    contextNodeId: string
    unseenNodes: GraphUnseenNode[]
}

type ToolFailure = {
    success: false
    error: string
}

type GraphCreatePayload = {
    callerTerminalId?: string
    parentNodeId?: string
    nodes?: unknown
    override_with_rationale?: unknown
}

function titleToFilename(title: string): string {
    const normalizedTitle: string = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40)

    return normalizedTitle || 'node'
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function getRequiredValue(args: string[], index: number, flag: string): string {
    const value: string | undefined = args[index]
    if (!value) {
        error(`${flag} requires a value`)
    }

    return value
}

function parseInlineNode(spec: string, color?: string): GraphCreateNode {
    const parts: string[] = spec.split('::')
    if (parts.length < 2) {
        error(`Invalid --node value "${spec}". Use title::summary or title::summary::content`)
    }

    const [rawTitle, rawSummary, ...rawContent] = parts
    const title: string = rawTitle.trim()
    const summary: string = rawSummary.trim()
    if (!title || !summary) {
        error(`Invalid --node value "${spec}". Title and summary must be non-empty`)
    }

    const node: GraphCreateNode = {
        filename: titleToFilename(title),
        title,
        summary,
    }

    const content: string = rawContent.join('::').trim()
    if (content) {
        node.content = content
    }
    if (color) {
        node.color = color
    }

    return node
}

function getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}

function readCreateGraphPayloadFromStdin(terminalId: string | undefined): {
    callerTerminalId: string
    parentNodeId?: string
    nodes: GraphCreateNode[]
    override_with_rationale?: unknown
} {
    let rawPayload: string
    try {
        rawPayload = readFileSync(0, 'utf8').trim()
    } catch (readError: unknown) {
        error(`Failed to read graph create payload from stdin: ${getErrorMessage(readError)}`)
    }

    if (!rawPayload) {
        error('Stdin was empty. Provide create_graph JSON payload.')
    }

    let payload: unknown
    try {
        payload = JSON.parse(rawPayload)
    } catch (parseError: unknown) {
        error(`Stdin is not valid JSON: ${getErrorMessage(parseError)}`)
    }

    if (!isRecord(payload)) {
        error('Stdin JSON payload must be an object')
    }

    const typedPayload: GraphCreatePayload = payload
    const callerTerminalId: string | undefined =
        typeof typedPayload.callerTerminalId === 'string' ? typedPayload.callerTerminalId : terminalId

    if (!callerTerminalId) {
        error('graph create via stdin requires callerTerminalId in payload or --terminal')
    }

    if (
        typedPayload.parentNodeId !== undefined &&
        typeof typedPayload.parentNodeId !== 'string'
    ) {
        error('parentNodeId must be a string')
    }

    const parentNodeId: string | undefined = typedPayload.parentNodeId

    if (!Array.isArray(typedPayload.nodes)) {
        error('graph create via stdin requires nodes: GraphCreateNode[]')
    }

    const nodes: GraphCreateNode[] = typedPayload.nodes.map((node: unknown, index: number) => {
        if (!isRecord(node)) {
            error(`Stdin node at index ${index} must be a JSON object`)
        }

        return node as GraphCreateNode
    })

    if (parentNodeId !== undefined && parentNodeId.length === 0) {
        error('parentNodeId must be a non-empty string')
    }

    return {
        callerTerminalId,
        ...(parentNodeId !== undefined ? {parentNodeId} : {}),
        nodes,
        ...(typedPayload.override_with_rationale !== undefined
            ? {override_with_rationale: typedPayload.override_with_rationale}
            : {}),
    }
}

function loadNodesFromFile(filePath: string, color?: string): GraphCreateNode[] {
    let fileContents: string
    try {
        fileContents = readFileSync(filePath, 'utf8')
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

function requireTerminalId(terminalId: string | undefined): string {
    if (!terminalId) {
        error('This command requires --terminal or VOICETREE_TERMINAL_ID')
    }

    return terminalId
}

export async function graphCreate(port: number, terminalId: string | undefined, args: string[]): Promise<void> {
    const callerTerminalId: string = requireTerminalId(terminalId)

    let nodesFile: string | undefined
    const inlineNodeSpecs: string[] = []
    let parentNodeId: string | undefined
    let color: string | undefined

    if (!process.stdin.isTTY) {
        const payload: ReturnType<typeof readCreateGraphPayloadFromStdin> = readCreateGraphPayloadFromStdin(terminalId)
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

    for (let index: number = 0; index < args.length; index += 1) {
        const arg: string = args[index]
        if (arg === '--nodes-file') {
            nodesFile = getRequiredValue(args, index + 1, '--nodes-file')
            index += 1
            continue
        }

        if (arg === '--node') {
            inlineNodeSpecs.push(getRequiredValue(args, index + 1, '--node'))
            index += 1
            continue
        }

        if (arg === '--parent') {
            parentNodeId = getRequiredValue(args, index + 1, '--parent')
            index += 1
            continue
        }

        if (arg === '--color') {
            color = getRequiredValue(args, index + 1, '--color')
            index += 1
            continue
        }

        error(`Unknown argument: ${arg}`)
    }

    if (nodesFile && inlineNodeSpecs.length > 0) {
        error('Use either --nodes-file or --node, not both')
    }

    if (!nodesFile && inlineNodeSpecs.length === 0) {
        error('graph create requires either --nodes-file FILE or at least one --node value')
    }

    const nodes: GraphCreateNode[] = nodesFile
        ? loadNodesFromFile(nodesFile, color)
        : inlineNodeSpecs.map((spec: string) => parseInlineNode(spec, color))

    if (nodes.length === 0) {
        error('graph create requires at least one node')
    }

    try {
        const response: unknown = await callMcpTool(port, 'create_graph', {
            callerTerminalId,
            ...(parentNodeId ? {parentNodeId} : {}),
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

export async function graphStructure(port: number, terminalId: string | undefined, args: string[]): Promise<void> {
    void port
    void terminalId

    if (args.length === 0) {
        error('Usage: vt graph structure <folder-path>')
    }

    const folderPath: string = args[0]

    try {
        const result: ReturnType<typeof getGraphStructure> = getGraphStructure(folderPath)

        if (result.nodeCount === 0) {
            output({message: '0 nodes found', folderPath})
        } else {
            console.log(`${result.nodeCount} nodes in ${args[0]}`)
            console.log('')
            console.log(result.ascii)
            if (result.orphanCount && result.orphanCount > 0) {
                console.log(`\nOrphans: ${result.orphanCount}`)
            }
        }
    } catch (toolError: unknown) {
        error(`graph_structure failed: ${getErrorMessage(toolError)}`)
    }
}

export async function graphUnseen(port: number, terminalId: string | undefined, args: string[]): Promise<void> {
    const callerTerminalId: string = requireTerminalId(terminalId)

    let searchFromNode: string | undefined

    for (let index: number = 0; index < args.length; index += 1) {
        const arg: string = args[index]
        if (arg === '--from') {
            searchFromNode = getRequiredValue(args, index + 1, '--from')
            index += 1
            continue
        }

        error(`Unknown argument: ${arg}`)
    }

    try {
        const response: unknown = await callMcpTool(port, 'get_unseen_nodes_nearby', {
            callerTerminalId,
            ...(searchFromNode ? {search_from_node: searchFromNode} : {}),
        })
        const result: GraphUnseenSuccess | ToolFailure = response as GraphUnseenSuccess | ToolFailure
        if (!result.success) {
            error(result.error)
        }

        output(result, (data: unknown): string => {
            const successData: GraphUnseenSuccess = data as GraphUnseenSuccess
            if (successData.unseenNodes.length === 0) {
                return 'No unseen nodes found.'
            }

            return successData.unseenNodes.map((node: GraphUnseenNode) => node.title).join('\n')
        })
    } catch (toolError: unknown) {
        error(`get_unseen_nodes_nearby failed: ${getErrorMessage(toolError)}`)
    }
}

export async function graphLintCommand(port: number, terminalId: string | undefined, args: string[]): Promise<void> {
    void port
    void terminalId

    if (args.length === 0) {
        error('Usage: vt graph lint <folder-path> [--max-arity N] [--coupling-threshold N] [--cross-ref-threshold N]')
    }

    const folderPath: string = args[0]
    const config: LintConfig = { ...DEFAULT_LINT_CONFIG }

    for (let index: number = 1; index < args.length; index += 1) {
        const arg: string = args[index]
        if (arg === '--max-arity') {
            const val: string = getRequiredValue(args, index + 1, '--max-arity')
            config.maxArity = Number(val)
            config.maxAttentionItems = Number(val)
            index += 1
            continue
        }
        if (arg === '--coupling-threshold') {
            const val: string = getRequiredValue(args, index + 1, '--coupling-threshold')
            config.highCouplingThreshold = Number(val)
            index += 1
            continue
        }
        if (arg === '--cross-ref-threshold') {
            const val: string = getRequiredValue(args, index + 1, '--cross-ref-threshold')
            config.wideCrossRefThreshold = Number(val)
            index += 1
            continue
        }
        error(`Unknown argument: ${arg}`)
    }

    try {
        const report: ReturnType<typeof lintGraph> = lintGraph(folderPath, config)

        if (isJsonMode()) {
            console.log(formatLintReportJson(report))
        } else {
            console.log(formatLintReportHuman(report))
        }
    } catch (lintError: unknown) {
        error(`graph lint failed: ${getErrorMessage(lintError)}`)
    }
}

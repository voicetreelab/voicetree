import {existsSync, readFileSync, renameSync, rmSync, writeFileSync} from 'fs'
import path from 'node:path'
import {callMcpTool} from '@/shell/edge/main/cli/mcp-client.ts'
import {error, output, isJsonMode} from '@/shell/edge/main/cli/output.ts'
import {
    getGraphStructure,
    lintGraph,
    formatLintReportHuman,
    formatLintReportJson,
    renderAutoView,
    renderGraphView,
    DEFAULT_LINT_CONFIG,
    buildFilesystemAuthoringPlan,
    type ViewFormat,
    type LintConfig,
    type FilesystemAuthoringInput,
    type FilesystemAuthoringFix,
    type FilesystemAuthoringPlanEntry,
    type FilesystemAuthoringReportEntry,
    type FilesystemAuthoringValidationError,
    type StructureManifest,
} from '@vt/graph-tools/node'
import {buildIndex, search, SearchIndexNotFoundError, type NodeSearchHit} from '@vt/graph-model'

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

type FilesystemCreateSuccess = {
    success: true
    mode: 'filesystem'
    validateOnly?: true
    nodes: Array<{
        path: string
        status: 'ok'
        fixes?: readonly FilesystemAuthoringFix[]
    }>
}

type FilesystemCreateFailure = {
    success: false
    mode: 'filesystem'
    errors: readonly FilesystemAuthoringValidationError[]
    reports: readonly FilesystemAuthoringReportEntry[]
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

type GraphIndexSuccess = {
    success: true
    vaultPath: string
    indexPath: string
}

type GraphSearchSuccess = {
    success: true
    vaultPath: string
    query: string
    topK: number
    hits: readonly NodeSearchHit[]
}

type GraphCreatePayload = {
    callerTerminalId?: string
    parentNodeId?: string
    nodes?: unknown
    override_with_rationale?: unknown
}

type ParsedFilesystemCreateArgs = {
    inputFilePaths: string[]
    parentPath?: string
    color?: string
    manifest?: StructureManifest
}

type ParsedLiveCreateArgs = {
    mode: 'live'
    nodesFile?: string
    inlineNodeSpecs: string[]
    parentNodeId?: string
    color?: string
    validateOnly: boolean
}

type ParsedFilesystemModeArgs = ParsedFilesystemCreateArgs & {
    mode: 'filesystem'
    validateOnly: boolean
}

type ParsedGraphCreateArgs = ParsedLiveCreateArgs | ParsedFilesystemModeArgs

type GraphFilesystemOps = {
    existsSync: typeof existsSync
    readFileSync: typeof readFileSync
    renameSync: typeof renameSync
    rmSync: typeof rmSync
    writeFileSync: typeof writeFileSync
}

const defaultGraphFilesystemOps: GraphFilesystemOps = {
    existsSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
}

let graphFilesystemOps: GraphFilesystemOps = defaultGraphFilesystemOps

export function setGraphFilesystemOpsForTest(overrides?: Partial<GraphFilesystemOps>): void {
    graphFilesystemOps = {
        ...defaultGraphFilesystemOps,
        ...(overrides ?? {}),
    }
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

function normalizeRef(value: string): string {
    return value
        .trim()
        .replace(/\\/g, '/')
        .replace(/^(?:\.\/)+/, '')
        .replace(/\.md$/i, '')
}

function parsePositiveInteger(value: string, flag: string): number {
    const parsedValue: number = Number(value)
    if (!Number.isInteger(parsedValue) || parsedValue < 1) {
        error(`${flag} must be a positive integer, received "${value}"`)
    }

    return parsedValue
}

function parseGraphIndexArgs(args: string[]): string {
    if (args.length !== 1) {
        error('Usage: vt graph index <vault-path>')
    }

    return args[0]
}

function parseGraphSearchArgs(args: string[]): {vaultPath: string; query: string; topK: number} {
    let topK: number = 10
    const positionalArgs: string[] = []

    for (let index: number = 0; index < args.length; index += 1) {
        const arg: string = args[index]
        if (arg === '--top-k') {
            topK = parsePositiveInteger(getRequiredValue(args, index + 1, '--top-k'), '--top-k')
            index += 1
            continue
        }

        if (arg.startsWith('--')) {
            error(`Unknown argument: ${arg}`)
        }

        positionalArgs.push(arg)
    }

    if (positionalArgs.length < 2) {
        error('Usage: vt graph search <vault-path> <query...> [--top-k N]')
    }

    return {
        vaultPath: positionalArgs[0],
        query: positionalArgs.slice(1).join(' ').trim(),
        topK,
    }
}

async function readCreateGraphPayloadFromStdin(terminalId: string | undefined): Promise<{
    callerTerminalId: string
    parentNodeId?: string
    nodes: GraphCreateNode[]
    override_with_rationale?: unknown
}> {
    const fsModule: typeof import('fs') = await import('fs')
    let rawPayload: string
    try {
        rawPayload = fsModule.readFileSync(0, 'utf8').trim()
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
        fileContents = graphFilesystemOps.readFileSync(filePath, 'utf8')
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

function inferManifestFormat(source: string, filePath: string): StructureManifest['format'] {
    const firstMeaningfulLine: string | undefined = source
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(line => line.length > 0)

    if (filePath.endsWith('.mmd') || filePath.endsWith('.mermaid')) {
        return 'mermaid'
    }

    if (firstMeaningfulLine && /^(?:graph|flowchart)\b/i.test(firstMeaningfulLine)) {
        return 'mermaid'
    }

    return 'ascii'
}

function parseGraphCreateArgs(args: string[]): ParsedGraphCreateArgs {
    let nodesFile: string | undefined
    const inlineNodeSpecs: string[] = []
    let parentValue: string | undefined
    let color: string | undefined
    const inputFilePaths: string[] = []
    let manifestPath: string | undefined
    let validateOnly: boolean = false

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
            parentValue = getRequiredValue(args, index + 1, '--parent')
            index += 1
            continue
        }

        if (arg === '--color') {
            color = getRequiredValue(args, index + 1, '--color')
            index += 1
            continue
        }

        if (arg === '--manifest') {
            manifestPath = getRequiredValue(args, index + 1, '--manifest')
            index += 1
            continue
        }

        if (arg === '--validate-only') {
            validateOnly = true
            continue
        }

        if (arg.startsWith('--')) {
            error(`Unknown argument: ${arg}`)
        }

        inputFilePaths.push(arg)
    }

    if (inputFilePaths.length > 0 || manifestPath) {
        if (nodesFile || inlineNodeSpecs.length > 0) {
            error('Use either filesystem markdown inputs or the live --nodes-file/--node flags, not both')
        }

        if (inputFilePaths.length === 0) {
            error('graph create --manifest requires at least one markdown file input')
        }

        const manifest: StructureManifest | undefined = manifestPath
            ? (() => {
                let source: string
                try {
                    source = graphFilesystemOps.readFileSync(manifestPath, 'utf8')
                } catch (readError: unknown) {
                    error(`Failed to read manifest file ${manifestPath}: ${getErrorMessage(readError)}`)
                }

                return {
                    format: inferManifestFormat(source, manifestPath),
                    source,
                }
            })()
            : undefined

        return {
            mode: 'filesystem',
            inputFilePaths,
            validateOnly,
            ...(parentValue ? {parentPath: parentValue} : {}),
            ...(color ? {color} : {}),
            ...(manifest ? {manifest} : {}),
        }
    }

    return {
        mode: 'live',
        ...(nodesFile ? {nodesFile} : {}),
        inlineNodeSpecs,
        validateOnly,
        ...(parentValue ? {parentNodeId: parentValue} : {}),
        ...(color ? {color} : {}),
    }
}

function formatFilesystemValidationErrors(errors: readonly FilesystemAuthoringValidationError[]): string {
    return errors
        .map(({message, filename, ref, suggestions}) => {
            const details: string[] = []
            if (filename) {
                details.push(`file: ${filename}`)
            }
            if (ref) {
                details.push(`ref: ${ref}`)
            }

            const lines: string[] = [details.length > 0 ? `${message} (${details.join(', ')})` : message]
            if (suggestions && suggestions.length > 0) {
                lines.push(...suggestions.map(suggestion => `suggestion: ${suggestion}`))
            }

            return lines.join('\n')
        })
        .join('\n')
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

function loadFilesystemInputs(inputFilePaths: readonly string[]): FilesystemAuthoringInput[] {
    return inputFilePaths.map((filePath: string) => {
        let markdown: string
        try {
            markdown = graphFilesystemOps.readFileSync(filePath, 'utf8')
        } catch (readError: unknown) {
            error(`Failed to read markdown input ${filePath}: ${getErrorMessage(readError)}`)
        }

        return {
            filename: filePath,
            markdown,
        }
    })
}

function validateExternalParent(parentPath: string, inputFilePaths: readonly string[]): string {
    const parentRef: string = normalizeRef(parentPath)
    const inputRefs: Set<string> = new Set(inputFilePaths.map(normalizeRef))

    if (!inputRefs.has(parentRef) && !graphFilesystemOps.existsSync(parentPath)) {
        error(`Parent file not found: ${parentPath}`)
    }

    return parentRef
}

function applyFilesystemPlan(
    writePlan: readonly FilesystemAuthoringPlanEntry[],
    externalParentRef: string | undefined
): FilesystemCreateSuccess {
    const finalEntries: Array<{
        path: string
        markdown: string
        fixes: readonly FilesystemAuthoringFix[]
    }> = writePlan.map((entry) => {
        const shouldAttachExternalParent: boolean =
            Boolean(externalParentRef) &&
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
                    graphFilesystemOps.readFileSync(entry.path, 'utf8'),
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

    return {
        success: true,
        mode: 'filesystem',
        nodes: finalEntries.map(({path, fixes}) => ({
            path,
            status: 'ok',
            ...(fixes.length > 0 ? {fixes} : {}),
        })),
    }
}

function failFilesystemCreateValidation(
    errors: readonly FilesystemAuthoringValidationError[],
    reports: readonly FilesystemAuthoringReportEntry[]
): never {
    if (isJsonMode()) {
        const failure: FilesystemCreateFailure = {
            success: false,
            mode: 'filesystem',
            errors,
            reports,
        }
        output(failure)
        process.exit(1)
    }

    error(formatFilesystemValidationErrors(errors))
}

function formatFilesystemCreateSuccessHuman(data: FilesystemCreateSuccess): string {
    const createdLabel: string = data.nodes.length === 1 ? 'node' : 'nodes'
    const fixesVerb: string = data.validateOnly ? 'would fix' : 'fixed'
    const lines: string[] = [
        data.validateOnly
            ? `Validated ${data.nodes.length} ${createdLabel} in filesystem mode (no files written):`
            : `Created ${data.nodes.length} ${createdLabel} in filesystem mode:`,
    ]

    for (const node of data.nodes) {
        const fixesLabel: string =
            node.fixes && node.fixes.length > 0
                ? ` (${fixesVerb}: ${node.fixes.map(fix => fix.message).join('; ')})`
                : ''
        lines.push(`✓ ${node.path}${fixesLabel}`)
    }

    return lines.join('\n')
}

export async function graphIndex(port: number, terminalId: string | undefined, args: string[]): Promise<void> {
    void port
    void terminalId

    const vaultPath: string = parseGraphIndexArgs(args)

    try {
        await buildIndex(vaultPath)
    } catch (buildError: unknown) {
        error(`graph index failed: ${getErrorMessage(buildError)}`)
    }

    const result: GraphIndexSuccess = {
        success: true,
        vaultPath,
        indexPath: path.join(vaultPath, '.vt-search', 'kg.db'),
    }

    output(result, (data: unknown): string => {
        const successData: GraphIndexSuccess = data as GraphIndexSuccess
        return `Indexed ${successData.vaultPath}\n${successData.indexPath}`
    })
}

export async function graphSearch(port: number, terminalId: string | undefined, args: string[]): Promise<void> {
    void port
    void terminalId

    const {vaultPath, query, topK} = parseGraphSearchArgs(args)

    let hits: readonly NodeSearchHit[]
    try {
        hits = await search(vaultPath, query, topK)
    } catch (searchError: unknown) {
        if (searchError instanceof SearchIndexNotFoundError) {
            error(searchError.message)
        }

        error(`graph search failed: ${getErrorMessage(searchError)}`)
    }

    const result: GraphSearchSuccess = {
        success: true,
        vaultPath,
        query,
        topK,
        hits,
    }

    output(result, (data: unknown): string => {
        const successData: GraphSearchSuccess = data as GraphSearchSuccess
        if (successData.hits.length === 0) {
            return `No graph hits for "${successData.query}".`
        }

        return successData.hits
            .map(
                (hit: NodeSearchHit, index: number) =>
                    `${index + 1}. [${hit.score}] ${hit.title}\n   ${hit.nodePath}${hit.snippet ? `\n   ${hit.snippet}` : ''}`,
            )
            .join('\n')
    })
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
        const payload: Awaited<ReturnType<typeof readCreateGraphPayloadFromStdin>> =
            await readCreateGraphPayloadFromStdin(terminalId)
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

export async function graphStructure(port: number, terminalId: string | undefined, args: string[]): Promise<void> {
    void port
    void terminalId

    if (args.length === 0) {
        error('Usage: vt graph structure <folder-path> [--with-summaries|--no-summaries]')
    }

    let folderPath: string | undefined
    let withSummaries: boolean | undefined

    for (const arg of args) {
        if (arg === '--with-summaries') {
            if (withSummaries === false) {
                error('Cannot combine --with-summaries and --no-summaries')
            }
            withSummaries = true
            continue
        }

        if (arg === '--no-summaries') {
            if (withSummaries === true) {
                error('Cannot combine --with-summaries and --no-summaries')
            }
            withSummaries = false
            continue
        }

        if (arg.startsWith('--')) {
            error(`Unknown argument: ${arg}`)
        }

        if (folderPath !== undefined) {
            error(`Unexpected argument: ${arg}`)
        }

        folderPath = arg
    }

    if (!folderPath) {
        error('Usage: vt graph structure <folder-path> [--with-summaries|--no-summaries]')
    }

    try {
        const result: ReturnType<typeof getGraphStructure> = getGraphStructure(folderPath, {withSummaries})

        if (result.nodeCount === 0) {
            output({message: '0 nodes found', folderPath, withSummaries})
        } else {
            console.log(`${result.nodeCount} nodes in ${folderPath}`)
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

export async function graphView(port: number, terminalId: string | undefined, args: string[]): Promise<void> {
    void port
    void terminalId

    let folderPath: string | undefined
    let format: ViewFormat = 'ascii'
    let showCrossEdges: boolean = true
    const collapsedFolders: string[] = []
    const selectedIds: string[] = []
    let autoExplicit: boolean | undefined
    let explicitRender: boolean = false
    let budget: number = 30
    let budgetExplicit: boolean = false

    for (let i: number = 0; i < args.length; i += 1) {
        const arg: string = args[i]
        if (arg === '--auto') { autoExplicit = true; continue }
        if (arg === '--no-auto') { autoExplicit = false; continue }
        if (arg === '--budget') {
            const next: string | undefined = args[i + 1]
            if (!next || next.startsWith('--')) error('--budget requires a value')
            const parsed: number = Number.parseInt(next, 10)
            if (!Number.isInteger(parsed) || parsed < 1) error('--budget requires a positive integer')
            budget = parsed
            budgetExplicit = true
            i += 1
            continue
        }
        if (arg.startsWith('--budget=')) {
            const parsed: number = Number.parseInt(arg.slice('--budget='.length), 10)
            if (!Number.isInteger(parsed) || parsed < 1) error('--budget requires a positive integer')
            budget = parsed
            budgetExplicit = true
            continue
        }
        if (arg === '--mermaid') { format = 'mermaid'; explicitRender = true; continue }
        if (arg === '--ascii') { format = 'ascii'; explicitRender = true; continue }
        if (arg.startsWith('--format=')) {
            const value: string = arg.slice('--format='.length)
            if (value !== 'ascii' && value !== 'mermaid') error(`Unknown format: ${value}`)
            format = value
            explicitRender = true
            continue
        }
        if (arg === '--no-cross-edges') { showCrossEdges = false; explicitRender = true; continue }
        if (arg === '--collapse') {
            const next: string | undefined = args[i + 1]
            if (!next || next.startsWith('--')) error('--collapse requires a folder argument')
            collapsedFolders.push(next)
            explicitRender = true
            i += 1
            continue
        }
        if (arg.startsWith('--collapse=')) {
            collapsedFolders.push(arg.slice('--collapse='.length))
            explicitRender = true
            continue
        }
        if (arg === '--select') {
            const next: string | undefined = args[i + 1]
            if (!next || next.startsWith('--')) error('--select requires a node id argument')
            selectedIds.push(next)
            explicitRender = true
            i += 1
            continue
        }
        if (arg.startsWith('--select=')) {
            selectedIds.push(arg.slice('--select='.length))
            explicitRender = true
            continue
        }
        if (arg.startsWith('--')) error(`Unknown argument: ${arg}`)
        if (folderPath !== undefined) error(`Unexpected argument: ${arg}`)
        folderPath = arg
    }

    const autoMode: boolean = autoExplicit ?? !explicitRender
    const resolvedFolderPath: string = folderPath ?? process.cwd()

    try {
        if (autoMode) {
            if (explicitRender) {
                error('--auto cannot be combined with --ascii/--mermaid/--format/--collapse/--select/--no-cross-edges')
            }
            const {output: out} = renderAutoView(resolvedFolderPath, {budget})
            console.log(out)
            return
        }

        if (budgetExplicit) {
            error('--budget can only be used with the default auto view or --auto')
        }

        const result: ReturnType<typeof renderGraphView> = renderGraphView(resolvedFolderPath, {format, showCrossEdges, collapsedFolders, selectedIds})
        console.log(result.output)
        if (format === 'ascii') {
            console.log(`\n${result.nodeCount} nodes — ${result.folderNodeCount} folder nodes, ${result.virtualFolderCount} virtual folders, ${result.fileNodeCount} files`)
        }
    } catch (toolError: unknown) {
        error(`graph view failed: ${getErrorMessage(toolError)}`)
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

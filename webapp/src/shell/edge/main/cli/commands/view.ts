import {readFile} from 'node:fs/promises'
import {resolve as resolvePath} from 'node:path'
import {
    ensureDaemon,
    GraphDbClient,
    type CollapseStateResponse,
    type LayoutResponse,
    type LiveStateSnapshot,
    type SelectionMode,
    type SelectionResponse,
} from '@vt/graph-db-client'
import {isJsonMode} from '../output.ts'
import {resolveVault} from '../util/detectVault.ts'
import {ArgValidationError, handleCliError} from '../util/exitCodes.ts'
import {parseSessionFlag, resolveSessionId} from '../util/sessionFlag.ts'

type Position = {
    x: number
    y: number
}

type LayoutPositions = Record<string, Position>

type LayoutSubcommand = 'set-pan' | 'set-positions' | 'set-zoom'

type ParsedViewBase = {
    forceJson: boolean
    sessionFlag?: string
    vaultFlag?: string
}

type ParsedLayoutCommand = ParsedViewBase & {
    branch: 'layout'
    positionsFile?: string
    subcommand: LayoutSubcommand
    x?: number
    y?: number
    zoom?: number
}

type ParsedCollapseCommand = ParsedViewBase & {
    branch: 'collapse'
    folderId: string
}

type ParsedExpandCommand = ParsedViewBase & {
    branch: 'expand'
    folderId: string
}

type ParsedSelectionCommand = ParsedViewBase & {
    branch: 'selection'
    mode: SelectionMode
    nodeIds: string[]
}

type ParsedShowCommand = ParsedViewBase & {
    branch: 'show'
}

type ParsedViewCommand =
    | ParsedLayoutCommand
    | ParsedCollapseCommand
    | ParsedExpandCommand
    | ParsedSelectionCommand
    | ParsedShowCommand

const VIEW_USAGE: string = `Usage:
  vt view collapse <folderId> [--vault <path>] [--session <id>] [--json]
  vt view expand <folderId> [--vault <path>] [--session <id>] [--json]
  vt view selection set <nodeIds...> [--vault <path>] [--session <id>] [--json]
  vt view selection add <nodeIds...> [--vault <path>] [--session <id>] [--json]
  vt view selection remove <nodeIds...> [--vault <path>] [--session <id>] [--json]
  vt view show [--vault <path>] [--session <id>] [--json]
  vt view layout set-pan <x> <y> [--vault <path>] [--session <id>] [--json]
  vt view layout set-zoom <zoom> [--vault <path>] [--session <id>] [--json]
  vt view layout set-positions <positions-json-file> [--vault <path>] [--session <id>] [--json]`

function validationError(message: string): never {
    throw new ArgValidationError(`${message}\n\n${VIEW_USAGE}`)
}

function readRequiredFlagValue(argv: string[], index: number, flag: string): string {
    const value: string | undefined = argv[index + 1]
    if (!value || value.startsWith('--')) {
        validationError(`${flag} requires a value`)
    }

    return value
}

function parseOptionalFlagAssignment(flag: string, arg: string): string {
    const value: string = arg.slice(`${flag}=`.length)
    if (!value) {
        validationError(`${flag} requires a value`)
    }

    return value
}

function parseNumberArg(value: string, label: 'x' | 'y' | 'zoom'): number {
    const parsed: number = Number(value)
    if (!Number.isFinite(parsed)) {
        validationError(`${label} must be a finite number.`)
    }

    return parsed
}

function requireSingleValue(
    args: string[],
    label: string,
    commandLabel: string,
): string {
    if (args.length === 0) {
        validationError(`Missing required ${label} for \`${commandLabel}\`.`)
    }

    if (args.length > 1) {
        validationError(`Too many positional arguments for \`${commandLabel}\`.`)
    }

    return args[0]
}

function parseSelectionMode(value: string | undefined): SelectionMode {
    switch (value) {
        case 'set':
            return 'replace'
        case 'add':
            return 'add'
        case 'remove':
            return 'remove'
        case undefined:
            validationError('Missing required selection subcommand.')
        default:
            validationError(`Unknown selection subcommand: ${value}`)
    }
}

function parseViewCommand(argv: string[]): ParsedViewCommand {
    const {remaining, session} = parseSessionFlag(argv)
    const positionalArgs: string[] = []
    let forceJson: boolean = false
    let vaultFlag: string | undefined

    for (let index: number = 0; index < remaining.length; index += 1) {
        const arg: string = remaining[index]

        if (arg === '--json') {
            forceJson = true
            continue
        }

        if (arg === '--vault') {
            vaultFlag = readRequiredFlagValue(remaining, index, '--vault')
            index += 1
            continue
        }

        if (arg.startsWith('--vault=')) {
            vaultFlag = parseOptionalFlagAssignment('--vault', arg)
            continue
        }

        if (arg === '--help' || arg === '-h') {
            throw new ArgValidationError(VIEW_USAGE)
        }

        if (arg.startsWith('--')) {
            validationError(`Unknown argument: ${arg}`)
        }

        positionalArgs.push(arg)
    }

    const [rawBranch, ...rest] = positionalArgs
    if (!rawBranch) {
        throw new ArgValidationError(VIEW_USAGE)
    }

    if (rawBranch === 'collapse') {
        return {
            branch: 'collapse',
            folderId: requireSingleValue(rest, '<folderId>', 'collapse'),
            vaultFlag,
            sessionFlag: session,
            forceJson,
        }
    }

    if (rawBranch === 'expand') {
        return {
            branch: 'expand',
            folderId: requireSingleValue(rest, '<folderId>', 'expand'),
            vaultFlag,
            sessionFlag: session,
            forceJson,
        }
    }

    if (rawBranch === 'selection') {
        const [rawMode, ...nodeIds] = rest
        const mode: SelectionMode = parseSelectionMode(rawMode)
        if (nodeIds.length === 0) {
            validationError(`Missing required <nodeIds...> for \`selection ${rawMode}\`.`)
        }

        return {
            branch: 'selection',
            mode,
            nodeIds,
            vaultFlag,
            sessionFlag: session,
            forceJson,
        }
    }

    if (rawBranch === 'show') {
        if (rest.length > 0) {
            validationError('`show` does not accept positional arguments.')
        }

        return {
            branch: 'show',
            vaultFlag,
            sessionFlag: session,
            forceJson,
        }
    }

    if (rawBranch !== 'layout') {
        validationError(`Unknown view subcommand: ${rawBranch}`)
    }

    const [rawSubcommand, ...layoutArgs] = rest

    switch (rawSubcommand) {
        case 'set-pan':
            if (layoutArgs.length < 2) {
                validationError('Missing required <x> <y> for `layout set-pan`.')
            }
            if (layoutArgs.length > 2) {
                validationError('Too many positional arguments for `layout set-pan`.')
            }

            return {
                branch: 'layout',
                subcommand: 'set-pan',
                x: parseNumberArg(layoutArgs[0], 'x'),
                y: parseNumberArg(layoutArgs[1], 'y'),
                vaultFlag,
                sessionFlag: session,
                forceJson,
            }
        case 'set-zoom':
            if (layoutArgs.length === 0) {
                validationError('Missing required <zoom> for `layout set-zoom`.')
            }
            if (layoutArgs.length > 1) {
                validationError('Too many positional arguments for `layout set-zoom`.')
            }

            return {
                branch: 'layout',
                subcommand: 'set-zoom',
                zoom: parseNumberArg(layoutArgs[0], 'zoom'),
                vaultFlag,
                sessionFlag: session,
                forceJson,
            }
        case 'set-positions':
            if (layoutArgs.length === 0) {
                validationError('Missing required <positions-json-file> for `layout set-positions`.')
            }
            if (layoutArgs.length > 1) {
                validationError('Too many positional arguments for `layout set-positions`.')
            }

            return {
                branch: 'layout',
                subcommand: 'set-positions',
                positionsFile: resolvePath(layoutArgs[0]),
                vaultFlag,
                sessionFlag: session,
                forceJson,
            }
        case undefined:
            validationError('Missing required layout subcommand.')
        default:
            validationError(`Unknown layout subcommand: ${rawSubcommand}`)
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function parsePositionsRecord(value: unknown, filePath: string): LayoutPositions {
    if (!isRecord(value)) {
        validationError(
            `Positions file "${filePath}" must contain a JSON object mapping node ids to {x, y}.`,
        )
    }

    const positions: LayoutPositions = {}

    for (const [nodeId, rawPosition] of Object.entries(value)) {
        if (
            !isRecord(rawPosition) ||
            typeof rawPosition.x !== 'number' ||
            typeof rawPosition.y !== 'number' ||
            !Number.isFinite(rawPosition.x) ||
            !Number.isFinite(rawPosition.y)
        ) {
            validationError(
                `Positions file "${filePath}" has an invalid position for "${nodeId}".`,
            )
        }

        positions[nodeId] = {
            x: rawPosition.x,
            y: rawPosition.y,
        }
    }

    return positions
}

async function readPositionsFile(filePath: string): Promise<LayoutPositions> {
    try {
        const rawFile: string = await readFile(filePath, 'utf8')
        return parsePositionsRecord(JSON.parse(rawFile), filePath)
    } catch (err) {
        if (err instanceof ArgValidationError) {
            throw err
        }

        if (err instanceof SyntaxError) {
            validationError(`Could not parse positions JSON at "${filePath}": ${err.message}`)
        }

        if (err instanceof Error) {
            validationError(`Could not read positions file "${filePath}": ${err.message}`)
        }

        validationError(`Could not read positions file "${filePath}".`)
    }
}

async function buildLayoutMutation(
    parsed: ParsedViewCommand,
): Promise<{pan?: Position; positions?: LayoutPositions; zoom?: number}> {
    switch (parsed.subcommand) {
        case 'set-pan':
            return {
                pan: {
                    x: parsed.x,
                    y: parsed.y,
                },
            }
        case 'set-zoom':
            return {
                zoom: parsed.zoom,
            }
        case 'set-positions':
            return {
                positions: await readPositionsFile(parsed.positionsFile),
            }
    }
}

function emitResult<T>(result: T, formatHuman: (data: T) => string, forceJson: boolean): void {
    if (forceJson || isJsonMode()) {
        console.log(JSON.stringify(result, null, 2))
        return
    }

    console.log(formatHuman(result))
}

function formatLayout(data: LayoutResponse): string {
    const positionEntries: string[] = Object.entries(data.layout.positions)
        .sort(([left], [right]): number => left.localeCompare(right))
        .map(([nodeId, position]): string => `  - ${nodeId}: (${position.x}, ${position.y})`)

    return [
        `Pan: (${data.layout.pan.x}, ${data.layout.pan.y})`,
        `Zoom: ${data.layout.zoom}`,
        positionEntries.length === 0 ? 'Positions:\n  (none)' : ['Positions:', ...positionEntries].join('\n'),
    ].join('\n')
}

function formatCollapseState(data: CollapseStateResponse): string {
    if (data.collapseSet.length === 0) {
        return 'Collapse Set:\n  (none)'
    }

    const entries: string[] = [...data.collapseSet]
        .sort((left: string, right: string): number => left.localeCompare(right))
        .map((folderId: string): string => `  - ${folderId}`)

    return ['Collapse Set:', ...entries].join('\n')
}

function formatSelection(data: SelectionResponse): string {
    if (data.selection.length === 0) {
        return 'Selection:\n  (none)'
    }

    return ['Selection:', ...data.selection.map((nodeId: string): string => `  - ${nodeId}`)].join('\n')
}

function formatViewState(data: LiveStateSnapshot): string {
    const collapseEntries: string[] =
        data.collapseSet.length === 0
            ? ['Collapse Set:', '  (none)']
            : ['Collapse Set:', ...[...data.collapseSet].sort().map((folderId: string): string => `  - ${folderId}`)]
    const selectionEntries: string[] =
        data.selection.length === 0
            ? ['Selection:', '  (none)']
            : ['Selection:', ...data.selection.map((nodeId: string): string => `  - ${nodeId}`)]
    const positionEntries: string[] =
        data.layout.positions.length === 0
            ? ['Positions:', '  (none)']
            : [
                  'Positions:',
                  ...[...data.layout.positions]
                      .sort(([left], [right]): number => left.localeCompare(right))
                      .map(
                          ([nodeId, position]): string =>
                              `  - ${nodeId}: (${position.x}, ${position.y})`,
                      ),
              ]

    return [
        `Graph Nodes: ${Object.keys(data.graph.nodes).length}`,
        `Loaded Roots: ${data.roots.loaded.length}`,
        `Folder Roots: ${data.roots.folderTree.length}`,
        ...collapseEntries,
        ...selectionEntries,
        `Pan: ${
            data.layout.pan ? `(${data.layout.pan.x}, ${data.layout.pan.y})` : '(unset)'
        }`,
        `Zoom: ${data.layout.zoom ?? '(unset)'}`,
        ...positionEntries,
        `Revision: ${data.meta.revision}`,
    ].join('\n')
}

async function createSessionClient(vaultFlag: string | undefined): Promise<GraphDbClient> {
    const vault: string = resolveVault({flag: vaultFlag})
    const {port}: {port: number} = await ensureDaemon(vault)
    return new GraphDbClient({
        baseUrl: `http://127.0.0.1:${port}`,
    })
}

async function resolveCommandSessionId(
    client: GraphDbClient,
    sessionFlag: string | undefined,
): Promise<string> {
    return await resolveSessionId({
        flag: sessionFlag,
        env: process.env.VT_SESSION,
        client,
    })
}

async function runLayoutCommand(parsed: ParsedLayoutCommand): Promise<void> {
    const mutation: {pan?: Position; positions?: LayoutPositions; zoom?: number} =
        await buildLayoutMutation(parsed)
    const client: GraphDbClient = await createSessionClient(parsed.vaultFlag)
    const sessionId: string = await resolveCommandSessionId(client, parsed.sessionFlag)

    emitResult(await client.updateLayout(sessionId, mutation), formatLayout, parsed.forceJson)
}

async function runCollapseCommand(parsed: ParsedCollapseCommand): Promise<void> {
    const client: GraphDbClient = await createSessionClient(parsed.vaultFlag)
    const sessionId: string = await resolveCommandSessionId(client, parsed.sessionFlag)

    emitResult(await client.collapse(sessionId, parsed.folderId), formatCollapseState, parsed.forceJson)
}

async function runExpandCommand(parsed: ParsedExpandCommand): Promise<void> {
    const client: GraphDbClient = await createSessionClient(parsed.vaultFlag)
    const sessionId: string = await resolveCommandSessionId(client, parsed.sessionFlag)

    emitResult(await client.expand(sessionId, parsed.folderId), formatCollapseState, parsed.forceJson)
}

async function runSelectionCommand(parsed: ParsedSelectionCommand): Promise<void> {
    const client: GraphDbClient = await createSessionClient(parsed.vaultFlag)
    const sessionId: string = await resolveCommandSessionId(client, parsed.sessionFlag)

    emitResult(
        await client.setSelection(sessionId, {
            mode: parsed.mode,
            nodeIds: parsed.nodeIds,
        }),
        formatSelection,
        parsed.forceJson,
    )
}

async function runShowCommand(parsed: ParsedShowCommand): Promise<void> {
    const client: GraphDbClient = await createSessionClient(parsed.vaultFlag)
    const sessionId: string = await resolveCommandSessionId(client, parsed.sessionFlag)

    emitResult(await client.getSessionState(sessionId), formatViewState, parsed.forceJson)
}

export async function runViewCommand(argv: string[]): Promise<void> {
    try {
        const parsed: ParsedViewCommand = parseViewCommand(argv)

        switch (parsed.branch) {
            case 'layout':
                await runLayoutCommand(parsed)
                return
            case 'collapse':
                await runCollapseCommand(parsed)
                return
            case 'expand':
                await runExpandCommand(parsed)
                return
            case 'selection':
                await runSelectionCommand(parsed)
                return
            case 'show':
                await runShowCommand(parsed)
                return
        }
    } catch (err) {
        handleCliError(err)
    }
}

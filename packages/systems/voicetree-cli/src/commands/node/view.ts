/**
 * `vt view ...` CLI subcommand: argument parsing, command dispatch, and
 * the per-branch runners that hit the graph-db daemon.
 *
 * Kept as a single file (over the 500-line per-edit hint) intentionally:
 * the prior decomposition split it into four sibling files (index.ts,
 * parseViewCommand.ts, runViewCommand.ts, usage.ts) that together added
 * four public exports to the `webapp/shell` community boundary-width
 * without buying a deep-function shape — every helper had exactly one
 * caller. Per FP-rearchitecting, helpers with one caller belong in the
 * file that uses them. The single public surface is `runViewCommand`.
 */

import {readFile} from 'node:fs/promises'
import {resolve as resolvePath} from 'node:path'
import {
    ensureDaemon,
    GraphDbClient,
    type FolderState,
    type LiveStateSnapshot,
    type SelectionMode,
    type ViewRecord,
} from '@vt/graph-db-client'
import {isRecord} from '../graph/core/util'
import {isJsonMode} from '../output'
import {resolveProject} from '../util/detectProject'
import {ArgValidationError, handleCliError} from '../util/exitCodes'
import {parseSessionFlag, resolveSessionId} from '../util/sessionFlag'
import {
    emitResult,
    formatFolderStateRow,
    formatLayout,
    formatSelection,
    formatViewActivated,
    formatViewCloned,
    formatViewDeleted,
    formatViewList,
    formatViewState,
    type CliFolderStateRow,
    type CliViewRecord,
} from './viewFormatters.ts'

// ────────────────────────────────────────────────────────────────────────
// Usage string + validationError sink (formerly view/usage.ts).
// ────────────────────────────────────────────────────────────────────────

const VIEW_USAGE: string = `Usage:
  vt view list [--project <path>] [--json]
  vt view switch <id-or-name> [--project <path>] [--json]
  vt view clone <src-id-or-name> <dst-name> [--project <path>] [--json]
  vt view delete <id-or-name> [--project <path>] [--json]
  vt view set-folder <path> <expanded|collapsed|hidden> [--project <path>] [--session <id>] [--json]
  vt view selection set <nodeIds...> [--project <path>] [--session <id>] [--json]
  vt view selection add <nodeIds...> [--project <path>] [--session <id>] [--json]
  vt view selection remove <nodeIds...> [--project <path>] [--session <id>] [--json]
  vt view show [--project <path>] [--session <id>] [--json]
  vt view layout set-pan <x> <y> [--project <path>] [--session <id>] [--json]
  vt view layout set-zoom <zoom> [--project <path>] [--session <id>] [--json]
  vt view layout set-positions <positions-json-file> [--project <path>] [--session <id>] [--json]`

function validationError(message?: string): never {
    throw new ArgValidationError(message === undefined ? VIEW_USAGE : `${message}\n\n${VIEW_USAGE}`)
}

// ────────────────────────────────────────────────────────────────────────
// Parsed command ADT (formerly view/parseViewCommand.ts).
// ────────────────────────────────────────────────────────────────────────

type ParsedViewBase = {
    forceJson: boolean
    sessionFlag?: string
    projectFlag?: string
}

type ParsedSetPanCommand = ParsedViewBase & {
    branch: 'layout'
    subcommand: 'set-pan'
    x: number
    y: number
}

type ParsedSetPositionsCommand = ParsedViewBase & {
    branch: 'layout'
    positionsFile: string
    subcommand: 'set-positions'
}

type ParsedSetZoomCommand = ParsedViewBase & {
    branch: 'layout'
    subcommand: 'set-zoom'
    zoom: number
}

type ParsedLayoutCommand =
    | ParsedSetPanCommand
    | ParsedSetPositionsCommand
    | ParsedSetZoomCommand

type ParsedListCommand = ParsedViewBase & {
    branch: 'list'
}

type ParsedSwitchCommand = ParsedViewBase & {
    branch: 'switch'
    target: string
}

type ParsedCloneCommand = ParsedViewBase & {
    branch: 'clone'
    source: string
    name: string
}

type ParsedDeleteCommand = ParsedViewBase & {
    branch: 'delete'
    target: string
}

type ParsedSetFolderCommand = ParsedViewBase & {
    branch: 'set-folder'
    folderPath: string
    state: FolderState
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
    | ParsedListCommand
    | ParsedSwitchCommand
    | ParsedCloneCommand
    | ParsedDeleteCommand
    | ParsedSetFolderCommand
    | ParsedSelectionCommand
    | ParsedShowCommand

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

function requireSingleValue(args: string[], label: string, commandLabel: string): string {
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
            return validationError('Missing required selection subcommand.')
        default:
            return validationError(`Unknown selection subcommand: ${value}`)
    }
}

function parseFolderState(value: string | undefined): FolderState {
    switch (value) {
        case 'expanded':
        case 'collapsed':
        case 'hidden':
            return value
        case undefined:
            return validationError('Missing required <expanded|collapsed|hidden> for `set-folder`.')
        default:
            return validationError(`Unknown folder state: ${value}`)
    }
}

function parseViewCommand(argv: string[]): ParsedViewCommand {
    const {remaining, session} = parseSessionFlag(argv)
    const positionalArgs: string[] = []
    let forceJson: boolean = false
    let projectFlag: string | undefined

    for (let index: number = 0; index < remaining.length; index += 1) {
        const arg: string = remaining[index]
        if (arg === '--json') {
            forceJson = true
            continue
        }
        if (arg === '--project') {
            projectFlag = readRequiredFlagValue(remaining, index, '--project')
            index += 1
            continue
        }
        if (arg.startsWith('--project=')) {
            projectFlag = parseOptionalFlagAssignment('--project', arg)
            continue
        }
        if (arg === '--help' || arg === '-h') {
            validationError()
        }
        if (arg.startsWith('--')) {
            validationError(`Unknown argument: ${arg}`)
        }
        positionalArgs.push(arg)
    }

    const [rawBranch, ...rest] = positionalArgs
    if (!rawBranch) {
        validationError()
    }

    if (rawBranch === 'list') {
        if (rest.length > 0) {
            validationError('`list` does not accept positional arguments.')
        }
        return {branch: 'list', projectFlag, sessionFlag: session, forceJson}
    }

    if (rawBranch === 'switch') {
        return {
            branch: 'switch',
            target: requireSingleValue(rest, '<id-or-name>', 'switch'),
            projectFlag,
            sessionFlag: session,
            forceJson,
        }
    }

    if (rawBranch === 'clone') {
        if (rest.length < 2) {
            validationError('Missing required <src-id-or-name> <dst-name> for `clone`.')
        }
        if (rest.length > 2) {
            validationError('Too many positional arguments for `clone`.')
        }
        return {
            branch: 'clone',
            source: rest[0],
            name: rest[1],
            projectFlag,
            sessionFlag: session,
            forceJson,
        }
    }

    if (rawBranch === 'delete') {
        return {
            branch: 'delete',
            target: requireSingleValue(rest, '<id-or-name>', 'delete'),
            projectFlag,
            sessionFlag: session,
            forceJson,
        }
    }

    if (rawBranch === 'set-folder') {
        if (rest.length < 2) {
            validationError('Missing required <path> <expanded|collapsed|hidden> for `set-folder`.')
        }
        if (rest.length > 2) {
            validationError('Too many positional arguments for `set-folder`.')
        }
        return {
            branch: 'set-folder',
            folderPath: resolvePath(rest[0]),
            state: parseFolderState(rest[1]),
            projectFlag,
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
        return {branch: 'selection', mode, nodeIds, projectFlag, sessionFlag: session, forceJson}
    }

    if (rawBranch === 'show') {
        if (rest.length > 0) {
            validationError('`show` does not accept positional arguments.')
        }
        return {branch: 'show', projectFlag, sessionFlag: session, forceJson}
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
                projectFlag,
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
                projectFlag,
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
                projectFlag,
                sessionFlag: session,
                forceJson,
            }
        case undefined:
            return validationError('Missing required layout subcommand.')
        default:
            return validationError(`Unknown layout subcommand: ${rawSubcommand}`)
    }
}

type Position = {
    x: number
    y: number
}

type LayoutPositions = Record<string, Position>

type LayoutMutation = {
    pan?: Position
    positions?: LayoutPositions
    zoom?: number
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
        positions[nodeId] = {x: rawPosition.x, y: rawPosition.y}
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

async function buildLayoutMutation(parsed: ParsedLayoutCommand): Promise<LayoutMutation> {
    switch (parsed.subcommand) {
        case 'set-pan':
            return {pan: {x: parsed.x, y: parsed.y}}
        case 'set-zoom':
            return {zoom: parsed.zoom}
        case 'set-positions':
            return {positions: await readPositionsFile(parsed.positionsFile)}
    }
}

async function createSessionClient(projectFlag: string | undefined): Promise<GraphDbClient> {
    const project: string = resolveProject({flag: projectFlag, cwd: process.cwd()})
    const {port}: {port: number} = await ensureDaemon(project)
    return new GraphDbClient({baseUrl: `http://127.0.0.1:${port}`})
}

function toCliViewRecord(view: ViewRecord): CliViewRecord {
    return {...view, is_active: view.isActive}
}

async function resolveViewRecord(client: GraphDbClient, target: string): Promise<ViewRecord> {
    const views: readonly ViewRecord[] = await client.views.list()
    const match: ViewRecord | undefined =
        views.find((view: ViewRecord): boolean => view.viewId === target) ??
        views.find((view: ViewRecord): boolean => view.name === target)

    if (!match) {
        validationError(`Unknown view: ${target}`)
    }

    return match
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
    const mutation: LayoutMutation = await buildLayoutMutation(parsed)
    const client: GraphDbClient = await createSessionClient(parsed.projectFlag)
    const sessionId: string = await resolveCommandSessionId(client, parsed.sessionFlag)
    emitResult(await client.updateLayout(sessionId, mutation), formatLayout, parsed.forceJson)
}

async function runListCommand(parsed: ParsedListCommand): Promise<void> {
    const client: GraphDbClient = await createSessionClient(parsed.projectFlag)
    emitResult((await client.views.list()).map(toCliViewRecord), formatViewList, parsed.forceJson)
}

async function runSwitchCommand(parsed: ParsedSwitchCommand): Promise<void> {
    const client: GraphDbClient = await createSessionClient(parsed.projectFlag)
    const view: ViewRecord = await resolveViewRecord(client, parsed.target)
    emitResult(
        toCliViewRecord(await client.views.activate(view.viewId)),
        formatViewActivated,
        parsed.forceJson,
    )
}

async function runCloneCommand(parsed: ParsedCloneCommand): Promise<void> {
    const client: GraphDbClient = await createSessionClient(parsed.projectFlag)
    const source: ViewRecord = await resolveViewRecord(client, parsed.source)
    emitResult(
        toCliViewRecord(await client.views.clone(source.viewId, parsed.name)),
        formatViewCloned,
        parsed.forceJson,
    )
}

async function runDeleteCommand(parsed: ParsedDeleteCommand): Promise<void> {
    const client: GraphDbClient = await createSessionClient(parsed.projectFlag)
    const view: ViewRecord = await resolveViewRecord(client, parsed.target)
    await client.views.delete(view.viewId)
    emitResult(toCliViewRecord(view), formatViewDeleted, parsed.forceJson)
}

async function runSetFolderCommand(parsed: ParsedSetFolderCommand): Promise<void> {
    const client: GraphDbClient = await createSessionClient(parsed.projectFlag)
    const sessionId: string = await resolveCommandSessionId(client, parsed.sessionFlag)
    await client.setFolderState(sessionId, parsed.folderPath, parsed.state)
    const row: CliFolderStateRow = {path: parsed.folderPath, state: parsed.state}
    emitResult(row, formatFolderStateRow, parsed.forceJson)
}

async function runSelectionCommand(parsed: ParsedSelectionCommand): Promise<void> {
    const client: GraphDbClient = await createSessionClient(parsed.projectFlag)
    const sessionId: string = await resolveCommandSessionId(client, parsed.sessionFlag)
    emitResult(
        await client.setSelection(sessionId, {mode: parsed.mode, nodeIds: parsed.nodeIds}),
        formatSelection,
        parsed.forceJson,
    )
}

async function runShowCommand(parsed: ParsedShowCommand): Promise<void> {
    const client: GraphDbClient = await createSessionClient(parsed.projectFlag)
    const sessionId: string = await resolveCommandSessionId(client, parsed.sessionFlag)
    const state: LiveStateSnapshot = await client.getSessionState(sessionId, {content: 'omit'})

    if (parsed.forceJson || isJsonMode()) {
        emitResult(state, formatViewState, true)
        return
    }

    const view = await client.getView(sessionId, {title: state.activeView.name})
    console.log(view.output)
}

async function runParsedViewCommand(parsed: ParsedViewCommand): Promise<void> {
    switch (parsed.branch) {
        case 'layout':
            await runLayoutCommand(parsed)
            return
        case 'list':
            await runListCommand(parsed)
            return
        case 'switch':
            await runSwitchCommand(parsed)
            return
        case 'clone':
            await runCloneCommand(parsed)
            return
        case 'delete':
            await runDeleteCommand(parsed)
            return
        case 'set-folder':
            await runSetFolderCommand(parsed)
            return
        case 'selection':
            await runSelectionCommand(parsed)
            return
        case 'show':
            await runShowCommand(parsed)
            return
    }
}

export async function runViewCommand(argv: string[]): Promise<void> {
    try {
        await runParsedViewCommand(parseViewCommand(argv))
    } catch (err) {
        handleCliError(err)
    }
}

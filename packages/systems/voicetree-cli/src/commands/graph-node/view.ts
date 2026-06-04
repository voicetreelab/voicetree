/**
 * `vt view ...` CLI subcommand: the impure runner shell. Each `run*Command`
 * resolves the graph-db daemon, performs the mutation/read, and emits the
 * result; `runViewCommand` is the single public surface.
 *
 * The pure parsing layer (the parsed-command ADT, the usage string, the
 * `validationError` sink, and `parseViewCommand`) lives in `./viewParse.ts`.
 * The pure/impure seam is the file boundary: `view.ts` owns I/O (file reads,
 * daemon calls, stdout); `viewParse.ts` owns argument validation only. The
 * split exists because the combined file exceeded the 500-line hard limit.
 */

import {readFile} from 'node:fs/promises'
import {
    ensureDaemon,
    GraphDbClient,
    type LiveStateSnapshot,
    type ViewRecord,
} from '@vt/graph-db-client'
import {isRecord} from '../graph/core/util'
import {isJsonMode} from '../output'
import {resolveProject} from '../util/detectProject'
import {ArgValidationError, handleCliError} from '../util/exitCodes'
import {resolveSessionId} from '../util/sessionFlag'
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
import {
    parseViewCommand,
    validationError,
    type ParsedCloneCommand,
    type ParsedDeleteCommand,
    type ParsedLayoutCommand,
    type ParsedListCommand,
    type ParsedSelectionCommand,
    type ParsedSetFolderCommand,
    type ParsedShowCommand,
    type ParsedSwitchCommand,
    type ParsedViewCommand,
} from './viewParse.ts'

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
    const project: string = resolveProject({flag: projectFlag, cwd: process.cwd(), env: process.env})
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

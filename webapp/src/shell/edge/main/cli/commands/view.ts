import {readFile} from 'node:fs/promises'
import {resolve as resolvePath} from 'node:path'
import {ensureDaemon, GraphDbClient, type LayoutResponse} from '@vt/graph-db-client'
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

type ParsedViewCommand = {
    branch: 'layout'
    forceJson: boolean
    positionsFile?: string
    sessionFlag?: string
    subcommand: LayoutSubcommand
    vaultFlag?: string
    x?: number
    y?: number
    zoom?: number
}

const VIEW_USAGE: string = `Usage:
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

    const [rawBranch, rawSubcommand, ...rest] = positionalArgs
    if (!rawBranch) {
        throw new ArgValidationError(VIEW_USAGE)
    }

    if (rawBranch !== 'layout') {
        validationError(`Unknown view subcommand: ${rawBranch}`)
    }

    switch (rawSubcommand) {
        case 'set-pan':
            if (rest.length < 2) {
                validationError('Missing required <x> <y> for `layout set-pan`.')
            }
            if (rest.length > 2) {
                validationError('Too many positional arguments for `layout set-pan`.')
            }

            return {
                branch: 'layout',
                subcommand: 'set-pan',
                x: parseNumberArg(rest[0], 'x'),
                y: parseNumberArg(rest[1], 'y'),
                vaultFlag,
                sessionFlag: session,
                forceJson,
            }
        case 'set-zoom':
            if (rest.length === 0) {
                validationError('Missing required <zoom> for `layout set-zoom`.')
            }
            if (rest.length > 1) {
                validationError('Too many positional arguments for `layout set-zoom`.')
            }

            return {
                branch: 'layout',
                subcommand: 'set-zoom',
                zoom: parseNumberArg(rest[0], 'zoom'),
                vaultFlag,
                sessionFlag: session,
                forceJson,
            }
        case 'set-positions':
            if (rest.length === 0) {
                validationError('Missing required <positions-json-file> for `layout set-positions`.')
            }
            if (rest.length > 1) {
                validationError('Too many positional arguments for `layout set-positions`.')
            }

            return {
                branch: 'layout',
                subcommand: 'set-positions',
                positionsFile: resolvePath(rest[0]),
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

async function runLayoutCommand(parsed: ParsedViewCommand): Promise<void> {
    const mutation: {pan?: Position; positions?: LayoutPositions; zoom?: number} =
        await buildLayoutMutation(parsed)
    const vault: string = resolveVault({flag: parsed.vaultFlag})
    const {port}: {port: number} = await ensureDaemon(vault)
    const client = new GraphDbClient({
        baseUrl: `http://127.0.0.1:${port}`,
    })
    const sessionId: string = await resolveSessionId({
        flag: parsed.sessionFlag,
        env: process.env.VT_SESSION,
        client,
    })

    emitResult(await client.updateLayout(sessionId, mutation), formatLayout, parsed.forceJson)
}

export async function runViewCommand(argv: string[]): Promise<void> {
    try {
        const parsed: ParsedViewCommand = parseViewCommand(argv)

        switch (parsed.branch) {
            case 'layout':
                await runLayoutCommand(parsed)
                return
            // BF-219 adds collapse/expand/selection/show branches here
        }
    } catch (err) {
        handleCliError(err)
    }
}

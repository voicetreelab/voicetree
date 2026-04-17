import { promises as fsp } from 'node:fs'
import path from 'node:path'

import {
    applyCommand,
    buildStateFromVault,
    hydrateCommand,
    hydrateState,
    serializeState,
    toFixtureJson,
    type SerializedCommand,
} from '@vt/graph-state'

export interface StateDumpOptions {
    readonly pretty?: boolean
    readonly outFile?: string
}

export interface StateDumpResult {
    readonly json: string
    readonly outFile?: string
}

const COMMAND_TYPES = [
    'Collapse',
    'Expand',
    'Select',
    'Deselect',
    'AddNode',
    'RemoveNode',
    'AddEdge',
    'RemoveEdge',
    'Move',
    'LoadRoot',
    'UnloadRoot',
] as const

function formatStateJson(value: unknown, pretty: boolean): string {
    return pretty ? toFixtureJson(value) : `${JSON.stringify(value)}\n`
}

function getRequiredValue(args: readonly string[], index: number, flag: string): string {
    const value: string | undefined = args[index]
    if (!value || value.startsWith('--')) {
        throw new Error(`${flag} requires a value`)
    }

    return value
}

function parsePrettyValue(value: string): boolean {
    if (value === 'true') {
        return true
    }

    if (value === 'false') {
        return false
    }

    throw new Error(`Invalid value for --pretty: ${value}. Use true or false.`)
}

function ensureSerializedCommand(value: unknown): asserts value is SerializedCommand {
    if (typeof value !== 'object' || value === null || !('type' in value) || typeof value.type !== 'string') {
        throw new Error('Command JSON must be an object with a string "type" field')
    }

    if (!COMMAND_TYPES.includes(value.type as (typeof COMMAND_TYPES)[number])) {
        throw new Error(`Unknown command type: "${value.type}"\nExpected one of: ${COMMAND_TYPES.join(', ')}`)
    }
}

async function readStateInput(stateFile?: string): Promise<string> {
    if (stateFile) {
        return fsp.readFile(stateFile, 'utf8')
    }

    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    }

    const input = Buffer.concat(chunks).toString('utf8')
    if (input.trim() === '') {
        throw new Error('Expected serialized State JSON on stdin or via --state-file')
    }

    return input
}

export async function dumpState(rootPath: string, options: StateDumpOptions = {}): Promise<StateDumpResult> {
    const pretty: boolean = options.pretty !== false
    const resolvedRootPath = path.resolve(rootPath)
    const serializedState = serializeState(await buildStateFromVault(resolvedRootPath, resolvedRootPath))
    const json: string = formatStateJson(serializedState, pretty)

    if (options.outFile) {
        await fsp.writeFile(options.outFile, json, 'utf8')
    }

    return {
        json,
        ...(options.outFile ? { outFile: options.outFile } : {}),
    }
}

export async function graphStateApply(args: readonly string[]): Promise<void> {
    let commandJson: string | undefined
    let stateFile: string | undefined
    let outFile: string | undefined
    let pretty = true

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index]

        if (arg === '--state-file') {
            stateFile = getRequiredValue(args, index + 1, '--state-file')
            index += 1
            continue
        }

        if (arg.startsWith('--state-file=')) {
            stateFile = arg.slice('--state-file='.length)
            if (!stateFile) {
                throw new Error('--state-file requires a value')
            }
            continue
        }

        if (arg === '--out') {
            outFile = getRequiredValue(args, index + 1, '--out')
            index += 1
            continue
        }

        if (arg.startsWith('--out=')) {
            outFile = arg.slice('--out='.length)
            if (!outFile) {
                throw new Error('--out requires a value')
            }
            continue
        }

        if (arg === '--pretty') {
            pretty = true
            continue
        }

        if (arg === '--no-pretty') {
            pretty = false
            continue
        }

        if (arg.startsWith('--pretty=')) {
            pretty = parsePrettyValue(arg.slice('--pretty='.length))
            continue
        }

        if (arg.startsWith('--')) {
            throw new Error(`Unknown argument: ${arg}`)
        }

        if (commandJson !== undefined) {
            throw new Error(`Unexpected argument: ${arg}`)
        }

        commandJson = arg
    }

    if (commandJson === undefined) {
        throw new Error('Usage: vt-graph apply <cmd-json> [--state-file <path>] [--pretty|--no-pretty] [--out <file>]')
    }

    let parsedCommand: unknown
    try {
        parsedCommand = JSON.parse(commandJson)
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Failed to parse command JSON: ${message}`)
    }

    ensureSerializedCommand(parsedCommand)

    let parsedState: unknown
    try {
        parsedState = JSON.parse(await readStateInput(stateFile))
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Failed to parse state JSON: ${message}`)
    }

    const nextState = applyCommand(
        hydrateState(parsedState as Parameters<typeof hydrateState>[0]),
        hydrateCommand(parsedCommand),
    )
    const output = formatStateJson(serializeState(nextState), pretty)

    if (outFile) {
        await fsp.writeFile(outFile, output, 'utf8')
    }

    process.stdout.write(output)
}

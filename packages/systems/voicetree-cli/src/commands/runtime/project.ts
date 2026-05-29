import {resolve as resolvePath} from 'node:path'
import {ensureDaemon, GraphDbClient, type ProjectState} from '@vt/graph-db-client'
import {isJsonMode} from '../output'
import {resolveProject} from '../util/detectProject'
import {ArgValidationError, handleCliError} from '../util/exitCodes'

type ProjectSubcommand = 'show' | 'set-write-path'

type ParsedProjectCommand = {
    forceJson: boolean
    pathArg?: string
    subcommand: ProjectSubcommand
    projectFlag?: string
}

type WriteFolderPathResult = {
    writeFolderPath: string
}

const PROJECT_USAGE: string = `Usage:
  vt project show [--project <path>] [--session <id>] [--json]
  vt project set-write-path <path> [--project <path>] [--session <id>] [--json]`

function validationError(message: string): never {
    throw new ArgValidationError(`${message}\n\n${PROJECT_USAGE}`)
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

function normalizePathArg(pathArg: string, subcommand: ProjectSubcommand): string {
    if (!pathArg.trim()) {
        validationError(`Missing required <path> for \`${subcommand}\`.`)
    }

    return resolvePath(pathArg)
}

function parseProjectCommand(argv: string[]): ParsedProjectCommand {
    const positionalArgs: string[] = []
    let forceJson: boolean = false
    let projectFlag: string | undefined

    for (let index: number = 0; index < argv.length; index += 1) {
        const arg: string = argv[index]

        if (arg === '--json') {
            forceJson = true
            continue
        }

        if (arg === '--project') {
            projectFlag = readRequiredFlagValue(argv, index, '--project')
            index += 1
            continue
        }

        if (arg.startsWith('--project=')) {
            projectFlag = parseOptionalFlagAssignment('--project', arg)
            continue
        }

        if (arg === '--session') {
            readRequiredFlagValue(argv, index, '--session')
            index += 1
            continue
        }

        if (arg.startsWith('--session=')) {
            parseOptionalFlagAssignment('--session', arg)
            continue
        }

        if (arg === '--help' || arg === '-h') {
            throw new ArgValidationError(PROJECT_USAGE)
        }

        if (arg.startsWith('--')) {
            validationError(`Unknown argument: ${arg}`)
        }

        positionalArgs.push(arg)
    }

    const [rawSubcommand, ...rest] = positionalArgs
    if (!rawSubcommand) {
        throw new ArgValidationError(PROJECT_USAGE)
    }

    switch (rawSubcommand) {
        case 'show':
            if (rest.length > 0) {
                validationError('`show` does not accept positional arguments.')
            }

            return {subcommand: 'show', projectFlag, forceJson}
        case 'set-write-path': {
            if (rest.length === 0) {
                validationError(`Missing required <path> for \`${rawSubcommand}\`.`)
            }
            if (rest.length > 1) {
                validationError(`Too many positional arguments for \`${rawSubcommand}\`.`)
            }

            return {
                subcommand: rawSubcommand,
                pathArg: normalizePathArg(rest[0], rawSubcommand),
                projectFlag,
                forceJson,
            }
        }
        default:
            validationError(`Unknown project subcommand: ${rawSubcommand}`)
    }
}

function emitResult<T>(result: T, formatHuman: (data: T) => string, forceJson: boolean): void {
    if (forceJson || isJsonMode()) {
        console.log(JSON.stringify(result, null, 2))
        return
    }

    console.log(formatHuman(result))
}

function formatReadPaths(data: {readPaths: string[]}): string {
    if (data.readPaths.length === 0) {
        return 'Read Paths:\n  (none)'
    }

    return ['Read Paths:', ...data.readPaths.map((path: string): string => `  - ${path}`)].join('\n')
}

function formatWriteFolderPath(data: WriteFolderPathResult): string {
    return `Write Path: ${data.writeFolderPath}`
}

function formatProjectState(data: ProjectState): string {
    return [
        `Project Path: ${data.projectRoot}`,
        formatReadPaths({readPaths: data.readPaths}),
        formatWriteFolderPath({writeFolderPath: data.writeFolderPath}),
    ].join('\n')
}

export async function runProjectCommand(argv: string[]): Promise<void> {
    try {
        const parsed: ParsedProjectCommand = parseProjectCommand(argv)
        const project: string = resolveProject({flag: parsed.projectFlag, cwd: process.cwd()})
        const {port}: {port: number} = await ensureDaemon(project)
        const client = new GraphDbClient({
            baseUrl: `http://127.0.0.1:${port}`,
        })

        switch (parsed.subcommand) {
            case 'show': {
                emitResult(await client.getProject(), formatProjectState, parsed.forceJson)
                return
            }
            case 'set-write-path': {
                const projectState: ProjectState = await client.setWriteFolderPath(parsed.pathArg)
                emitResult({writeFolderPath: projectState.writeFolderPath}, formatWriteFolderPath, parsed.forceJson)
                return
            }
        }
    } catch (err) {
        handleCliError(err)
    }
}

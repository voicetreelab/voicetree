import {ensureDaemon, GraphDbClient, type SessionInfo} from '@vt/graph-db-client'
import {isJsonMode} from '../output'
import {resolveProject} from '../util/detectProject'
import {ArgValidationError, handleCliError} from '../util/exitCodes'

type SessionSubcommand = 'create' | 'delete' | 'show'

type ParsedSessionCommand = {
    forceJson: boolean
    sessionId?: string
    subcommand: SessionSubcommand
    projectFlag?: string
}

type SessionCreateResult = {
    sessionId: string
}

type SessionDeleteResult = {
    deleted: true
    sessionId: string
}

const SESSION_USAGE: string = `Usage:
  vt session create [--project <path>] [--json]
  vt session delete <id> [--project <path>] [--json]
  vt session show [id] [--project <path>] [--json]`

function validationError(message: string): never {
    throw new ArgValidationError(`${message}\n\n${SESSION_USAGE}`)
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

function hasSessionId(value: string | undefined): value is string {
    return typeof value === 'string' && value.trim().length > 0
}

function parseSessionCommand(argv: string[]): ParsedSessionCommand {
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

        if (arg === '--help' || arg === '-h') {
            throw new ArgValidationError(SESSION_USAGE)
        }

        if (arg.startsWith('--')) {
            validationError(`Unknown argument: ${arg}`)
        }

        positionalArgs.push(arg)
    }

    const [rawSubcommand, ...rest] = positionalArgs
    if (!rawSubcommand) {
        throw new ArgValidationError(SESSION_USAGE)
    }

    switch (rawSubcommand) {
        case 'create':
            if (rest.length > 0) {
                validationError('`create` does not accept positional arguments.')
            }

            return {subcommand: 'create', projectFlag, forceJson}
        case 'delete':
            if (rest.length === 0) {
                validationError('Missing required <id> for `delete`.')
            }
            if (rest.length > 1) {
                validationError('Too many positional arguments for `delete`.')
            }

            return {subcommand: 'delete', sessionId: rest[0], projectFlag, forceJson}
        case 'show':
            if (rest.length > 1) {
                validationError('Too many positional arguments for `show`.')
            }

            return {subcommand: 'show', sessionId: rest[0], projectFlag, forceJson}
        default:
            validationError(`Unknown session subcommand: ${rawSubcommand}`)
    }
}

function resolveShowSessionId(sessionId?: string): string {
    if (hasSessionId(sessionId)) {
        return sessionId
    }

    if (hasSessionId(process.env.VT_SESSION)) {
        return process.env.VT_SESSION
    }

    validationError('Missing required <id> for `show` (or set VT_SESSION).')
}

function emitResult<T>(result: T, formatHuman: (data: T) => string, forceJson: boolean): void {
    if (forceJson || isJsonMode()) {
        console.log(JSON.stringify(result, null, 2))
        return
    }

    console.log(formatHuman(result))
}

function formatSessionCreated(data: SessionCreateResult): string {
    return `Session ID: ${data.sessionId}`
}

function formatSessionDeleted(data: SessionDeleteResult): string {
    return `Deleted Session: ${data.sessionId}`
}

function formatSessionInfo(data: SessionInfo): string {
    return [
        `Session ID: ${data.id}`,
        `Last Accessed At: ${data.lastAccessedAt}`,
        `Collapse Set Size: ${data.collapseSetSize}`,
        `Selection Size: ${data.selectionSize}`,
    ].join('\n')
}

export async function runSessionCommand(argv: string[]): Promise<void> {
    try {
        const parsed: ParsedSessionCommand = parseSessionCommand(argv)
        const showSessionId: string | undefined =
            parsed.subcommand === 'show' ? resolveShowSessionId(parsed.sessionId) : undefined
        const project: string = resolveProject({flag: parsed.projectFlag, cwd: process.cwd()})
        const {port}: {port: number} = await ensureDaemon(project)
        const client = new GraphDbClient({
            baseUrl: `http://127.0.0.1:${port}`,
        })

        switch (parsed.subcommand) {
            case 'create': {
                emitResult(await client.createSession(), formatSessionCreated, parsed.forceJson)
                return
            }
            case 'delete': {
                await client.deleteSession(parsed.sessionId)
                emitResult(
                    {deleted: true, sessionId: parsed.sessionId},
                    formatSessionDeleted,
                    parsed.forceJson,
                )
                return
            }
            case 'show': {
                emitResult(await client.getSession(showSessionId), formatSessionInfo, parsed.forceJson)
                return
            }
        }
    } catch (err) {
        handleCliError(err)
    }
}

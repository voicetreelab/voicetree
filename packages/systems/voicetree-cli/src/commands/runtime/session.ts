import {
    ensureDaemon,
    GraphDbClient,
    GraphDbClientError,
    type SessionInfo,
} from '@vt/graph-db-client'
import {isJsonMode} from '../output'
import {resolveProject} from '../util/detectProject'
import {ArgValidationError, CliExitError, EXIT, handleCliError} from '../util/exitCodes'

// The narrow daemon surface the session command depends on. Threading this in
// as a dependency (rather than constructing a GraphDbClient inline) keeps the
// runner a pure shell over an injectable edge: tests supply a real-shaped fake
// and assert on the observable console output, no internal mocking required.
export type SessionDaemon = {
    createSession(): Promise<{sessionId: string}>
    getSession(id: string): Promise<SessionInfo>
    deleteSession(id: string): Promise<void>
}

export type ConnectSessionDaemon = (project: string) => Promise<SessionDaemon>

const connectViaEnsuredDaemon: ConnectSessionDaemon = async (
    project: string,
): Promise<SessionDaemon> => {
    const {port}: {port: number} = await ensureDaemon(project)
    return new GraphDbClient({baseUrl: `http://127.0.0.1:${port}`})
}

type CommonSessionFields = {
    forceJson: boolean
    projectFlag?: string
}

// Discriminated by `subcommand` so the type reflects which branches carry a
// session id. `help` (from --help/-h) carries nothing and prints usage on
// stdout with a success exit. `create` never has an id; `delete` always does (a
// positional <id> is required); `show` may resolve its id from VT_SESSION at the
// shell edge, so it carries an optional raw positional the runner narrows.
type ParsedSessionCommand =
    | {subcommand: 'help'}
    | (CommonSessionFields & {subcommand: 'create'})
    | (CommonSessionFields & {subcommand: 'delete'; sessionId: string})
    | (CommonSessionFields & {subcommand: 'show'; sessionId?: string})

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
  vt session show [id] [--project <path>] [--json]

delete is idempotent: deleting an unknown or already-deleted id succeeds.`

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
            // --help is not an error: the runner prints usage to stdout and
            // exits 0. Returning early short-circuits any other parsing so
            // `vt session delete --help` prints usage instead of complaining
            // about the (intentionally absent) <id>.
            return {subcommand: 'help'}
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
        `Folder State Size: ${data.folderStateSize}`,
        `Selection Size: ${data.selectionSize}`,
    ].join('\n')
}

function isNotFound(err: unknown): err is GraphDbClientError {
    return err instanceof GraphDbClientError && err.status === 404
}

// `delete` is IDEMPOTENT: deleting a session that is already gone (typo'd id,
// repeated delete) is a success, not a failure. The daemon answers 404 for an
// unknown id; we translate that to the same `{deleted: true}` result an actual
// deletion produces, so an agent can `delete` without first checking existence
// and without parsing a raw transport error. Any non-404 daemon error still
// propagates unchanged.
async function deleteSessionIdempotent(client: SessionDaemon, sessionId: string): Promise<void> {
    try {
        await client.deleteSession(sessionId)
    } catch (err) {
        if (!isNotFound(err)) {
            throw err
        }
    }
}

// `show` of an unknown id is a clean domain error naming the id — never a raw
// `daemon responded 404 http_404: Not Found` transport string. The exit code
// stays in the daemon-error class (4) because the daemon is the authority that
// reported the resource absent.
async function showSession(client: SessionDaemon, sessionId: string): Promise<SessionInfo> {
    try {
        return await client.getSession(sessionId)
    } catch (err) {
        if (isNotFound(err)) {
            throw new CliExitError(EXIT.DAEMON_HTTP_ERROR, `Session ${sessionId} not found`, err)
        }
        throw err
    }
}

export async function runSessionCommand(
    argv: string[],
    connect: ConnectSessionDaemon = connectViaEnsuredDaemon,
): Promise<void> {
    try {
        const parsed: ParsedSessionCommand = parseSessionCommand(argv)

        if (parsed.subcommand === 'help') {
            console.log(SESSION_USAGE)
            return
        }

        const project: string = resolveProject({flag: parsed.projectFlag, cwd: process.cwd(), env: process.env})
        const client: SessionDaemon = await connect(project)

        switch (parsed.subcommand) {
            case 'create': {
                emitResult(await client.createSession(), formatSessionCreated, parsed.forceJson)
                return
            }
            case 'delete': {
                await deleteSessionIdempotent(client, parsed.sessionId)
                emitResult(
                    {deleted: true, sessionId: parsed.sessionId},
                    formatSessionDeleted,
                    parsed.forceJson,
                )
                return
            }
            case 'show': {
                const sessionId: string = resolveShowSessionId(parsed.sessionId)
                emitResult(await showSession(client, sessionId), formatSessionInfo, parsed.forceJson)
                return
            }
        }
    } catch (err) {
        handleCliError(err)
    }
}

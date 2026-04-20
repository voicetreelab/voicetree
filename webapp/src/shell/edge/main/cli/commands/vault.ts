import {resolve as resolvePath} from 'node:path'
import {ensureDaemon, GraphDbClient, type VaultState} from '@vt/graph-db-client'
import {isJsonMode} from '../output.ts'
import {resolveVault} from '../util/detectVault.ts'
import {ArgValidationError, handleCliError} from '../util/exitCodes.ts'

type VaultSubcommand = 'show' | 'add-read-path' | 'remove-read-path' | 'set-write-path'

type ParsedVaultCommand = {
    forceJson: boolean
    pathArg?: string
    subcommand: VaultSubcommand
    vaultFlag?: string
}

type ReadPathsResult = {
    readPaths: string[]
}

type WritePathResult = {
    writePath: string
}

const VAULT_USAGE: string = `Usage:
  vt vault show [--vault <path>] [--session <id>] [--json]
  vt vault add-read-path <path> [--vault <path>] [--session <id>] [--json]
  vt vault remove-read-path <path> [--vault <path>] [--session <id>] [--json]
  vt vault set-write-path <path> [--vault <path>] [--session <id>] [--json]`

function validationError(message: string): never {
    throw new ArgValidationError(`${message}\n\n${VAULT_USAGE}`)
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

function normalizePathArg(pathArg: string, subcommand: VaultSubcommand): string {
    if (!pathArg.trim()) {
        validationError(`Missing required <path> for \`${subcommand}\`.`)
    }

    return resolvePath(pathArg)
}

function parseVaultCommand(argv: string[]): ParsedVaultCommand {
    const positionalArgs: string[] = []
    let forceJson: boolean = false
    let vaultFlag: string | undefined

    for (let index: number = 0; index < argv.length; index += 1) {
        const arg: string = argv[index]

        if (arg === '--json') {
            forceJson = true
            continue
        }

        if (arg === '--vault') {
            vaultFlag = readRequiredFlagValue(argv, index, '--vault')
            index += 1
            continue
        }

        if (arg.startsWith('--vault=')) {
            vaultFlag = parseOptionalFlagAssignment('--vault', arg)
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
            throw new ArgValidationError(VAULT_USAGE)
        }

        if (arg.startsWith('--')) {
            validationError(`Unknown argument: ${arg}`)
        }

        positionalArgs.push(arg)
    }

    const [rawSubcommand, ...rest] = positionalArgs
    if (!rawSubcommand) {
        throw new ArgValidationError(VAULT_USAGE)
    }

    switch (rawSubcommand) {
        case 'show':
            if (rest.length > 0) {
                validationError('`show` does not accept positional arguments.')
            }

            return {subcommand: 'show', vaultFlag, forceJson}
        case 'add-read-path':
        case 'remove-read-path':
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
                vaultFlag,
                forceJson,
            }
        }
        default:
            validationError(`Unknown vault subcommand: ${rawSubcommand}`)
    }
}

function emitResult<T>(result: T, formatHuman: (data: T) => string, forceJson: boolean): void {
    if (forceJson || isJsonMode()) {
        console.log(JSON.stringify(result, null, 2))
        return
    }

    console.log(formatHuman(result))
}

function formatReadPaths(data: ReadPathsResult): string {
    if (data.readPaths.length === 0) {
        return 'Read Paths:\n  (none)'
    }

    return ['Read Paths:', ...data.readPaths.map((path: string): string => `  - ${path}`)].join('\n')
}

function formatWritePath(data: WritePathResult): string {
    return `Write Path: ${data.writePath}`
}

function formatVaultState(data: VaultState): string {
    return [
        `Vault Path: ${data.vaultPath}`,
        formatReadPaths({readPaths: data.readPaths}),
        formatWritePath({writePath: data.writePath}),
    ].join('\n')
}

export async function runVaultCommand(argv: string[]): Promise<void> {
    try {
        const parsed: ParsedVaultCommand = parseVaultCommand(argv)
        const vault: string = resolveVault({flag: parsed.vaultFlag})
        const {port}: {port: number} = await ensureDaemon(vault)
        const client = new GraphDbClient({
            baseUrl: `http://127.0.0.1:${port}`,
        })

        switch (parsed.subcommand) {
            case 'show': {
                emitResult(await client.getVault(), formatVaultState, parsed.forceJson)
                return
            }
            case 'add-read-path': {
                const vaultState: VaultState = await client.addReadPath(parsed.pathArg)
                emitResult({readPaths: vaultState.readPaths}, formatReadPaths, parsed.forceJson)
                return
            }
            case 'remove-read-path': {
                const vaultState: VaultState = await client.removeReadPath(parsed.pathArg)
                emitResult({readPaths: vaultState.readPaths}, formatReadPaths, parsed.forceJson)
                return
            }
            case 'set-write-path': {
                const vaultState: VaultState = await client.setWritePath(parsed.pathArg)
                emitResult({writePath: vaultState.writePath}, formatWritePath, parsed.forceJson)
                return
            }
        }
    } catch (err) {
        handleCliError(err)
    }
}

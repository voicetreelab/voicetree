import path from 'node:path'
import {buildIndex, search, SearchIndexNotFoundError, type NodeSearchHit} from '@vt/graph-model'
import {error, output} from '../output.ts'

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

function getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}

function getRequiredValue(args: string[], index: number, flag: string): string {
    const value: string | undefined = args[index]
    if (!value) {
        error(`${flag} requires a value`)
    }

    return value
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
    let topK = 10
    const positionalArgs: string[] = []

    for (let index = 0; index < args.length; index += 1) {
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

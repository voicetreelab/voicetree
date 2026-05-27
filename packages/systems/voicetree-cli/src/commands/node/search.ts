import {callDaemon} from '../daemon-client'
import {getErrorMessage, getRequiredValue, parsePositiveInteger} from '../graph/core/args'
import {error, output} from '../output'

type SearchResult = {
    node_path: string
    title: string
    score: number
}

type SearchSuccess = {
    success: true
    query: string
    results: SearchResult[]
}

type SearchFailure = {
    success: false
    error: string
}

export async function searchCommand(_terminalId: string | undefined, args: string[]): Promise<void> {
    let topK = 10
    const queryParts: string[] = []

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

        queryParts.push(arg)
    }

    const query: string = queryParts.join(' ').trim()
    if (!query) {
        error('search requires a query string')
    }

    try {
        const response: unknown = await callDaemon('search_nodes', {
            query,
            top_k: topK,
        })
        const result: SearchSuccess | SearchFailure = response as SearchSuccess | SearchFailure
        if (!result.success) {
            error(result.error)
        }

        output(result, (data: unknown): string => {
            const successData: SearchSuccess = data as SearchSuccess
            if (successData.results.length === 0) {
                return `No results for "${successData.query}".`
            }

            return successData.results
                .map(
                    (match: SearchResult, index: number) =>
                        `${index + 1}. [${match.score.toFixed(2)}] ${match.title}\n   ${match.node_path}`,
                )
                .join('\n')
        })
    } catch (toolError: unknown) {
        error(`search_nodes failed: ${getErrorMessage(toolError)}`)
    }
}

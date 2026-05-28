import path from 'node:path'
import {buildIndex, search} from '@vt/graph-db-server/search/index-backend'
import {SearchIndexNotFoundError, type NodeSearchHit} from '@vt/graph-db-server/search/types'
import {error, output} from '../cliDeps'
import {getErrorMessage, parseGraphIndexArgs, parseGraphSearchArgs} from '../core/args'
import type {GraphIndexSuccess, GraphSearchSuccess} from '../core/types'

export async function graphIndex(terminalId: string | undefined, args: string[]): Promise<void> {
    void terminalId

    const projectRoot: string = parseGraphIndexArgs(args)

    try {
        await buildIndex(projectRoot)
    } catch (buildError: unknown) {
        error(`graph index failed: ${getErrorMessage(buildError)}`)
    }

    const result: GraphIndexSuccess = {
        success: true,
        projectRoot,
        indexPath: path.join(projectRoot, '.vt-search', 'kg.db'),
    }

    output(result, (data: unknown): string => {
        const successData: GraphIndexSuccess = data as GraphIndexSuccess
        return `Indexed ${successData.projectRoot}\n${successData.indexPath}`
    })
}

export async function graphSearch(terminalId: string | undefined, args: string[]): Promise<void> {
    void terminalId

    const {projectRoot, query, topK} = parseGraphSearchArgs(args)

    let hits: readonly NodeSearchHit[]
    try {
        hits = await search(projectRoot, query, topK)
    } catch (searchError: unknown) {
        if (searchError instanceof SearchIndexNotFoundError) {
            error(searchError.message)
        }

        error(`graph search failed: ${getErrorMessage(searchError)}`)
    }

    const result: GraphSearchSuccess = {
        success: true,
        projectRoot,
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

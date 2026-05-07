import path from 'node:path'
import {buildSearchIndex, ensureDaemon, search as searchGraph, type NodeSearchHit} from '@vt/graph-db-client'
import {error, output} from '../../output.ts'
import {getErrorMessage, parseGraphIndexArgs, parseGraphSearchArgs} from './args.ts'
import type {GraphIndexSuccess, GraphSearchSuccess} from './types.ts'

async function getGraphDbBaseUrl(vaultPath: string): Promise<string> {
    const {port}: {port: number} = await ensureDaemon(vaultPath)
    return `http://127.0.0.1:${port}`
}

export async function graphIndex(port: number, terminalId: string | undefined, args: string[]): Promise<void> {
    void port
    void terminalId

    const vaultPath: string = parseGraphIndexArgs(args)

    try {
        const baseUrl: string = await getGraphDbBaseUrl(vaultPath)
        await buildSearchIndex(baseUrl, vaultPath)
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
        const baseUrl: string = await getGraphDbBaseUrl(vaultPath)
        hits = (await searchGraph(baseUrl, query, {vaultPath, topK})).hits
    } catch (searchError: unknown) {
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

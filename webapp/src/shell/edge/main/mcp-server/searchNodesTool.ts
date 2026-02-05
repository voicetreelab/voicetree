/**
 * MCP Tool: search_nodes
 * Searches for semantically relevant nodes using hybrid vector + BM25 search.
 */

import {askQuery, type SearchSimilarResult} from '@/shell/edge/main/backend-api'
import {type McpToolResponse, buildJsonResponse} from './types'

export interface SearchNodesParams {
    query: string
    top_k?: number
}

export async function searchNodesTool({
    query,
    top_k = 10
}: SearchNodesParams): Promise<McpToolResponse> {
    if (!query || query.trim() === '') {
        return buildJsonResponse({
            success: false,
            error: 'Query cannot be empty'
        }, true)
    }

    try {
        const response = await askQuery(query, top_k)
        const results: Array<{node_path: string; title: string; score: number}> = response.relevant_nodes.map(
            (node: SearchSimilarResult) => ({
                node_path: node.node_path,
                title: node.title,
                score: node.score
            })
        )

        return buildJsonResponse({
            success: true,
            query,
            results
        })
    } catch (error) {
        const errorMessage: string = error instanceof Error ? error.message : String(error)
        return buildJsonResponse({
            success: false,
            error: `Backend unavailable or search failed: ${errorMessage}`
        }, true)
    }
}

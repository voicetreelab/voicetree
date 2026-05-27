/**
 * MCP Tool: search_nodes
 * Stubbed while vector search is unavailable.
 */

import {type McpToolResponse, buildJsonResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'

export interface SearchNodesParams {
    query: string
    top_k?: number
}

export async function searchNodesTool({
    query,
    top_k = 10
}: SearchNodesParams): Promise<McpToolResponse> {
    void query
    void top_k

    return buildJsonResponse({
        success: false,
        message: 'Vector search is not yet available',
        results: []
    }, true)
}

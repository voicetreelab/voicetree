/**
 * Shared types and utilities for MCP tools.
 */

export type McpToolResponse = {
    content: Array<{type: 'text'; text: string}>
    isError?: boolean
}

export function buildJsonResponse(payload: unknown, isError?: boolean): McpToolResponse {
    return {
        content: [{type: 'text', text: JSON.stringify(payload)}],
        isError
    }
}

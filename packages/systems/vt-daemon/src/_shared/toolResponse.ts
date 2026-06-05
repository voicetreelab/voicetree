/**
 * Shared types and utilities for RPC tools.
 */

export type ToolResponse = {
    content: Array<{type: 'text'; text: string}>
    isError?: boolean
}

export function buildJsonResponse(payload: unknown, isError?: boolean): ToolResponse {
    return {
        content: [{type: 'text', text: JSON.stringify(payload)}],
        isError
    }
}

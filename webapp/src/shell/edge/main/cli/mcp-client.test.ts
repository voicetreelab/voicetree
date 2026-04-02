import {afterEach, describe, expect, it, vi} from 'vitest'
import {callMcpTool} from './mcp-client'

describe('callMcpTool', () => {
    const originalFetch: typeof global.fetch = global.fetch

    afterEach(() => {
        global.fetch = originalFetch
        vi.restoreAllMocks()
    })

    it('throws the underlying MCP tool error when result.isError is true', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                jsonrpc: '2.0',
                id: 1,
                result: {
                    content: [{type: 'text', text: 'MCP error -32602: Tool graph_structure not found'}],
                    isError: true,
                },
            }),
        } as Response)

        await expect(callMcpTool(3002, 'graph_structure', {})).rejects.toThrow(
            'MCP error -32602: Tool graph_structure not found'
        )
    })
})

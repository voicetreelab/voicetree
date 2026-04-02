function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null
        ? value as Record<string, unknown>
        : undefined
}

function getRpcErrorMessage(payload: Record<string, unknown>): string | undefined {
    const rpcError: Record<string, unknown> | undefined = asRecord(payload.error)
    return typeof rpcError?.message === 'string' ? rpcError.message : undefined
}

function getResultText(payload: Record<string, unknown>): string | undefined {
    const result: Record<string, unknown> | undefined = asRecord(payload.result)
    const content: unknown = result?.content

    if (!Array.isArray(content) || content.length === 0) {
        return undefined
    }

    const firstItem: Record<string, unknown> | undefined = asRecord(content[0])
    return typeof firstItem?.text === 'string' ? firstItem.text : undefined
}

function getToolErrorMessage(payload: Record<string, unknown>): string | undefined {
    const result: Record<string, unknown> | undefined = asRecord(payload.result)
    if (result?.isError !== true) {
        return undefined
    }

    return getResultText(payload) ?? 'Voicetree MCP tool returned an unspecified error'
}

export async function callMcpTool(
    port: number,
    toolName: string,
    args: Record<string, unknown>
): Promise<unknown> {
    let response: Response

    try {
        response = await fetch(`http://127.0.0.1:${port}/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'tools/call',
                params: {name: toolName, arguments: args},
                id: 1,
            }),
        })
    } catch (error) {
        throw new Error(
            `Failed to reach Voicetree MCP server on port ${port}: ${getErrorMessage(error)}`
        )
    }

    let payload: unknown
    try {
        payload = await response.json()
    } catch (error) {
        throw new Error(
            `Voicetree MCP server returned invalid JSON (HTTP ${response.status}): ${getErrorMessage(error)}`
        )
    }

    const payloadRecord: Record<string, unknown> | undefined = asRecord(payload)
    if (!payloadRecord) {
        throw new Error(`Voicetree MCP server returned an unexpected response (HTTP ${response.status})`)
    }

    const rpcErrorMessage: string | undefined = getRpcErrorMessage(payloadRecord)
    if (!response.ok) {
        throw new Error(
            rpcErrorMessage
                ? `${rpcErrorMessage} (HTTP ${response.status})`
                : `Voicetree MCP request failed with HTTP ${response.status}`
        )
    }

    if (rpcErrorMessage) {
        throw new Error(rpcErrorMessage)
    }

    const toolErrorMessage: string | undefined = getToolErrorMessage(payloadRecord)
    if (toolErrorMessage) {
        throw new Error(toolErrorMessage)
    }

    const contentText: string | undefined = getResultText(payloadRecord)
    if (contentText === undefined) {
        return payloadRecord.result ?? payloadRecord
    }

    try {
        return JSON.parse(contentText)
    } catch {
        return contentText
    }
}

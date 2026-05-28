// JSON-RPC 2.0 dispatch pipeline for POST /rpc. Split out of httpServer.ts
// to keep the request-router file focused on routing/auth; this file owns
// the marshalling/error-envelope contract.
//
// Pure stages (`dispatchRpcRequest`) are unit-testable without an HTTP
// server. The final stage (`handleRpc`) is the only impurity: it reads the
// request body and writes the response. Following CLAUDE.md, the impurity
// lives at the edge while the dispatch logic stays a pure value function.

import type {IncomingMessage, ServerResponse} from 'node:http'

import {ERROR_CODES} from '@vt/vt-rpc'
import {CatalogValidationError} from '../tools/catalog.ts'
import type {McpToolResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'
import type {AccessLogger, ToolCatalog, ToolHandler} from './httpServerTypes.ts'
import {readBodyWithCap} from './bodyReader.ts'
import {buildAccessLogLine} from './accessLog.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rpcErrorEnvelope(
    id: number | string | null,
    code: number,
    message: string,
    data?: unknown,
): unknown {
    return data === undefined
        ? {jsonrpc: '2.0', id, error: {code, message}}
        : {jsonrpc: '2.0', id, error: {code, message, data}}
}

function unwrapToolResponse(
    response: McpToolResponse,
): {ok: true; payload: unknown} | {ok: false; payload: unknown} {
    const text: string = response.content[0]?.text ?? ''
    let payload: unknown
    try {
        payload = text === '' ? null : JSON.parse(text)
    } catch {
        payload = text
    }
    return response.isError === true ? {ok: false, payload} : {ok: true, payload}
}

export async function dispatchRpcRequest(
    rawBody: string,
    catalog: ToolCatalog,
): Promise<{readonly status: 200 | 400; readonly body: unknown}> {
    let parsed: unknown
    try {
        parsed = JSON.parse(rawBody)
    } catch (cause) {
        return {
            status: 200,
            body: rpcErrorEnvelope(
                null,
                ERROR_CODES.parse_error,
                cause instanceof Error ? cause.message : 'Malformed JSON',
            ),
        }
    }
    if (!isRecord(parsed) || parsed.jsonrpc !== '2.0') {
        return {
            status: 200,
            body: rpcErrorEnvelope(
                null,
                ERROR_CODES.invalid_request,
                'Request must be a JSON-RPC 2.0 envelope',
            ),
        }
    }
    const id: number | string | null =
        typeof parsed.id === 'number' || typeof parsed.id === 'string' ? parsed.id : null
    const method: unknown = parsed.method
    if (typeof method !== 'string' || method.length === 0) {
        return {
            status: 200,
            body: rpcErrorEnvelope(id, ERROR_CODES.invalid_request, 'Request missing "method"'),
        }
    }
    const handler: ToolHandler | undefined = catalog.get(method)
    if (!handler) {
        return {
            status: 200,
            body: rpcErrorEnvelope(id, ERROR_CODES.tool_not_found, `Unknown method: ${method}`),
        }
    }
    const params: Record<string, unknown> = isRecord(parsed.params) ? parsed.params : {}

    let response: McpToolResponse
    try {
        response = await handler(params)
    } catch (cause) {
        if (cause instanceof CatalogValidationError) {
            return {
                status: 200,
                body: rpcErrorEnvelope(id, ERROR_CODES.validation_failed, cause.message, {
                    kind: 'validation_failed',
                    tool: cause.toolName,
                    issues: cause.issues,
                }),
            }
        }
        return {
            status: 200,
            body: rpcErrorEnvelope(
                id,
                ERROR_CODES.internal_error,
                cause instanceof Error ? cause.message : String(cause),
            ),
        }
    }

    const unwrapped: {ok: boolean; payload: unknown} = unwrapToolResponse(response)
    if (unwrapped.ok) {
        return {status: 200, body: {jsonrpc: '2.0', id, result: unwrapped.payload}}
    }
    return {
        status: 200,
        body: rpcErrorEnvelope(
            id,
            ERROR_CODES.tool_handler_failed,
            'Tool handler returned an error response',
            unwrapped.payload,
        ),
    }
}

export async function handleRpc(
    req: IncomingMessage,
    res: ServerResponse,
    catalog: ToolCatalog,
    logger: AccessLogger,
): Promise<void> {
    const body: string | {tooLarge: true} = await readBodyWithCap(req)
    if (typeof body !== 'string') {
        res.statusCode = 413
        res.end()
        logger.logRequest(buildAccessLogLine(req, 413))
        return
    }
    const {status, body: payload} = await dispatchRpcRequest(body, catalog)
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(payload))
    logger.logRequest(buildAccessLogLine(req, status))
}

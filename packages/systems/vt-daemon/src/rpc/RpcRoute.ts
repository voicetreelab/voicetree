// Wire contract for the 19 BF-376 outbound RPC routes. Each route is a thin
// adapter from `@vt/vt-daemon-protocol`'s typed Request/Response shapes onto
// the matching `agentRuntime.*` function. Catalog drift checks
// (`catalogManualDrift.test.ts`) operate on `TOOL_CATALOG` — the MCP-tool
// surface — and intentionally do NOT iterate `RPC_ROUTES`, which carries
// internal wire contracts that aren't user-facing CLI verbs.
//
// Each route returns its result via `buildJsonResponse(payload)` so the
// existing `rpcDispatch.ts` flow unwraps it as the JSON-RPC `result` field;
// errors are returned with `isError: true` and surface as a `JSON-RPC
// tool_handler_failed` error envelope on the wire.

import type {ZodRawShape} from 'zod'

import {buildJsonResponse, type McpToolResponse} from '../_shared/toolResponse.ts'

export type RpcHandler = (args: Record<string, unknown>) => Promise<McpToolResponse> | McpToolResponse

export interface RpcRoute {
    readonly name: string
    /**
     * Optional zod input schema. When present, the catalog's dispatch builder
     * validates incoming params against it and surfaces a structured
     * `validation_failed` error (mirroring `TOOL_CATALOG`). Routes whose
     * request shape is `Record<string, never>` may omit this.
     */
    readonly inputShape?: ZodRawShape
    readonly handler: RpcHandler
}

/**
 * Tiny helper for the common case: bind a typed contract request type `Req`
 * to an agent-runtime function whose signature is shaped like
 * `(...args) => Promise<Res> | Res`. The `extract` closure picks fields out
 * of the parsed request and returns the array of positional args; the result
 * is wrapped in `buildJsonResponse` so callers don't repeat the ceremony.
 *
 * Kept narrow on purpose: the few routes with bespoke shapes (the spawn
 * family's optional fields, the recovery family's Option-bearing returns)
 * write their handler bodies inline instead of going through the helper.
 */
export function bindRoute<Req, Res>(
    fn: (req: Req) => Promise<Res> | Res,
): RpcHandler {
    return async (args: Record<string, unknown>): Promise<McpToolResponse> => {
        const result: Res = await fn(args as unknown as Req)
        return buildJsonResponse(result ?? null)
    }
}

export function voidRoute<Req>(
    fn: (req: Req) => Promise<void> | void,
): RpcHandler {
    return async (args: Record<string, unknown>): Promise<McpToolResponse> => {
        await fn(args as unknown as Req)
        return buildJsonResponse(null)
    }
}

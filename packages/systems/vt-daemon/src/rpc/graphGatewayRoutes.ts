// The `graph.*` gateway RPC routes (RE-PLAN B). VTD fronts the loopback-only
// vt-graphd for browser clients: each route here delegates to the per-boot
// `@vt/graph-db-client` (`gdb.client`) that bin/vtd.ts already holds. Registered
// on the internal RPC bucket (NOT the agent MCP `TOOL_CATALOG`) via
// `buildCatalogDispatchMap(bridges, extraRoutes)`.
//
// Unlike the terminal `RPC_ROUTES` (which bind a module-level
// `terminalRuntimeSurface` singleton), these routes need the per-boot client +
// the VTD-owned graphd session, so they are produced by a factory whose deps
// are injected at the edge — the core stays pure, no module-level cell.
//
// Session is implicit: `ensureSession()` (owned by the shell, idempotent)
// creates VTD's single graphd session and starts the projectedGraph→hub live
// pump on first call, returning the id thereafter. Only the session-scoped
// operations (openProject, getProjectedGraph, applyDelta) await it; the rest are
// global project ops, mirroring the graph-db-client method surface.

import {z} from 'zod'

import type {GraphDbClient} from '@vt/graph-db-client'
import type {ProjectedGraph} from '@vt/graph-state/contract'
import {
    GRAPH_GATEWAY_METHODS,
    type GraphActivateView,
    type GraphApplyDelta,
    type GraphCloneView,
    type GraphCreateContextNode,
    type GraphDeleteView,
    type GraphFindFileByName,
    type GraphGetNode,
    type GraphGetPreviewContainedNodeIds,
    type GraphOpenProject,
    type GraphSetWriteFolderPath,
    type GraphWriteMarkdownFile,
    type GraphWritePositions,
} from '@vt/vt-daemon-protocol'

import {buildJsonResponse, type McpToolResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'
import type {RpcRoute} from './RpcRoute.ts'

export interface GraphGatewayDeps {
    readonly client: GraphDbClient
    /**
     * Idempotent: ensure VTD's single graphd session exists and the
     * projectedGraph→hub live pump is running; returns the session id. Owned by
     * bin/vtd.ts so the pump lifecycle lives at the edge. After the first call
     * it is a cheap accessor — no graphd round-trip — so session-scoped routes
     * may await it freely instead of carrying an ordering gate.
     */
    readonly ensureSession: () => Promise<string>
}

const M = GRAPH_GATEWAY_METHODS

function json(payload: unknown): McpToolResponse {
    return buildJsonResponse(payload)
}

export function buildGraphGatewayRoutes(deps: GraphGatewayDeps): readonly RpcRoute[] {
    const {client, ensureSession} = deps

    return [
        // --- Boot --------------------------------------------------------------
        {
            name: M.openProject,
            handler: async (): Promise<McpToolResponse> => {
                const sessionId: string = await ensureSession()
                const [projectState, initialProjectedGraph] = await Promise.all([
                    client.getProject(),
                    client.getProjectedGraph(sessionId) as Promise<ProjectedGraph>,
                ])
                const response: GraphOpenProject.Response = {
                    sessionId,
                    projectState,
                    initialProjectedGraph,
                }
                return json(response)
            },
        },

        // --- Reads -------------------------------------------------------------
        {
            name: M.getProject,
            handler: async (): Promise<McpToolResponse> => json(await client.getProject()),
        },
        {
            name: M.getGraph,
            handler: async (): Promise<McpToolResponse> => json(await client.getGraph()),
        },
        {
            name: M.getNode,
            inputShape: {nodeId: z.string()},
            handler: async (args): Promise<McpToolResponse> => {
                const {nodeId} = args as unknown as GraphGetNode.Request
                const graph = await client.getGraph()
                return json(graph.nodes[nodeId] ?? null)
            },
        },
        {
            name: M.getProjectedGraph,
            handler: async (): Promise<McpToolResponse> => {
                const sessionId: string = await ensureSession()
                return json(await client.getProjectedGraph(sessionId))
            },
        },

        // --- Mutations ---------------------------------------------------------
        {
            name: M.applyDelta,
            inputShape: {
                delta: z.array(z.unknown()),
                recordForUndo: z.boolean().optional(),
            },
            handler: async (args): Promise<McpToolResponse> => {
                const {delta, recordForUndo} = args as unknown as GraphApplyDelta.Request
                const sessionId: string = await ensureSession()
                await client.applyGraphDelta(delta as unknown as unknown[], {
                    recordForUndo,
                    sessionId,
                })
                return json(null)
            },
        },
        {
            name: M.writeMarkdownFile,
            inputShape: {
                absolutePath: z.string(),
                body: z.string(),
                editorId: z.string(),
            },
            handler: async (args): Promise<McpToolResponse> => {
                const {absolutePath, body, editorId} = args as unknown as GraphWriteMarkdownFile.Request
                return json(await client.writeMarkdownFile(absolutePath, body, editorId))
            },
        },
        {
            name: M.writePositions,
            inputShape: {
                positions: z.record(z.string(), z.object({x: z.number(), y: z.number()})),
            },
            handler: async (args): Promise<McpToolResponse> => {
                const {positions} = args as unknown as GraphWritePositions.Request
                return json(await client.writePositions(positions))
            },
        },
        {
            name: M.findFileByName,
            inputShape: {name: z.string()},
            handler: async (args): Promise<McpToolResponse> => {
                const {name} = args as unknown as GraphFindFileByName.Request
                return json(await client.findFileByName(name))
            },
        },
        {
            name: M.getPreviewContainedNodeIds,
            inputShape: {nodeId: z.string()},
            handler: async (args): Promise<McpToolResponse> => {
                const {nodeId} = args as unknown as GraphGetPreviewContainedNodeIds.Request
                return json(await client.getPreviewContainedNodeIds(nodeId))
            },
        },
        {
            name: M.createContextNode,
            inputShape: {
                parentNodeId: z.string(),
                semanticNodeIds: z.array(z.string()),
            },
            handler: async (args): Promise<McpToolResponse> => {
                const {parentNodeId, semanticNodeIds} = args as unknown as GraphCreateContextNode.Request
                return json(await client.createContextNode(parentNodeId, [...semanticNodeIds]))
            },
        },
        {
            name: M.undo,
            handler: async (): Promise<McpToolResponse> => json(await client.undo()),
        },
        {
            name: M.redo,
            handler: async (): Promise<McpToolResponse> => json(await client.redo()),
        },
        {
            name: M.setWriteFolderPath,
            inputShape: {path: z.string()},
            handler: async (args): Promise<McpToolResponse> => {
                const {path} = args as unknown as GraphSetWriteFolderPath.Request
                return json(await client.setWriteFolderPath(path))
            },
        },

        // --- Views -------------------------------------------------------------
        {
            name: M.listViews,
            handler: async (): Promise<McpToolResponse> => json(await client.views.list()),
        },
        {
            name: M.activateView,
            inputShape: {viewId: z.string()},
            handler: async (args): Promise<McpToolResponse> => {
                const {viewId} = args as unknown as GraphActivateView.Request
                return json(await client.views.activate(viewId))
            },
        },
        {
            name: M.cloneView,
            inputShape: {srcViewId: z.string(), name: z.string()},
            handler: async (args): Promise<McpToolResponse> => {
                const {srcViewId, name} = args as unknown as GraphCloneView.Request
                return json(await client.views.clone(srcViewId, name))
            },
        },
        {
            name: M.deleteView,
            inputShape: {viewId: z.string()},
            handler: async (args): Promise<McpToolResponse> => {
                const {viewId} = args as unknown as GraphDeleteView.Request
                await client.views.delete(viewId)
                return json(null)
            },
        },
    ]
}

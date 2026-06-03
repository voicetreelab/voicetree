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
import type {GraphNode} from '@vt/graph-model/graph'
import type {ProjectedGraph} from '@vt/graph-state/contract'
import {
    GRAPH_GATEWAY_METHODS,
    type GraphActivateView,
    type GraphAddStarredFolder,
    type GraphApplyDelta,
    type GraphCloneView,
    type GraphCopyNodeToFolder,
    type GraphCreateContextNode,
    type GraphCreateSubfolder,
    type GraphDeleteView,
    type GraphFindFileByName,
    type GraphGetAvailableFolders,
    type GraphGetDirectoryTree,
    type GraphGetFolderTreeSync,
    type GraphGetNode,
    type GraphGetPreviewContainedNodeIds,
    type GraphOpenProject,
    type GraphRemoveStarredFolder,
    type GraphSetWriteFolderPath,
    type GraphWriteMarkdownFile,
    type GraphWritePositions,
} from '@vt/vt-daemon-protocol'
import {
    addStarredFolder,
    buildFolderTreeSyncPayload,
    copyNodeToFolder,
    createSubfolder,
    getDirectoryTree,
    getStarredFolders,
    isPathWithinAllowlist,
    removeStarredFolder,
    selectAvailableFolders,
} from '@vt/app-config/folders'
import {createDatedSubfolder} from '@vt/app-config/project'

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
                // Defence in depth: a browser may only write inside the project
                // allowlist. Legitimate saves target loaded node paths (always
                // within the allowlist), so this never fires for real clients —
                // it stops a stolen/minted token from writing arbitrary files.
                const projectState = await client.getProject()
                if (!(await isPathWithinAllowlist(absolutePath, projectState))) {
                    throw new Error('writeMarkdownFile: target path is outside the project allowlist')
                }
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
                return json(await client.writeNodeLayout(positions))
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
                // The write folder must stay inside the allowlist: graphd loads
                // (reads) the target and persists it as the write destination, so
                // an unscoped path is both a read and a write escape. New dated
                // folders are created under the project (createDatedVoiceTreeFolder
                // calls the client directly), so legitimate switches pass.
                const projectState = await client.getProject()
                if (!(await isPathWithinAllowlist(path, projectState))) {
                    throw new Error('setWriteFolderPath: path is outside the project allowlist')
                }
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

        // --- Folders (browser-mode daemon-served folder browser) -------------
        // The browser never touches the filesystem; VTD owns FS and serves these
        // scoped to the project's allowlist (project root + read paths, via
        // `client.getProject()`). Folder operations that would escape the
        // allowlist return an empty/null/failed result rather than reaching disk.
        {
            name: M.getFolderTreeSync,
            handler: async (): Promise<McpToolResponse> => {
                const [projectState, graph] = await Promise.all([client.getProject(), client.getGraph()])
                const payload = await buildFolderTreeSyncPayload(
                    projectState,
                    new Set<string>(Object.keys(graph.nodes)),
                )
                const response: GraphGetFolderTreeSync.Response = {
                    ...payload,
                    readPaths: projectState.readPaths,
                    writeFolderPath: projectState.writeFolderPath,
                }
                return json(response)
            },
        },
        {
            name: M.getAvailableFolders,
            inputShape: {searchQuery: z.string()},
            handler: async (args): Promise<McpToolResponse> => {
                const {searchQuery} = args as unknown as GraphGetAvailableFolders.Request
                return json(await selectAvailableFolders(await client.getProject(), searchQuery))
            },
        },
        {
            name: M.getDirectoryTree,
            inputShape: {rootPath: z.string(), maxDepth: z.number().optional()},
            handler: async (args): Promise<McpToolResponse> => {
                const {rootPath, maxDepth} = args as unknown as GraphGetDirectoryTree.Request
                const projectState = await client.getProject()
                if (!(await isPathWithinAllowlist(rootPath, projectState))) return json(null)
                const tree = maxDepth === undefined
                    ? await getDirectoryTree(rootPath)
                    : await getDirectoryTree(rootPath, maxDepth)
                return json(tree)
            },
        },
        {
            name: M.createSubfolder,
            inputShape: {parentPath: z.string(), folderName: z.string()},
            handler: async (args): Promise<McpToolResponse> => {
                const {parentPath, folderName} = args as unknown as GraphCreateSubfolder.Request
                const projectState = await client.getProject()
                if (!(await isPathWithinAllowlist(parentPath, projectState))) {
                    return json({success: false, error: 'Parent folder is outside the project allowlist'})
                }
                return json(await createSubfolder(parentPath, folderName))
            },
        },
        {
            name: M.createDatedVoiceTreeFolder,
            handler: async (): Promise<McpToolResponse> => {
                try {
                    const {projectRoot} = await client.getProject()
                    const newPath: string = await createDatedSubfolder(projectRoot)
                    // Create the dated folder and make it the active write target.
                    // (Electron additionally unloads the prior read paths for a
                    // blank canvas; graphd exposes no read-path-removal route via
                    // the gateway client, so browser-mode leaves prior folders
                    // loaded — the new folder is still where new nodes are written.)
                    await client.setWriteFolderPath(newPath)
                    return json({success: true, path: newPath})
                } catch (error) {
                    const message: string = error instanceof Error ? error.message : String(error)
                    return json({success: false, error: message})
                }
            },
        },
        {
            name: M.getStarredFolders,
            handler: async (): Promise<McpToolResponse> => json(await getStarredFolders()),
        },
        {
            name: M.addStarredFolder,
            inputShape: {folderPath: z.string()},
            handler: async (args): Promise<McpToolResponse> => {
                const {folderPath} = args as unknown as GraphAddStarredFolder.Request
                const projectState = await client.getProject()
                // Starred trees are scanned by getFolderTreeSync, so a starred path
                // must stay inside the allowlist — never let a browser star (and
                // thereby have the daemon scan) an arbitrary filesystem location.
                if (await isPathWithinAllowlist(folderPath, projectState)) await addStarredFolder(folderPath)
                return json(null)
            },
        },
        {
            name: M.removeStarredFolder,
            inputShape: {folderPath: z.string()},
            handler: async (args): Promise<McpToolResponse> => {
                const {folderPath} = args as unknown as GraphRemoveStarredFolder.Request
                await removeStarredFolder(folderPath)
                return json(null)
            },
        },
        {
            name: M.copyNodeToFolder,
            inputShape: {nodeId: z.string(), targetFolderPath: z.string()},
            handler: async (args): Promise<McpToolResponse> => {
                const {nodeId, targetFolderPath} = args as unknown as GraphCopyNodeToFolder.Request
                const projectState = await client.getProject()
                if (!(await isPathWithinAllowlist(targetFolderPath, projectState))) {
                    return json({success: false, targetPath: '', error: 'Target folder is outside the project allowlist'})
                }
                const graph = await client.getGraph()
                // graphd's GraphState.nodes is typed `unknown`-valued over the
                // wire; the shape is the graph-model GraphNode the copy needs.
                const node = graph.nodes[nodeId] as GraphNode | undefined
                return json(await copyNodeToFolder(node, nodeId, targetFolderPath))
            },
        },
    ]
}

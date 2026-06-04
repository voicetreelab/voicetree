// Typed graph surface over the VTD gateway (JSON-RPC `graph.*` methods).
//
// Under the gateway model the browser talks ONLY to VTD; vt-graphd is
// loopback-internal behind it. Every graph read/mutation/view op is a
// `graph.*` RPC. This module is the typed deep-narrow layer: ONE parameterised
// invoker (`graphCall`) binds a method name + Response type from the shared
// `@vt/vt-daemon-protocol` contract; each export below is a config line — a
// method + a positional→named param map — over that single shape, NOT a
// re-implemented call. Method-name strings and wire shapes are never
// re-declared here: a rename in the contract is picked up automatically.
//
// Session is implicit: VTD owns the single graphd session (created on
// `graph.openProject`) and injects `X-Session-Id` itself, so no graph call
// carries a sessionId.

import {
    GATEWAY_METHODS,
    type GraphOpenProject,
    type GraphGetProject,
    type GraphGetGraph,
    type GraphGetNode,
    type GraphGetProjectedGraph,
    type GraphApplyDelta,
    type GraphWriteMarkdownFile,
    type GraphWritePositions,
    type GraphFindFileByName,
    type GraphGetPreviewContainedNodeIds,
    type GraphCreateContextNode,
    type GraphUndo,
    type GraphRedo,
    type GraphSetWriteFolderPath,
    type GraphListViews,
    type GraphActivateView,
    type GraphCloneView,
    type GraphDeleteView,
    type GraphGetFolderTreeSync,
    type GraphGetAvailableFolders,
    type GraphCreateSubfolder,
    type GraphCreateDatedVoiceTreeFolder,
    type GraphGetStarredFolders,
    type GraphCopyNodeToFolder,
} from '@vt/vt-daemon-protocol'
import type {Graph, GraphDelta, Position} from '@vt/graph-model/graph'
import {rehydrateSerializedGraph} from '@vt/graph-model/graph'
import type {DirectoryEntry} from '@vt/graph-model/folders'
import {callVtdRpc} from './vtdRpc'

/**
 * Bind a `graph.*` method + its positional→named param mapping into a typed
 * `(vtdUrl, token, ...args) => Promise<Resp>` caller. `Args` is the wrapper's
 * public positional signature; `toParams` names those positional args into the
 * RPC params object. This is the single shared call shape behind every export
 * below — the per-method `toParams` carries the only real per-call variation.
 */
const graphCall =
    <Args extends readonly unknown[], Resp>(
        method: string,
        toParams: (...args: Args) => Record<string, unknown>,
    ) =>
    (u: string, t: string, ...args: Args): Promise<Resp> =>
        callVtdRpc<Resp>(u, t, method, toParams(...args))

const M = GATEWAY_METHODS.graph

// Boot — establishes/ensures the VTD-owned graphd session and returns the first
// render frame in one round-trip.
export const vtdOpenProject =
    graphCall<[], GraphOpenProject.Response>(M.openProject, () => ({}))

// ── Reads ───────────────────────────────────────────────────────────────────
export const vtdGetProject =
    graphCall<[], GraphGetProject.Response>(M.getProject, () => ({}))

// Whole-graph read. The `Graph`'s Map indexes don't survive JSON (they arrive
// as `{}`), so — unlike the other `graph.*` reads — this one cannot be a bare
// `graphCall`: it must rehydrate the indexes before handing back a `Graph`, or
// every client-side graph algorithm (e.g. findMostConnectedNode) sees broken
// `.get`. Mirrors the Electron daemon-query and vt-daemon bridge paths.
const getGraphRaw =
    graphCall<[], GraphGetGraph.Response>(M.getGraph, () => ({}))

export const vtdGetGraph = async (u: string, t: string): Promise<Graph> =>
    rehydrateSerializedGraph(await getGraphRaw(u, t))

export const vtdGetNode =
    graphCall<[nodeId: string], GraphGetNode.Response>(M.getNode, (nodeId) => ({nodeId}))

export const vtdGetProjectedGraph =
    graphCall<[], GraphGetProjectedGraph.Response>(M.getProjectedGraph, () => ({}))

// ── Mutations ─────────────────────────────────────────────────────────────────
export const vtdApplyDelta =
    graphCall<[delta: GraphDelta, recordForUndo?: boolean], GraphApplyDelta.Response>(
        M.applyDelta, (delta, recordForUndo) => ({delta, recordForUndo}))

export const vtdWriteMarkdownFile =
    graphCall<[absolutePath: string, body: string, editorId: string], GraphWriteMarkdownFile.Response>(
        M.writeMarkdownFile, (absolutePath, body, editorId) => ({absolutePath, body, editorId}))

export const vtdWritePositions =
    graphCall<[positions: Record<string, Position>], GraphWritePositions.Response>(
        M.writePositions, (positions) => ({positions}))

export const vtdFindFileByName =
    graphCall<[name: string], GraphFindFileByName.Response>(M.findFileByName, (name) => ({name}))

export const vtdGetPreviewContainedNodeIds =
    graphCall<[nodeId: string], GraphGetPreviewContainedNodeIds.Response>(
        M.getPreviewContainedNodeIds, (nodeId) => ({nodeId}))

export const vtdCreateContextNode =
    graphCall<[parentNodeId: string, semanticNodeIds: readonly string[]], GraphCreateContextNode.Response>(
        M.createContextNode, (parentNodeId, semanticNodeIds) => ({parentNodeId, semanticNodeIds}))

export const vtdUndo =
    graphCall<[], GraphUndo.Response>(M.undo, () => ({}))

export const vtdRedo =
    graphCall<[], GraphRedo.Response>(M.redo, () => ({}))

export const vtdSetWriteFolderPath =
    graphCall<[path: string], GraphSetWriteFolderPath.Response>(M.setWriteFolderPath, (path) => ({path}))

// ── Views ─────────────────────────────────────────────────────────────────────
export const vtdListViews =
    graphCall<[], GraphListViews.Response>(M.listViews, () => ({}))

export const vtdActivateView =
    graphCall<[viewId: string], GraphActivateView.Response>(M.activateView, (viewId) => ({viewId}))

export const vtdCloneView =
    graphCall<[srcViewId: string, name: string], GraphCloneView.Response>(
        M.cloneView, (srcViewId, name) => ({srcViewId, name}))

export const vtdDeleteView =
    graphCall<[viewId: string], GraphDeleteView.Response>(M.deleteView, (viewId) => ({viewId}))

// ── Folders (daemon-served folder browser) ──────────────────────────────────
export const vtdGetFolderTreeSync =
    graphCall<[], GraphGetFolderTreeSync.Response>(M.getFolderTreeSync, () => ({}))

export const vtdGetAvailableFolders =
    graphCall<[searchQuery: string], GraphGetAvailableFolders.Response>(
        M.getAvailableFolders, (searchQuery) => ({searchQuery}))

// The wire carries a RAW scan (plain-string paths, GraphGetDirectoryTree.Response);
// brand it to the renderer-facing `DirectoryEntry | null` at this client boundary
// (zero-cost — `AbsolutePath` is a compile-time-only brand), so the browser HostAPI
// adapter keeps the same shape Electron's folderQueries returns.
export const vtdGetDirectoryTree =
    graphCall<[rootPath: string, maxDepth?: number], DirectoryEntry | null>(
        M.getDirectoryTree, (rootPath, maxDepth) => ({rootPath, maxDepth}))

export const vtdCreateSubfolder =
    graphCall<[parentPath: string, folderName: string], GraphCreateSubfolder.Response>(
        M.createSubfolder, (parentPath, folderName) => ({parentPath, folderName}))

export const vtdCreateDatedVoiceTreeFolder =
    graphCall<[], GraphCreateDatedVoiceTreeFolder.Response>(M.createDatedVoiceTreeFolder, () => ({}))

export const vtdGetStarredFolders =
    graphCall<[], GraphGetStarredFolders.Response>(M.getStarredFolders, () => ({}))

export const vtdAddStarredFolder =
    graphCall<[folderPath: string], void>(M.addStarredFolder, (folderPath) => ({folderPath}))

export const vtdRemoveStarredFolder =
    graphCall<[folderPath: string], void>(M.removeStarredFolder, (folderPath) => ({folderPath}))

export const vtdCopyNodeToFolder =
    graphCall<[nodeId: string, targetFolderPath: string], GraphCopyNodeToFolder.Response>(
        M.copyNodeToFolder, (nodeId, targetFolderPath) => ({nodeId, targetFolderPath}))

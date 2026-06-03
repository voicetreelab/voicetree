// Typed graph surface over the VTD gateway (JSON-RPC `graph.*` methods).
//
// Under the gateway model the browser talks ONLY to VTD; vt-graphd is
// loopback-internal behind it. Every graph read/mutation/view op is a
// `graph.*` RPC. This module is the typed deep-narrow layer: each function is a
// one-liner over `callVtdRpc` (the low-level transport in vtdRpc.ts), binding a
// method name + Request/Response type from the ONE shared contract in
// `@vt/vt-daemon-protocol`. Method-name strings and wire shapes are never
// re-declared here — a rename in the contract is picked up automatically.
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
    type GraphGetDirectoryTree,
    type GraphCreateSubfolder,
    type GraphCreateDatedVoiceTreeFolder,
    type GraphGetStarredFolders,
    type GraphCopyNodeToFolder,
} from '@vt/vt-daemon-protocol'
import type {GraphDelta, Position} from '@vt/graph-model/graph'
import {callVtdRpc} from './vtdRpc'

// Boot — establishes/ensures the VTD-owned graphd session and returns the first
// render frame in one round-trip.
export const vtdOpenProject = (u: string, t: string): Promise<GraphOpenProject.Response> =>
    callVtdRpc<GraphOpenProject.Response>(u, t, GATEWAY_METHODS.graph.openProject, {})

// ── Reads ───────────────────────────────────────────────────────────────────
export const vtdGetProject = (u: string, t: string): Promise<GraphGetProject.Response> =>
    callVtdRpc<GraphGetProject.Response>(u, t, GATEWAY_METHODS.graph.getProject, {})

export const vtdGetGraph = (u: string, t: string): Promise<GraphGetGraph.Response> =>
    callVtdRpc<GraphGetGraph.Response>(u, t, GATEWAY_METHODS.graph.getGraph, {})

export const vtdGetNode = (u: string, t: string, nodeId: string): Promise<GraphGetNode.Response> =>
    callVtdRpc<GraphGetNode.Response>(u, t, GATEWAY_METHODS.graph.getNode, {nodeId})

export const vtdGetProjectedGraph = (u: string, t: string): Promise<GraphGetProjectedGraph.Response> =>
    callVtdRpc<GraphGetProjectedGraph.Response>(u, t, GATEWAY_METHODS.graph.getProjectedGraph, {})

// ── Mutations ─────────────────────────────────────────────────────────────────
export const vtdApplyDelta = (
    u: string, t: string, delta: GraphDelta, recordForUndo?: boolean,
): Promise<GraphApplyDelta.Response> =>
    callVtdRpc<GraphApplyDelta.Response>(u, t, GATEWAY_METHODS.graph.applyDelta, {delta, recordForUndo})

export const vtdWriteMarkdownFile = (
    u: string, t: string, absolutePath: string, body: string, editorId: string,
): Promise<GraphWriteMarkdownFile.Response> =>
    callVtdRpc<GraphWriteMarkdownFile.Response>(u, t, GATEWAY_METHODS.graph.writeMarkdownFile, {absolutePath, body, editorId})

export const vtdWritePositions = (
    u: string, t: string, positions: Record<string, Position>,
): Promise<GraphWritePositions.Response> =>
    callVtdRpc<GraphWritePositions.Response>(u, t, GATEWAY_METHODS.graph.writePositions, {positions})

export const vtdFindFileByName = (u: string, t: string, name: string): Promise<GraphFindFileByName.Response> =>
    callVtdRpc<GraphFindFileByName.Response>(u, t, GATEWAY_METHODS.graph.findFileByName, {name})

export const vtdGetPreviewContainedNodeIds = (
    u: string, t: string, nodeId: string,
): Promise<GraphGetPreviewContainedNodeIds.Response> =>
    callVtdRpc<GraphGetPreviewContainedNodeIds.Response>(u, t, GATEWAY_METHODS.graph.getPreviewContainedNodeIds, {nodeId})

export const vtdCreateContextNode = (
    u: string, t: string, parentNodeId: string, semanticNodeIds: readonly string[],
): Promise<GraphCreateContextNode.Response> =>
    callVtdRpc<GraphCreateContextNode.Response>(u, t, GATEWAY_METHODS.graph.createContextNode, {parentNodeId, semanticNodeIds})

export const vtdUndo = (u: string, t: string): Promise<GraphUndo.Response> =>
    callVtdRpc<GraphUndo.Response>(u, t, GATEWAY_METHODS.graph.undo, {})

export const vtdRedo = (u: string, t: string): Promise<GraphRedo.Response> =>
    callVtdRpc<GraphRedo.Response>(u, t, GATEWAY_METHODS.graph.redo, {})

export const vtdSetWriteFolderPath = (
    u: string, t: string, path: string,
): Promise<GraphSetWriteFolderPath.Response> =>
    callVtdRpc<GraphSetWriteFolderPath.Response>(u, t, GATEWAY_METHODS.graph.setWriteFolderPath, {path})

// ── Views ─────────────────────────────────────────────────────────────────────
export const vtdListViews = (u: string, t: string): Promise<GraphListViews.Response> =>
    callVtdRpc<GraphListViews.Response>(u, t, GATEWAY_METHODS.graph.listViews, {})

export const vtdActivateView = (u: string, t: string, viewId: string): Promise<GraphActivateView.Response> =>
    callVtdRpc<GraphActivateView.Response>(u, t, GATEWAY_METHODS.graph.activateView, {viewId})

export const vtdCloneView = (
    u: string, t: string, srcViewId: string, name: string,
): Promise<GraphCloneView.Response> =>
    callVtdRpc<GraphCloneView.Response>(u, t, GATEWAY_METHODS.graph.cloneView, {srcViewId, name})

export const vtdDeleteView = (u: string, t: string, viewId: string): Promise<GraphDeleteView.Response> =>
    callVtdRpc<GraphDeleteView.Response>(u, t, GATEWAY_METHODS.graph.deleteView, {viewId})

// ── Folders (daemon-served folder browser) ──────────────────────────────────
export const vtdGetFolderTreeSync = (u: string, t: string): Promise<GraphGetFolderTreeSync.Response> =>
    callVtdRpc<GraphGetFolderTreeSync.Response>(u, t, GATEWAY_METHODS.graph.getFolderTreeSync, {})

export const vtdGetAvailableFolders = (
    u: string, t: string, searchQuery: string,
): Promise<GraphGetAvailableFolders.Response> =>
    callVtdRpc<GraphGetAvailableFolders.Response>(u, t, GATEWAY_METHODS.graph.getAvailableFolders, {searchQuery})

export const vtdGetDirectoryTree = (
    u: string, t: string, rootPath: string, maxDepth?: number,
): Promise<GraphGetDirectoryTree.Response> =>
    callVtdRpc<GraphGetDirectoryTree.Response>(u, t, GATEWAY_METHODS.graph.getDirectoryTree, {rootPath, maxDepth})

export const vtdCreateSubfolder = (
    u: string, t: string, parentPath: string, folderName: string,
): Promise<GraphCreateSubfolder.Response> =>
    callVtdRpc<GraphCreateSubfolder.Response>(u, t, GATEWAY_METHODS.graph.createSubfolder, {parentPath, folderName})

export const vtdCreateDatedVoiceTreeFolder = (
    u: string, t: string,
): Promise<GraphCreateDatedVoiceTreeFolder.Response> =>
    callVtdRpc<GraphCreateDatedVoiceTreeFolder.Response>(u, t, GATEWAY_METHODS.graph.createDatedVoiceTreeFolder, {})

export const vtdGetStarredFolders = (u: string, t: string): Promise<GraphGetStarredFolders.Response> =>
    callVtdRpc<GraphGetStarredFolders.Response>(u, t, GATEWAY_METHODS.graph.getStarredFolders, {})

export const vtdAddStarredFolder = (u: string, t: string, folderPath: string): Promise<void> =>
    callVtdRpc<void>(u, t, GATEWAY_METHODS.graph.addStarredFolder, {folderPath})

export const vtdRemoveStarredFolder = (u: string, t: string, folderPath: string): Promise<void> =>
    callVtdRpc<void>(u, t, GATEWAY_METHODS.graph.removeStarredFolder, {folderPath})

export const vtdCopyNodeToFolder = (
    u: string, t: string, nodeId: string, targetFolderPath: string,
): Promise<GraphCopyNodeToFolder.Response> =>
    callVtdRpc<GraphCopyNodeToFolder.Response>(u, t, GATEWAY_METHODS.graph.copyNodeToFolder, {nodeId, targetFolderPath})

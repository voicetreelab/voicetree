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
    GRAPH_GATEWAY_METHODS,
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
} from '@vt/vt-daemon-protocol'
import type {GraphDelta, Position} from '@vt/graph-model/graph'
import {callVtdRpc} from './vtdRpc'

// Boot — establishes/ensures the VTD-owned graphd session and returns the first
// render frame in one round-trip.
export const vtdOpenProject = (u: string, t: string): Promise<GraphOpenProject.Response> =>
    callVtdRpc<GraphOpenProject.Response>(u, t, GRAPH_GATEWAY_METHODS.openProject, {})

// ── Reads ───────────────────────────────────────────────────────────────────
export const vtdGetProject = (u: string, t: string): Promise<GraphGetProject.Response> =>
    callVtdRpc<GraphGetProject.Response>(u, t, GRAPH_GATEWAY_METHODS.getProject, {})

export const vtdGetGraph = (u: string, t: string): Promise<GraphGetGraph.Response> =>
    callVtdRpc<GraphGetGraph.Response>(u, t, GRAPH_GATEWAY_METHODS.getGraph, {})

export const vtdGetNode = (u: string, t: string, nodeId: string): Promise<GraphGetNode.Response> =>
    callVtdRpc<GraphGetNode.Response>(u, t, GRAPH_GATEWAY_METHODS.getNode, {nodeId})

export const vtdGetProjectedGraph = (u: string, t: string): Promise<GraphGetProjectedGraph.Response> =>
    callVtdRpc<GraphGetProjectedGraph.Response>(u, t, GRAPH_GATEWAY_METHODS.getProjectedGraph, {})

// ── Mutations ─────────────────────────────────────────────────────────────────
export const vtdApplyDelta = (
    u: string, t: string, delta: GraphDelta, recordForUndo?: boolean,
): Promise<GraphApplyDelta.Response> =>
    callVtdRpc<GraphApplyDelta.Response>(u, t, GRAPH_GATEWAY_METHODS.applyDelta, {delta, recordForUndo})

export const vtdWriteMarkdownFile = (
    u: string, t: string, absolutePath: string, body: string, editorId: string,
): Promise<GraphWriteMarkdownFile.Response> =>
    callVtdRpc<GraphWriteMarkdownFile.Response>(u, t, GRAPH_GATEWAY_METHODS.writeMarkdownFile, {absolutePath, body, editorId})

export const vtdWritePositions = (
    u: string, t: string, positions: Record<string, Position>,
): Promise<GraphWritePositions.Response> =>
    callVtdRpc<GraphWritePositions.Response>(u, t, GRAPH_GATEWAY_METHODS.writePositions, {positions})

export const vtdFindFileByName = (u: string, t: string, name: string): Promise<GraphFindFileByName.Response> =>
    callVtdRpc<GraphFindFileByName.Response>(u, t, GRAPH_GATEWAY_METHODS.findFileByName, {name})

export const vtdGetPreviewContainedNodeIds = (
    u: string, t: string, nodeId: string,
): Promise<GraphGetPreviewContainedNodeIds.Response> =>
    callVtdRpc<GraphGetPreviewContainedNodeIds.Response>(u, t, GRAPH_GATEWAY_METHODS.getPreviewContainedNodeIds, {nodeId})

export const vtdCreateContextNode = (
    u: string, t: string, parentNodeId: string, semanticNodeIds: readonly string[],
): Promise<GraphCreateContextNode.Response> =>
    callVtdRpc<GraphCreateContextNode.Response>(u, t, GRAPH_GATEWAY_METHODS.createContextNode, {parentNodeId, semanticNodeIds})

export const vtdUndo = (u: string, t: string): Promise<GraphUndo.Response> =>
    callVtdRpc<GraphUndo.Response>(u, t, GRAPH_GATEWAY_METHODS.undo, {})

export const vtdRedo = (u: string, t: string): Promise<GraphRedo.Response> =>
    callVtdRpc<GraphRedo.Response>(u, t, GRAPH_GATEWAY_METHODS.redo, {})

export const vtdSetWriteFolderPath = (
    u: string, t: string, path: string,
): Promise<GraphSetWriteFolderPath.Response> =>
    callVtdRpc<GraphSetWriteFolderPath.Response>(u, t, GRAPH_GATEWAY_METHODS.setWriteFolderPath, {path})

// ── Views ─────────────────────────────────────────────────────────────────────
export const vtdListViews = (u: string, t: string): Promise<GraphListViews.Response> =>
    callVtdRpc<GraphListViews.Response>(u, t, GRAPH_GATEWAY_METHODS.listViews, {})

export const vtdActivateView = (u: string, t: string, viewId: string): Promise<GraphActivateView.Response> =>
    callVtdRpc<GraphActivateView.Response>(u, t, GRAPH_GATEWAY_METHODS.activateView, {viewId})

export const vtdCloneView = (
    u: string, t: string, srcViewId: string, name: string,
): Promise<GraphCloneView.Response> =>
    callVtdRpc<GraphCloneView.Response>(u, t, GRAPH_GATEWAY_METHODS.cloneView, {srcViewId, name})

export const vtdDeleteView = (u: string, t: string, viewId: string): Promise<GraphDeleteView.Response> =>
    callVtdRpc<GraphDeleteView.Response>(u, t, GRAPH_GATEWAY_METHODS.deleteView, {viewId})

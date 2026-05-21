/**
 * Serialization layer for graph-state fixtures.
 *
 * Splits the JSON-shape conversion (Serialized* types + serialize/hydrate
 * functions) out of `fixtures.ts` so the parent file stays under the 500-
 * line ratchet. fixtures.ts re-exports from here for backwards-compat.
 *
 * Extracted at L2-BF-167 — the SetZoom/SetPan/SetPositions/RequestFit
 * additions pushed fixtures.ts over the size limit.
 */
import * as O from 'fp-ts/lib/Option.js'

import {
    toAbsolutePath,
    type FolderTreeNode,
    type Graph,
    type GraphNode,
    type Position,
} from '@vt/graph-model'

import type { Command, State } from '../contract'
import { deriveImplicitRoots } from '../state/folderVisibility/implicitRoots'
import { stripTrailingSlash } from '../state/folderVisibility/path'
import type { FolderState } from '../state/folderVisibility/types'

// ============================================================================
// SHAPES (JSON-serializable)
// ============================================================================

export type SerializedOption<T> =
    | { readonly _tag: 'None' }
    | { readonly _tag: 'Some'; readonly value: T }

export interface SerializedEdge {
    readonly targetId: string
    readonly label: string
}

export interface SerializedGraphNode {
    readonly kind?: GraphNode['kind']
    readonly outgoingEdges: readonly SerializedEdge[]
    readonly absoluteFilePathIsID: string
    readonly contentWithoutYamlOrLinks: string
    readonly nodeUIMetadata: {
        readonly color: SerializedOption<string>
        readonly position: SerializedOption<Position>
        readonly additionalYAMLProps: readonly (readonly [string, string])[]
        readonly isContextNode?: boolean
        readonly containedNodeIds?: readonly string[]
    }
}

export interface SerializedGraph {
    readonly nodes: Record<string, SerializedGraphNode>
    readonly incomingEdgesIndex: readonly (readonly [string, readonly string[]])[]
    readonly nodeByBaseName: readonly (readonly [string, readonly string[]])[]
    readonly unresolvedLinksIndex: readonly (readonly [string, readonly string[]])[]
}

export interface SerializedFolderTreeNode {
    readonly name: string
    readonly absolutePath: string
    readonly children: readonly (SerializedFolderTreeNode | SerializedFileTreeNode)[]
    readonly loadState: 'loaded' | 'not-loaded'
    readonly isWriteTarget: boolean
}

export interface SerializedFileTreeNode {
    readonly name: string
    readonly absolutePath: string
    readonly isInGraph: boolean
}

export interface SerializedState {
    readonly graph: SerializedGraph
    readonly roots: {
        readonly loaded?: readonly string[]
        readonly folderTree: readonly SerializedFolderTreeNode[]
    }
    readonly folderState?: readonly (readonly [string, FolderState])[]
    readonly activeView?: {
        readonly viewId: string
        readonly name: string
    }
    readonly collapseSet?: readonly string[]
    readonly selection: readonly string[]
    readonly layout: {
        readonly positions: readonly (readonly [string, Position])[]
        readonly zoom?: number
        readonly pan?: Position
        readonly fit?: { readonly paddingPx: number } | null
    }
    readonly meta: {
        readonly schemaVersion: 1
        readonly revision: number
        readonly mutatedAt?: string
    }
}

export type SerializedCommand =
    | { readonly type: 'Select'; readonly ids: readonly string[]; readonly additive?: boolean }
    | { readonly type: 'Deselect'; readonly ids: readonly string[] }
    | { readonly type: 'AddNode'; readonly node: SerializedGraphNode }
    | { readonly type: 'RemoveNode'; readonly id: string }
    | { readonly type: 'AddEdge'; readonly source: string; readonly edge: SerializedEdge }
    | { readonly type: 'RemoveEdge'; readonly source: string; readonly targetId: string }
    | { readonly type: 'Move'; readonly id: string; readonly to: Position }
    | { readonly type: 'SetFolderState'; readonly viewId: string; readonly path: string; readonly state: FolderState }
    | { readonly type: 'SetZoom'; readonly zoom: number }
    | { readonly type: 'SetPan'; readonly pan: Position }
    | { readonly type: 'SetPositions'; readonly positions: ReadonlyArray<readonly [string, Position]> }
    | { readonly type: 'RequestFit'; readonly paddingPx?: number }

// ============================================================================
// HELPERS
// ============================================================================

function sortStrings(values: readonly string[]): readonly string[] {
    return [...values].sort((left: string, right: string) => left.localeCompare(right))
}

function none<T>(): SerializedOption<T> {
    return { _tag: 'None' }
}

function some<T>(value: T): SerializedOption<T> {
    return { _tag: 'Some', value }
}

function serializeOption<T>(value: O.Option<T>): SerializedOption<T> {
    return O.isSome(value) ? some(value.value) : none()
}

function hydrateOption<T>(value: SerializedOption<T>): O.Option<T> {
    return value._tag === 'Some' ? O.some(value.value) : O.none
}

function serializeMap<V>(
    map: ReadonlyMap<string, V>,
    serializeValue: (value: V) => V = (value: V): V => value
): readonly (readonly [string, V])[] {
    return [...map.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, serializeValue(value)] as const)
}

function hydrateMap<V>(entries: readonly (readonly [string, V])[]): ReadonlyMap<string, V> {
    return new Map(entries)
}

function toFolderId(path: string): string {
    return path.endsWith('/') ? path : `${path}/`
}

function serializeFolderState(state: State): readonly (readonly [string, FolderState])[] {
    const rows = new Map<string, FolderState>()
    for (const root of state.roots.loaded) {
        rows.set(stripTrailingSlash(root), 'expanded')
    }
    for (const folder of state.collapseSet) {
        rows.set(stripTrailingSlash(folder), 'collapsed')
    }
    return [...rows.entries()].sort(([left], [right]) => left.localeCompare(right))
}

function legacyFolderState(state: SerializedState): readonly (readonly [string, FolderState])[] {
    const rows = new Map<string, FolderState>()
    for (const root of state.roots.loaded ?? []) {
        rows.set(stripTrailingSlash(root), 'expanded')
    }
    for (const folder of state.collapseSet ?? []) {
        rows.set(stripTrailingSlash(folder), 'collapsed')
    }
    return [...rows.entries()].sort(([left], [right]) => left.localeCompare(right))
}

// ============================================================================
// GRAPH NODE
// ============================================================================

function serializeRecord(record: Record<string, string>): readonly (readonly [string, string])[] {
    return Object.entries(record)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, value] as const)
}

export function serializeGraphNode(node: GraphNode): SerializedGraphNode {
    return {
        kind: node.kind,
        outgoingEdges: [...node.outgoingEdges]
            .sort(
                (left, right) =>
                    left.targetId.localeCompare(right.targetId)
                    || left.label.localeCompare(right.label)
            )
            .map((edge) => ({ targetId: edge.targetId, label: edge.label })),
        absoluteFilePathIsID: node.absoluteFilePathIsID,
        contentWithoutYamlOrLinks: node.contentWithoutYamlOrLinks,
        nodeUIMetadata: {
            color: serializeOption(node.nodeUIMetadata.color),
            position: serializeOption(node.nodeUIMetadata.position),
            additionalYAMLProps: serializeRecord(node.nodeUIMetadata.additionalYAMLProps),
            ...(node.nodeUIMetadata.isContextNode === true ? { isContextNode: true } : {}),
            ...(node.nodeUIMetadata.containedNodeIds
                ? { containedNodeIds: sortStrings(node.nodeUIMetadata.containedNodeIds) }
                : {}),
        },
    }
}

export function hydrateGraphNode(node: SerializedGraphNode): GraphNode {
    return {
        kind: node.kind ?? 'leaf',
        outgoingEdges: node.outgoingEdges.map((edge) => ({
            targetId: edge.targetId,
            label: edge.label,
        })),
        absoluteFilePathIsID: node.absoluteFilePathIsID,
        contentWithoutYamlOrLinks: node.contentWithoutYamlOrLinks,
        nodeUIMetadata: {
            color: hydrateOption(node.nodeUIMetadata.color),
            position: hydrateOption(node.nodeUIMetadata.position),
            additionalYAMLProps: Object.fromEntries(node.nodeUIMetadata.additionalYAMLProps),
            ...(node.nodeUIMetadata.isContextNode === true ? { isContextNode: true } : {}),
            ...(node.nodeUIMetadata.containedNodeIds
                ? { containedNodeIds: [...node.nodeUIMetadata.containedNodeIds] }
                : {}),
        },
    }
}

// ============================================================================
// GRAPH
// ============================================================================

function serializeGraph(graph: Graph): SerializedGraph {
    const sortedNodeEntries = Object.entries(graph.nodes)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([nodeId, node]) => [nodeId, serializeGraphNode(node)] as const)

    return {
        nodes: Object.fromEntries(sortedNodeEntries),
        incomingEdgesIndex: serializeMap(
            graph.incomingEdgesIndex,
            (value) => sortStrings(value) as readonly string[],
        ),
        nodeByBaseName: serializeMap(
            graph.nodeByBaseName,
            (value) => sortStrings(value) as readonly string[],
        ),
        unresolvedLinksIndex: serializeMap(
            graph.unresolvedLinksIndex,
            (value) => sortStrings(value) as readonly string[],
        ),
    }
}

function hydrateGraph(graph: SerializedGraph): Graph {
    const nodes: Record<string, GraphNode> = Object.fromEntries(
        Object.entries(graph.nodes).map(([nodeId, node]) => [nodeId, hydrateGraphNode(node)]),
    )

    return {
        nodes,
        incomingEdgesIndex: hydrateMap(
            graph.incomingEdgesIndex.map(([key, value]) => [key, [...value]] as const),
        ),
        nodeByBaseName: hydrateMap(
            graph.nodeByBaseName.map(([key, value]) => [key, [...value]] as const),
        ),
        unresolvedLinksIndex: hydrateMap(
            graph.unresolvedLinksIndex.map(([key, value]) => [key, [...value]] as const),
        ),
    }
}

// ============================================================================
// FOLDER TREE
// ============================================================================

function serializeFolderTreeNode(node: FolderTreeNode): SerializedFolderTreeNode {
    return {
        name: node.name,
        absolutePath: node.absolutePath,
        children: node.children.map((child) => (
            'children' in child
                ? serializeFolderTreeNode(child)
                : {
                    name: child.name,
                    absolutePath: child.absolutePath,
                    isInGraph: child.isInGraph,
                }
        )),
        loadState: node.loadState,
        isWriteTarget: node.isWriteTarget,
    }
}

function hydrateFolderTreeNode(node: SerializedFolderTreeNode): FolderTreeNode {
    return {
        name: node.name,
        absolutePath: toAbsolutePath(node.absolutePath),
        children: node.children.map((child) => (
            'children' in child
                ? hydrateFolderTreeNode(child)
                : {
                    name: child.name,
                    absolutePath: toAbsolutePath(child.absolutePath),
                    isInGraph: child.isInGraph,
                }
        )),
        loadState: node.loadState,
        isWriteTarget: node.isWriteTarget,
    }
}

// ============================================================================
// STATE
// ============================================================================

export function collectLayoutPositions(graph: Graph): ReadonlyMap<string, Position> {
    return new Map(
        Object.entries(graph.nodes)
            .sort(([left], [right]) => left.localeCompare(right))
            .flatMap(([nodeId, node]: [string, GraphNode]) => (
                O.isSome(node.nodeUIMetadata.position)
                    ? [[nodeId, node.nodeUIMetadata.position.value] as const]
                    : []
            )),
    )
}

export function serializeState(state: State): SerializedState {
    const folderState = serializeFolderState(state)
    return {
        graph: serializeGraph(state.graph),
        roots: {
            folderTree: state.roots.folderTree.map(serializeFolderTreeNode),
        },
        folderState,
        activeView: { viewId: 'main', name: 'main' },
        selection: sortStrings([...state.selection]),
        layout: {
            positions: serializeMap(state.layout.positions),
            ...(state.layout.zoom !== undefined ? { zoom: state.layout.zoom } : {}),
            ...(state.layout.pan ? { pan: state.layout.pan } : {}),
            ...(state.layout.fit !== undefined ? { fit: state.layout.fit } : {}),
        },
        meta: {
            schemaVersion: state.meta.schemaVersion,
            revision: state.meta.revision,
            ...(state.meta.mutatedAt ? { mutatedAt: state.meta.mutatedAt } : {}),
        },
    }
}

export function hydrateState(state: SerializedState): State {
    const folderState = state.folderState ?? legacyFolderState(state)
    return {
        graph: hydrateGraph(state.graph),
        roots: {
            loaded: new Set(state.roots.loaded ?? deriveImplicitRoots(new Map(folderState))),
            folderTree: state.roots.folderTree.map(hydrateFolderTreeNode),
        },
        collapseSet: new Set(state.collapseSet ?? folderState
            .filter(([, folderState]) => folderState === 'collapsed')
            .map(([path]) => toFolderId(path))),
        selection: new Set(state.selection),
        layout: {
            positions: hydrateMap(state.layout.positions),
            ...(state.layout.zoom !== undefined ? { zoom: state.layout.zoom } : {}),
            ...(state.layout.pan ? { pan: state.layout.pan } : {}),
            ...(state.layout.fit !== undefined ? { fit: state.layout.fit } : {}),
        },
        meta: {
            schemaVersion: state.meta.schemaVersion,
            revision: state.meta.revision,
            ...(state.meta.mutatedAt ? { mutatedAt: state.meta.mutatedAt } : {}),
        },
    }
}

// ============================================================================
// COMMAND
// ============================================================================

export function serializeCommand(command: Command): SerializedCommand {
    switch (command.type) {
        case 'Select':
            return {
                type: 'Select',
                ids: [...command.ids],
                ...(command.additive !== undefined ? { additive: command.additive } : {}),
            }
        case 'Deselect':
            return { type: 'Deselect', ids: [...command.ids] }
        case 'AddNode':
            return { type: 'AddNode', node: serializeGraphNode(command.node) }
        case 'RemoveNode':
            return command
        case 'AddEdge':
            return { type: 'AddEdge', source: command.source, edge: command.edge }
        case 'RemoveEdge':
            return command
        case 'Move':
            return command
        case 'SetFolderState':
            return command
        case 'SetZoom':
            return command
        case 'SetPan':
            return { type: 'SetPan', pan: command.pan }
        case 'SetPositions':
            return {
                type: 'SetPositions',
                positions: serializeMap(command.positions),
            }
        case 'RequestFit':
            return command.paddingPx !== undefined
                ? { type: 'RequestFit', paddingPx: command.paddingPx }
                : { type: 'RequestFit' }
    }
}

export function hydrateCommand(command: SerializedCommand): Command {
    switch (command.type) {
        case 'RemoveNode':
        case 'RemoveEdge':
        case 'Move':
        case 'SetFolderState':
            return command
        case 'Select':
            return {
                type: 'Select',
                ids: [...command.ids],
                ...(command.additive !== undefined ? { additive: command.additive } : {}),
            }
        case 'Deselect':
            return { type: 'Deselect', ids: [...command.ids] }
        case 'AddNode':
            return { type: 'AddNode', node: hydrateGraphNode(command.node) }
        case 'AddEdge':
            return { type: 'AddEdge', source: command.source, edge: command.edge }
        case 'SetZoom':
            return command
        case 'SetPan':
            return { type: 'SetPan', pan: command.pan }
        case 'SetPositions':
            return { type: 'SetPositions', positions: hydrateMap(command.positions) }
        case 'RequestFit':
            return command.paddingPx !== undefined
                ? { type: 'RequestFit', paddingPx: command.paddingPx }
                : { type: 'RequestFit' }
    }
}

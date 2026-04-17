import * as O from 'fp-ts/lib/Option.js'

import {
    applyGraphDeltaToGraph,
    buildFolderTree,
    createEmptyGraph,
    deleteNodeSimple,
    toAbsolutePath,
    type AbsolutePath,
    type FolderTreeNode,
    type Graph,
    type GraphDelta,
    type GraphNode,
    type NodeIdAndFilePath,
} from '@vt/graph-model'

import type { AddNode, Command, Delta, RemoveNode, State } from './contract'

interface DirectoryEntryLike {
    readonly absolutePath: AbsolutePath
    readonly name: string
    readonly isDirectory: boolean
    readonly children?: readonly DirectoryEntryLike[]
}

function normalizePathValue(value: string): string {
    return value.replace(/\\/g, '/')
}

function pathContains(rootPath: string, candidatePath: string): boolean {
    const normalizedRoot = normalizePathValue(rootPath).replace(/\/+$/, '')
    const normalizedCandidate = normalizePathValue(candidatePath)
    return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`)
}

function joinPath(parentPath: AbsolutePath, childName: string): AbsolutePath {
    const normalizedParent = normalizePathValue(parentPath).replace(/\/+$/, '')
    return toAbsolutePath(`${normalizedParent}/${childName}`)
}

function getBasename(value: string): string {
    const normalizedValue = normalizePathValue(value).replace(/\/+$/, '')
    const parts = normalizedValue.split('/').filter((part) => part.length > 0)
    return parts[parts.length - 1] ?? normalizedValue
}

function toDirectoryEntry(node: FolderTreeNode): DirectoryEntryLike {
    return {
        name: node.name,
        absolutePath: node.absolutePath,
        isDirectory: true,
        children: node.children.map((child) => (
            'children' in child
                ? toDirectoryEntry(child)
                : {
                    name: child.name,
                    absolutePath: child.absolutePath,
                    isDirectory: false,
                } satisfies DirectoryEntryLike
        )),
    }
}

function replaceChild(
    children: readonly DirectoryEntryLike[],
    index: number,
    child: DirectoryEntryLike,
): readonly DirectoryEntryLike[] {
    return [
        ...children.slice(0, index),
        child,
        ...children.slice(index + 1),
    ]
}

function upsertEntryPath(
    entry: DirectoryEntryLike,
    segments: readonly string[],
): DirectoryEntryLike {
    const [segment, ...remainingSegments] = segments
    if (segment === undefined) {
        return entry
    }

    const childAbsolutePath = joinPath(entry.absolutePath, segment)
    const children = entry.children ?? []
    const existingChildIndex = children.findIndex(
        (child) => normalizePathValue(child.absolutePath) === normalizePathValue(childAbsolutePath),
    )

    if (remainingSegments.length === 0) {
        if (existingChildIndex >= 0) {
            return entry
        }

        return {
            ...entry,
            children: [
                ...children,
                {
                    name: segment,
                    absolutePath: childAbsolutePath,
                    isDirectory: false,
                } satisfies DirectoryEntryLike,
            ],
        }
    }

    const existingDirectory = existingChildIndex >= 0
        ? children[existingChildIndex]
        : {
            name: segment,
            absolutePath: childAbsolutePath,
            isDirectory: true,
            children: [],
        } satisfies DirectoryEntryLike

    const updatedDirectory = upsertEntryPath(existingDirectory, remainingSegments)

    if (existingChildIndex >= 0) {
        if (updatedDirectory === existingDirectory) {
            return entry
        }

        return {
            ...entry,
            children: replaceChild(children, existingChildIndex, updatedDirectory),
        }
    }

    return {
        ...entry,
        children: [
            ...children,
            updatedDirectory,
        ],
    }
}

function removeEntryPath(
    entry: DirectoryEntryLike,
    segments: readonly string[],
): DirectoryEntryLike {
    const [segment, ...remainingSegments] = segments
    if (segment === undefined) {
        return entry
    }

    const childAbsolutePath = joinPath(entry.absolutePath, segment)
    const children = entry.children ?? []
    const existingChildIndex = children.findIndex(
        (child) => normalizePathValue(child.absolutePath) === normalizePathValue(childAbsolutePath),
    )

    if (existingChildIndex < 0) {
        return entry
    }

    if (remainingSegments.length === 0) {
        return {
            ...entry,
            children: [
                ...children.slice(0, existingChildIndex),
                ...children.slice(existingChildIndex + 1),
            ],
        }
    }

    const existingChild = children[existingChildIndex]
    if (!existingChild.isDirectory) {
        return entry
    }

    const updatedChild = removeEntryPath(existingChild, remainingSegments)
    return {
        ...entry,
        children: replaceChild(children, existingChildIndex, updatedChild),
    }
}

function ensureFileInEntry(
    entry: DirectoryEntryLike,
    filePath: string,
): DirectoryEntryLike {
    if (!entry.isDirectory || !pathContains(entry.absolutePath, filePath)) {
        return entry
    }

    const normalizedRoot = normalizePathValue(entry.absolutePath).replace(/\/+$/, '')
    const normalizedFilePath = normalizePathValue(filePath)
    const relativePath = normalizedFilePath.slice(normalizedRoot.length + 1)
    const segments = relativePath.split('/').filter((segment) => segment.length > 0)

    if (segments.length === 0) {
        return entry
    }

    return upsertEntryPath(entry, segments)
}

function removeFileFromEntry(
    entry: DirectoryEntryLike,
    filePath: string,
): DirectoryEntryLike {
    if (!entry.isDirectory || !pathContains(entry.absolutePath, filePath)) {
        return entry
    }

    const normalizedRoot = normalizePathValue(entry.absolutePath).replace(/\/+$/, '')
    const normalizedFilePath = normalizePathValue(filePath)
    const relativePath = normalizedFilePath.slice(normalizedRoot.length + 1)
    const segments = relativePath.split('/').filter((segment) => segment.length > 0)

    if (segments.length === 0) {
        return entry
    }

    return removeEntryPath(entry, segments)
}

function findWriteTargetPath(
    folderTree: readonly FolderTreeNode[],
): AbsolutePath | null {
    for (const node of folderTree) {
        if (node.isWriteTarget) {
            return node.absolutePath
        }

        const nestedWriteTarget = findWriteTargetPath(
            node.children.filter((child): child is FolderTreeNode => 'children' in child),
        )
        if (nestedWriteTarget !== null) {
            return nestedWriteTarget
        }
    }

    return null
}

function findContainingLoadedRoot(
    loadedRoots: ReadonlySet<string>,
    nodeId: string,
): AbsolutePath | null {
    const matches = [...loadedRoots]
        .filter((rootPath) => pathContains(rootPath, nodeId))
        .sort((left, right) => right.length - left.length)

    return matches[0] ? toAbsolutePath(matches[0]) : null
}

function updateFolderTreeForAddedNode(
    roots: State['roots'],
    nodeId: string,
    nextGraph: Graph,
): State['roots'] {
    const graphFilePaths = new Set(Object.keys(nextGraph.nodes))
    const writePath = findWriteTargetPath(roots.folderTree)
    let changed = false

    const folderTree = roots.folderTree.map((rootNode) => {
        if (!pathContains(rootNode.absolutePath, nodeId)) {
            return rootNode
        }

        changed = true
        const nextEntry = ensureFileInEntry(toDirectoryEntry(rootNode), nodeId)
        return buildFolderTree(nextEntry, roots.loaded, writePath, graphFilePaths)
    })

    if (changed) {
        return {
            ...roots,
            folderTree,
        }
    }

    const containingRoot = findContainingLoadedRoot(roots.loaded, nodeId)
    if (containingRoot === null) {
        return roots
    }

    const rootEntry = ensureFileInEntry(
        {
            name: getBasename(containingRoot),
            absolutePath: containingRoot,
            isDirectory: true,
            children: [],
        },
        nodeId,
    )

    return {
        ...roots,
        folderTree: [
            ...folderTree,
            buildFolderTree(rootEntry, roots.loaded, writePath, graphFilePaths),
        ],
    }
}

function updateFolderTreeForRemovedNode(
    roots: State['roots'],
    nodeId: string,
    nextGraph: Graph,
): State['roots'] {
    const graphFilePaths = new Set(Object.keys(nextGraph.nodes))
    const writePath = findWriteTargetPath(roots.folderTree)

    return {
        ...roots,
        folderTree: roots.folderTree.map((rootNode) => {
            if (!pathContains(rootNode.absolutePath, nodeId)) {
                return rootNode
            }

            const nextEntry = removeFileFromEntry(toDirectoryEntry(rootNode), nodeId)
            return buildFolderTree(nextEntry, roots.loaded, writePath, graphFilePaths)
        }),
    }
}

function updateLayoutForAddedNode(
    layout: State['layout'],
    node: GraphNode,
): State['layout'] {
    if (O.isNone(node.nodeUIMetadata.position)) {
        return layout
    }

    const nextPosition = node.nodeUIMetadata.position.value
    const currentPosition = layout.positions.get(node.absoluteFilePathIsID)

    if (
        currentPosition?.x === nextPosition.x
        && currentPosition?.y === nextPosition.y
    ) {
        return layout
    }

    const positions = new Map(layout.positions)
    positions.set(node.absoluteFilePathIsID, nextPosition)

    return {
        ...layout,
        positions,
    }
}

function updateLayoutForRemovedNode(
    layout: State['layout'],
    nodeId: NodeIdAndFilePath,
): State['layout'] {
    if (!layout.positions.has(nodeId)) {
        return layout
    }

    const positions = new Map(layout.positions)
    positions.delete(nodeId)

    return {
        ...layout,
        positions,
    }
}

function applyAddNode(
    state: State,
    command: AddNode,
): { readonly state: State; readonly delta: Delta } {
    const previousNode = O.fromNullable(state.graph.nodes[command.node.absoluteFilePathIsID])
    const graphDelta: GraphDelta = [{
        type: 'UpsertNode',
        nodeToUpsert: command.node,
        previousNode,
    }]
    const graph = applyGraphDeltaToGraph(state.graph, graphDelta)
    const node = graph.nodes[command.node.absoluteFilePathIsID]
    const nextRevision = state.meta.revision + 1

    return {
        state: {
            graph,
            roots: updateFolderTreeForAddedNode(state.roots, command.node.absoluteFilePathIsID, graph),
            collapseSet: state.collapseSet,
            selection: state.selection,
            layout: updateLayoutForAddedNode(state.layout, node),
            meta: {
                ...state.meta,
                revision: nextRevision,
            },
        },
        delta: {
            revision: nextRevision,
            cause: command,
            graph: graphDelta,
        },
    }
}

function applyRemoveNode(
    state: State,
    command: RemoveNode,
): { readonly state: State; readonly delta: Delta } {
    const nextRevision = state.meta.revision + 1
    const graphDelta: GraphDelta = deleteNodeSimple(state.graph, command.id)
    const graph = graphDelta.length > 0 ? applyGraphDeltaToGraph(state.graph, graphDelta) : state.graph
    const nextSelection = new Set(state.selection)
    const wasSelected = nextSelection.delete(command.id)

    return {
        state: {
            graph,
            roots: updateFolderTreeForRemovedNode(state.roots, command.id, graph),
            collapseSet: state.collapseSet,
            selection: nextSelection,
            layout: updateLayoutForRemovedNode(state.layout, command.id),
            meta: {
                ...state.meta,
                revision: nextRevision,
            },
        },
        delta: {
            revision: nextRevision,
            cause: command,
            ...(graphDelta.length > 0 ? { graph: graphDelta } : {}),
            ...(wasSelected ? { selectionRemoved: [command.id] } : {}),
        },
    }
}

export function emptyState(): State {
    return {
        graph: createEmptyGraph(),
        roots: {
            loaded: new Set(),
            folderTree: [],
        },
        collapseSet: new Set(),
        selection: new Set(),
        layout: {
            positions: new Map(),
        },
        meta: {
            schemaVersion: 1,
            revision: 0,
        },
    }
}

export function applyCommandWithDelta(
    state: State,
    command: Command,
): { readonly state: State; readonly delta: Delta } {
    switch (command.type) {
        case 'AddNode':
            return applyAddNode(state, command)
        case 'RemoveNode':
            return applyRemoveNode(state, command)
        default:
            throw new Error(`applyCommand not implemented for command type "${command.type}"`)
    }
}

export function applyCommand(state: State, command: Command): State {
    return applyCommandWithDelta(state, command).state
}

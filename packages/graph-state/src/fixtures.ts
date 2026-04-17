import fs from 'fs'
import { promises as fsp } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import * as E from 'fp-ts/lib/Either.js'
import * as O from 'fp-ts/lib/Option.js'
import normalizePath from 'normalize-path'

import {
    buildFolderTree,
    getDirectoryTree,
    loadGraphFromDisk,
    toAbsolutePath,
    type FolderTreeNode,
    type Graph,
    type GraphNode,
    type Position,
} from '@vt/graph-model'

import type { Command, ElementSpec, State } from './contract'

export type SerializedOption<T> =
    | { readonly _tag: 'None' }
    | { readonly _tag: 'Some'; readonly value: T }

export interface SerializedEdge {
    readonly targetId: string
    readonly label: string
}

export interface SerializedGraphNode {
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
        readonly loaded: readonly string[]
        readonly folderTree: readonly SerializedFolderTreeNode[]
    }
    readonly collapseSet: readonly string[]
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
    | { readonly type: 'Collapse'; readonly folder: string }
    | { readonly type: 'Expand'; readonly folder: string }
    | { readonly type: 'Select'; readonly ids: readonly string[]; readonly additive?: boolean }
    | { readonly type: 'Deselect'; readonly ids: readonly string[] }
    | { readonly type: 'AddNode'; readonly node: SerializedGraphNode }
    | { readonly type: 'RemoveNode'; readonly id: string }
    | { readonly type: 'AddEdge'; readonly source: string; readonly edge: SerializedEdge }
    | { readonly type: 'RemoveEdge'; readonly source: string; readonly targetId: string }
    | { readonly type: 'Move'; readonly id: string; readonly to: Position }
    | { readonly type: 'LoadRoot'; readonly root: string }
    | { readonly type: 'UnloadRoot'; readonly root: string }

export interface SnapshotDocument {
    readonly $schema: 'graph-state/snapshot@1'
    readonly id: string
    readonly description: string
    readonly state: SerializedState
}

export interface SequenceDocument {
    readonly $schema: 'graph-state/sequence@1'
    readonly id: string
    readonly description: string
    readonly initial?: string
    readonly initialState?: SerializedState
    readonly commands: readonly SerializedCommand[]
    readonly expected?: {
        readonly finalSnapshot?: string
        readonly revisionDelta?: number
        readonly deltas?: readonly Readonly<Record<string, unknown>>[]
    }
}

export interface ProjectionDocument {
    readonly $schema: 'graph-state/projection@1'
    readonly id: string
    readonly sourceSnapshot: string
    readonly elementSpec: ElementSpec
}

export interface SnapshotFixture {
    readonly path: string
    readonly doc: SnapshotDocument
    readonly state: State
}

export interface SequenceFixture {
    readonly path: string
    readonly doc: SequenceDocument
    readonly initial: State
    readonly commands: readonly Command[]
}

export interface ProjectionFixture {
    readonly path: string
    readonly doc: ProjectionDocument
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const FIXTURES_DIR: string = path.resolve(__dirname, '..', 'fixtures')
export const SNAPSHOTS_DIR: string = path.join(FIXTURES_DIR, 'snapshots')
export const SEQUENCES_DIR: string = path.join(FIXTURES_DIR, 'sequences')
export const PROJECTIONS_DIR: string = path.join(FIXTURES_DIR, 'projections')

export const REAL_VAULT_FIXTURE_ID = '080-folder-nodes-real-vault'
export const REAL_VAULT_CANONICAL_ROOT = '/tmp/graph-state-fixtures/real-vault-folder-nodes'

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

function serializeGraphNode(node: GraphNode): SerializedGraphNode {
    return {
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
            additionalYAMLProps: serializeMap(node.nodeUIMetadata.additionalYAMLProps),
            ...(node.nodeUIMetadata.isContextNode === true ? { isContextNode: true } : {}),
            ...(node.nodeUIMetadata.containedNodeIds
                ? { containedNodeIds: sortStrings(node.nodeUIMetadata.containedNodeIds) }
                : {}),
        },
    }
}

function hydrateGraphNode(node: SerializedGraphNode): GraphNode {
    return {
        outgoingEdges: node.outgoingEdges.map((edge) => ({
            targetId: edge.targetId,
            label: edge.label,
        })),
        absoluteFilePathIsID: node.absoluteFilePathIsID,
        contentWithoutYamlOrLinks: node.contentWithoutYamlOrLinks,
        nodeUIMetadata: {
            color: hydrateOption(node.nodeUIMetadata.color),
            position: hydrateOption(node.nodeUIMetadata.position),
            additionalYAMLProps: hydrateMap(node.nodeUIMetadata.additionalYAMLProps),
            ...(node.nodeUIMetadata.isContextNode === true ? { isContextNode: true } : {}),
            ...(node.nodeUIMetadata.containedNodeIds
                ? { containedNodeIds: [...node.nodeUIMetadata.containedNodeIds] }
                : {}),
        },
    }
}

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

function serializeFolderTreeNode(
    node: FolderTreeNode,
): SerializedFolderTreeNode {
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
    return {
        graph: serializeGraph(state.graph),
        roots: {
            loaded: sortStrings([...state.roots.loaded]),
            folderTree: state.roots.folderTree.map(serializeFolderTreeNode),
        },
        collapseSet: sortStrings([...state.collapseSet]),
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
    return {
        graph: hydrateGraph(state.graph),
        roots: {
            loaded: new Set(state.roots.loaded),
            folderTree: state.roots.folderTree.map(hydrateFolderTreeNode),
        },
        collapseSet: new Set(state.collapseSet),
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

export function serializeCommand(command: Command): SerializedCommand {
    switch (command.type) {
        case 'Collapse':
        case 'Expand':
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
            return { type: 'AddNode', node: serializeGraphNode(command.node) }
        case 'RemoveNode':
            return command
        case 'AddEdge':
            return { type: 'AddEdge', source: command.source, edge: command.edge }
        case 'RemoveEdge':
            return command
        case 'Move':
            return command
        case 'LoadRoot':
        case 'UnloadRoot':
            return command
    }
}

export function hydrateCommand(command: SerializedCommand): Command {
    switch (command.type) {
        case 'Collapse':
        case 'Expand':
        case 'RemoveNode':
        case 'RemoveEdge':
        case 'Move':
        case 'LoadRoot':
        case 'UnloadRoot':
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
    }
}

function readJsonDocument<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
}

function listJsonFiles(dirPath: string): readonly string[] {
    if (!fs.existsSync(dirPath)) {
        return []
    }

    return fs.readdirSync(dirPath)
        .filter((entry) => entry.endsWith('.json'))
        .sort((left, right) => left.localeCompare(right))
        .map((entry) => path.join(dirPath, entry))
}

function fixtureIdFromPath(filePath: string): string {
    return path.basename(filePath, '.json')
}

function fixtureAlias(id: string): string {
    return id.replace(/^\d+-/, '')
}

function resolveFixturePath(nameOrPath: string, dirPath: string): string {
    const directPath = path.isAbsolute(nameOrPath)
        ? nameOrPath
        : path.resolve(process.cwd(), nameOrPath)

    if (fs.existsSync(directPath)) {
        return directPath
    }

    const matches = listJsonFiles(dirPath).filter((candidatePath) => {
        const id = fixtureIdFromPath(candidatePath)
        return id === nameOrPath || fixtureAlias(id) === nameOrPath
    })

    if (matches.length === 1) {
        return matches[0]
    }

    if (matches.length > 1) {
        throw new Error(
            `Ambiguous fixture "${nameOrPath}" in ${dirPath}: ${matches
                .map((match) => fixtureIdFromPath(match))
                .join(', ')}`,
        )
    }

    throw new Error(`Fixture "${nameOrPath}" not found in ${dirPath}`)
}

function assertSchema(
    actual: string,
    expectedPrefix: 'graph-state/snapshot@' | 'graph-state/sequence@' | 'graph-state/projection@',
): void {
    if (!actual.startsWith(expectedPrefix) || !actual.endsWith('@1')) {
        throw new Error(`Unsupported fixture schema "${actual}"`)
    }
}

export function readSnapshotDocument(nameOrPath: string): SnapshotDocument {
    const filePath = resolveFixturePath(nameOrPath, SNAPSHOTS_DIR)
    const doc = readJsonDocument<SnapshotDocument>(filePath)
    assertSchema(doc.$schema, 'graph-state/snapshot@')
    return doc
}

export function readSequenceDocument(nameOrPath: string): SequenceDocument {
    const filePath = resolveFixturePath(nameOrPath, SEQUENCES_DIR)
    const doc = readJsonDocument<SequenceDocument>(filePath)
    assertSchema(doc.$schema, 'graph-state/sequence@')
    return doc
}

export function readProjectionDocument(nameOrPath: string): ProjectionDocument {
    const filePath = resolveFixturePath(nameOrPath, PROJECTIONS_DIR)
    const doc = readJsonDocument<ProjectionDocument>(filePath)
    assertSchema(doc.$schema, 'graph-state/projection@')
    return doc
}

export function listSnapshotDocuments(): readonly SnapshotFixture[] {
    return listJsonFiles(SNAPSHOTS_DIR).map((filePath) => {
        const doc = readJsonDocument<SnapshotDocument>(filePath)
        assertSchema(doc.$schema, 'graph-state/snapshot@')
        return {
            path: filePath,
            doc,
            state: hydrateState(doc.state),
        }
    })
}

export function listSequenceDocuments(): readonly SequenceFixture[] {
    return listJsonFiles(SEQUENCES_DIR).map((filePath) => {
        const doc = readJsonDocument<SequenceDocument>(filePath)
        assertSchema(doc.$schema, 'graph-state/sequence@')
        const initial = doc.initialState
            ? hydrateState(doc.initialState)
            : doc.initial
                ? loadSnapshot(doc.initial)
                : (() => {
                    throw new Error(`Sequence "${doc.id}" is missing initial or initialState`)
                })()
        return {
            path: filePath,
            doc,
            initial,
            commands: doc.commands.map(hydrateCommand),
        }
    })
}

export function listProjectionDocuments(): readonly ProjectionFixture[] {
    return listJsonFiles(PROJECTIONS_DIR).map((filePath) => {
        const doc = readJsonDocument<ProjectionDocument>(filePath)
        assertSchema(doc.$schema, 'graph-state/projection@')
        return { path: filePath, doc }
    })
}

export function loadSnapshot(nameOrPath: string): State {
    return hydrateState(readSnapshotDocument(nameOrPath).state)
}

export function loadSequence(nameOrPath: string): {
    readonly initial: State
    readonly commands: readonly Command[]
    readonly expected?: SequenceDocument['expected']
} {
    const doc = readSequenceDocument(nameOrPath)
    const initial = doc.initialState
        ? hydrateState(doc.initialState)
        : doc.initial
            ? loadSnapshot(doc.initial)
            : (() => {
                throw new Error(`Sequence "${doc.id}" is missing initial or initialState`)
            })()

    return {
        initial,
        commands: doc.commands.map(hydrateCommand),
        ...(doc.expected ? { expected: doc.expected } : {}),
    }
}

export function loadProjection(nameOrPath: string): ElementSpec {
    return readProjectionDocument(nameOrPath).elementSpec
}

export function loadFixture(name: string): { readonly state: State; readonly commands?: readonly Command[] } {
    try {
        return { state: loadSnapshot(name) }
    } catch (snapshotError) {
        try {
            const sequence = loadSequence(name)
            return { state: sequence.initial, commands: sequence.commands }
        } catch (sequenceError) {
            const snapshotMessage = snapshotError instanceof Error ? snapshotError.message : String(snapshotError)
            const sequenceMessage = sequenceError instanceof Error ? sequenceError.message : String(sequenceError)
            throw new Error(
                `Fixture "${name}" was not found as a snapshot or sequence.\nSnapshot error: ${snapshotMessage}\nSequence error: ${sequenceMessage}`,
            )
        }
    }
}

export function toFixtureJson(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`
}

async function copyVaultToCanonicalRoot(sourceVaultPath: string, canonicalRoot: string): Promise<void> {
    await fsp.rm(canonicalRoot, { recursive: true, force: true })
    await fsp.mkdir(path.dirname(canonicalRoot), { recursive: true })
    await fsp.cp(sourceVaultPath, canonicalRoot, { recursive: true })
}

export async function buildStateFromVault(
    sourceVaultPath: string,
    canonicalRoot: string = sourceVaultPath,
): Promise<State> {
    const normalizedSource = normalizePath(path.resolve(sourceVaultPath))
    const normalizedCanonical = normalizePath(canonicalRoot)

    if (normalizedSource !== normalizedCanonical) {
        await copyVaultToCanonicalRoot(normalizedSource, normalizedCanonical)
    }

    const loadResult = await loadGraphFromDisk([normalizedCanonical])
    if (E.isLeft(loadResult)) {
        throw new Error(`Failed to load vault fixture from ${sourceVaultPath}: ${JSON.stringify(loadResult.left)}`)
    }

    const directoryTree = await getDirectoryTree(normalizedCanonical)
    const loadedRoots = new Set([normalizedCanonical])
    const graph = loadResult.right
    const folderTree = [
        buildFolderTree(
            directoryTree,
            loadedRoots,
            toAbsolutePath(normalizedCanonical),
            new Set(Object.keys(graph.nodes)),
        ),
    ]

    return {
        graph,
        roots: {
            loaded: loadedRoots,
            folderTree,
        },
        collapseSet: new Set(),
        selection: new Set(),
        layout: {
            positions: collectLayoutPositions(graph),
        },
        meta: {
            schemaVersion: 1,
            revision: 0,
        },
    }
}

export async function snapshotStateFromVault(
    sourceVaultPath: string,
    options: {
        readonly id: string
        readonly description: string
        readonly canonicalRoot?: string
    },
): Promise<SnapshotDocument> {
    const state = await buildStateFromVault(sourceVaultPath, options.canonicalRoot)
    return {
        $schema: 'graph-state/snapshot@1',
        id: options.id,
        description: options.description,
        state: serializeState(state),
    }
}

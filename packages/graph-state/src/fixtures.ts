import fs from 'fs'
import { promises as fsp } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import * as E from 'fp-ts/lib/Either.js'
import normalizePath from 'normalize-path'

import {
    buildFolderTree,
    getDirectoryTree,
    loadGraphFromDisk,
    toAbsolutePath,
} from '@vt/graph-model'

import type { Command, ElementSpec, State } from './contract'
import {
    collectLayoutPositions,
    hydrateCommand,
    hydrateState,
    serializeState,
    type SerializedCommand,
    type SerializedState,
} from './fixtures/serialization'

// Re-export the entire serialization layer so consumers can keep importing
// from `@vt/graph-state/fixtures` (or the package root). Split out at
// L2-BF-167 to keep this file under the 500-line ratchet.
export {
    collectLayoutPositions,
    hydrateCommand,
    hydrateGraphNode,
    hydrateState,
    serializeCommand,
    serializeGraphNode,
    serializeState,
} from './fixtures/serialization'
export type {
    SerializedCommand,
    SerializedEdge,
    SerializedFileTreeNode,
    SerializedFolderTreeNode,
    SerializedGraph,
    SerializedGraphNode,
    SerializedOption,
    SerializedState,
} from './fixtures/serialization'

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

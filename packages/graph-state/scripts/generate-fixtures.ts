import { promises as fs } from 'fs'
import path from 'path'

import normalizePath from 'normalize-path'

import {
    buildGraphFromFiles,
    buildFolderTree,
    toAbsolutePath,
    type DirectoryEntry,
    type GraphNode,
    type Position,
} from '@vt/graph-model'

import type { Command, State } from '../src/contract'
import {
    FIXTURES_DIR,
    PROJECTIONS_DIR,
    REAL_VAULT_CANONICAL_ROOT,
    REAL_VAULT_FIXTURE_ID,
    SEQUENCES_DIR,
    SNAPSHOTS_DIR,
    collectLayoutPositions,
    serializeCommand,
    serializeState,
    snapshotStateFromVault,
    toFixtureJson,
    type SequenceDocument,
    type SnapshotDocument,
} from '../src/fixtures'

interface MarkdownFile {
    readonly relativePath: string
    readonly content: string
}

interface SyntheticRootSpec {
    readonly rootPath: string
    readonly files: readonly MarkdownFile[]
    readonly extraDirs?: readonly string[]
}

interface SyntheticStateSpec {
    readonly roots: readonly SyntheticRootSpec[]
    readonly loadedRoots?: readonly string[]
    readonly writePath?: string | null
    readonly collapseSet?: readonly string[]
    readonly selection?: readonly string[]
    readonly layout?: {
        readonly zoom?: number
        readonly pan?: Position
        readonly fit?: { readonly paddingPx: number } | null
    }
    readonly meta?: {
        readonly revision?: number
        readonly mutatedAt?: string
    }
}

const ROOT_A = '/tmp/graph-state-fixtures/root-a'
const ROOT_B = '/tmp/graph-state-fixtures/root-b'
const ROOT_EMPTY = '/tmp/graph-state-fixtures/root-empty'

function abs(rootPath: string, relativePath: string = ''): string {
    return normalizePath(relativePath === '' ? rootPath : path.posix.join(rootPath, relativePath))
}

function folderId(rootPath: string, relativePath: string): string {
    return `${abs(rootPath, relativePath)}/`
}

function renderScalar(value: string | number | boolean): string {
    return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function renderYamlValue(value: unknown, indent: string = ''): readonly string[] {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return [`${indent}${renderScalar(value)}`]
    }

    if (Array.isArray(value)) {
        if (value.length === 0) {
            return [`${indent}[]`]
        }

        return value.flatMap((entry) => {
            if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
                return [`${indent}- ${renderScalar(entry)}`]
            }
            if (!isPlainObject(entry)) {
                throw new Error(`Unsupported YAML array entry: ${JSON.stringify(entry)}`)
            }
            const nested = renderYamlObject(entry, `${indent}  `)
            return [`${indent}-`, ...nested]
        })
    }

    if (isPlainObject(value)) {
        return renderYamlObject(value, indent)
    }

    throw new Error(`Unsupported YAML value: ${JSON.stringify(value)}`)
}

function renderYamlObject(value: Record<string, unknown>, indent: string = ''): readonly string[] {
    return Object.entries(value).flatMap(([key, nestedValue]) => {
        if (
            typeof nestedValue === 'string'
            || typeof nestedValue === 'number'
            || typeof nestedValue === 'boolean'
        ) {
            return [`${indent}${key}: ${renderScalar(nestedValue)}`]
        }

        return [`${indent}${key}:`, ...renderYamlValue(nestedValue, `${indent}  `)]
    })
}

function markdown(
    title: string,
    paragraphs: readonly string[],
    frontmatter?: Record<string, unknown>,
): string {
    const yaml = frontmatter && Object.keys(frontmatter).length > 0
        ? `---\n${renderYamlObject(frontmatter).join('\n')}\n---\n`
        : ''

    const body = [`# ${title}`, ...paragraphs]
        .filter((line) => line.length > 0)
        .join('\n\n')

    return `${yaml}${body}\n`
}

function buildDirectoryEntry(
    rootPath: string,
    files: readonly MarkdownFile[],
    extraDirs: readonly string[] = [],
): DirectoryEntry {
    interface MutableDirectory {
        readonly absolutePath: string
        readonly name: string
        readonly directories: Map<string, MutableDirectory>
        readonly files: Map<string, DirectoryEntry>
    }

    function createDirectory(absolutePath: string): MutableDirectory {
        return {
            absolutePath,
            name: path.posix.basename(absolutePath),
            directories: new Map(),
            files: new Map(),
        }
    }

    const root = createDirectory(rootPath)

    function ensureDirectory(relativeDir: string): MutableDirectory {
        const segments = relativeDir.split('/').filter(Boolean)
        let current = root
        let currentPath = rootPath

        for (const segment of segments) {
            currentPath = abs(currentPath, segment)
            const existing = current.directories.get(segment)
            if (existing) {
                current = existing
                continue
            }
            const next = createDirectory(currentPath)
            current.directories.set(segment, next)
            current = next
        }

        return current
    }

    for (const dir of extraDirs) {
        ensureDirectory(dir)
    }

    for (const file of files) {
        const normalizedRelative = normalizePath(file.relativePath)
        const segments = normalizedRelative.split('/').filter(Boolean)
        const fileName = segments.pop()
        if (!fileName) {
            continue
        }
        const parent = ensureDirectory(segments.join('/'))
        const absolutePath = abs(rootPath, normalizedRelative)
        parent.files.set(fileName, {
            absolutePath: toAbsolutePath(absolutePath),
            name: fileName,
            isDirectory: false,
        })
    }

    function finalize(dir: MutableDirectory): DirectoryEntry {
        const childDirs = [...dir.directories.values()]
            .sort((left, right) => left.name.localeCompare(right.name))
            .map(finalize)
        const childFiles = [...dir.files.values()]
            .sort((left, right) => left.name.localeCompare(right.name))

        return {
            absolutePath: toAbsolutePath(dir.absolutePath),
            name: dir.name,
            isDirectory: true,
            children: [...childDirs, ...childFiles],
        }
    }

    return finalize(root)
}

function createState(spec: SyntheticStateSpec): State {
    const loadedRoots = [...(spec.loadedRoots ?? spec.roots.map((root) => root.rootPath))]
        .map((rootPath) => normalizePath(rootPath))
        .sort((left, right) => left.localeCompare(right))
    const loadedRootSet = new Set(loadedRoots)
    const writePath = spec.writePath === null
        ? null
        : toAbsolutePath(normalizePath(spec.writePath ?? loadedRoots[0] ?? spec.roots[0]?.rootPath ?? ROOT_A))
    const filesForGraph = spec.roots
        .filter((root) => loadedRootSet.has(root.rootPath))
        .flatMap((root) => root.files.map((file) => ({
            absolutePath: abs(root.rootPath, file.relativePath),
            content: file.content,
        })))
        .sort((left, right) => left.absolutePath.localeCompare(right.absolutePath))
    const graph = buildGraphFromFiles(filesForGraph)
    const graphFilePaths = new Set(Object.keys(graph.nodes))
    const folderTree = spec.roots
        .filter((root) => loadedRootSet.has(root.rootPath))
        .sort((left, right) => left.rootPath.localeCompare(right.rootPath))
        .map((root) => buildFolderTree(
            buildDirectoryEntry(root.rootPath, root.files, root.extraDirs),
            loadedRootSet,
            writePath,
            graphFilePaths,
        ))

    return {
        graph,
        roots: {
            loaded: loadedRootSet,
            folderTree,
        },
        collapseSet: new Set(spec.collapseSet ?? []),
        selection: new Set(spec.selection ?? []),
        layout: {
            positions: collectLayoutPositions(graph),
            ...(spec.layout?.zoom !== undefined ? { zoom: spec.layout.zoom } : {}),
            ...(spec.layout?.pan ? { pan: spec.layout.pan } : {}),
            ...(spec.layout?.fit !== undefined ? { fit: spec.layout.fit } : {}),
        },
        meta: {
            schemaVersion: 1,
            revision: spec.meta?.revision ?? 0,
            ...(spec.meta?.mutatedAt ? { mutatedAt: spec.meta.mutatedAt } : {}),
        },
    }
}

function snapshot(id: string, description: string, spec: SyntheticStateSpec): SnapshotDocument {
    return {
        $schema: 'graph-state/snapshot@1',
        id,
        description,
        state: serializeState(createState(spec)),
    }
}

function sequence(
    id: string,
    description: string,
    initial: string,
    commands: readonly Command[],
    expected?: SequenceDocument['expected'],
): SequenceDocument {
    return {
        $schema: 'graph-state/sequence@1',
        id,
        description,
        initial,
        commands: commands.map(serializeCommand),
        ...(expected ? { expected } : {}),
    }
}

function nodeFromMarkdown(rootPath: string, relativePath: string, content: string): GraphNode {
    const absolutePath = abs(rootPath, relativePath)
    return buildGraphFromFiles([{ absolutePath, content }]).nodes[absolutePath]
}

function flatThreeFiles(positions?: Readonly<Record<string, Position>>): readonly MarkdownFile[] {
    const alphaFrontmatter = positions?.['alpha.md'] ? { position: positions['alpha.md'] } : undefined
    const betaFrontmatter = positions?.['beta.md'] ? { position: positions['beta.md'] } : undefined
    const gammaFrontmatter = positions?.['gamma.md'] ? { position: positions['gamma.md'] } : undefined

    return [
        {
            relativePath: 'alpha.md',
            content: markdown('Alpha', ['Tracks [[Beta]].'], alphaFrontmatter),
        },
        {
            relativePath: 'beta.md',
            content: markdown('Beta', ['Execution detail.'], betaFrontmatter),
        },
        {
            relativePath: 'gamma.md',
            content: markdown('Gamma', ['Loose note.'], gammaFrontmatter),
        },
    ]
}

function flatFiveFiles(): readonly MarkdownFile[] {
    return [
        ...flatThreeFiles(),
        { relativePath: 'delta.md', content: markdown('Delta', ['Staging note.']) },
        { relativePath: 'epsilon.md', content: markdown('Epsilon', ['Archive note.']) },
    ]
}

function addNodeFiles(): readonly MarkdownFile[] {
    return [
        ...flatThreeFiles(),
        { relativePath: 'delta.md', content: markdown('Delta', ['New node added for mutation tests.']) },
    ]
}

function addEdgeFiles(): readonly MarkdownFile[] {
    return [
        {
            relativePath: 'alpha.md',
            content: markdown('Alpha', ['Tracks [[Beta]] and [[Gamma]].']),
        },
        {
            relativePath: 'beta.md',
            content: markdown('Beta', ['Execution detail.']),
        },
        {
            relativePath: 'gamma.md',
            content: markdown('Gamma', ['Loose note.']),
        },
    ]
}

function flatFolderFiles(): readonly MarkdownFile[] {
    return [
        {
            relativePath: 'tasks/BF-117.md',
            content: markdown('BF-117', ['Depends on [[BF-118]].']),
        },
        {
            relativePath: 'tasks/BF-118.md',
            content: markdown('BF-118', ['Ready for execution.']),
        },
    ]
}

function externalIntoFolderFiles(): readonly MarkdownFile[] {
    return [
        { relativePath: 'overview.md', content: markdown('Overview', ['Tracks [[BF-117]].']) },
        ...flatFolderFiles(),
    ]
}

function folderToExternalFiles(): readonly MarkdownFile[] {
    return [
        {
            relativePath: 'tasks/BF-117.md',
            content: markdown('BF-117', ['Escalates into [[Overview]].']),
        },
        {
            relativePath: 'tasks/BF-118.md',
            content: markdown('BF-118', ['Ready for execution.']),
        },
        {
            relativePath: 'overview.md',
            content: markdown('Overview', ['External node outside the folder.']),
        },
    ]
}

function siblingFolderFiles(): readonly MarkdownFile[] {
    return [
        { relativePath: 'tasks/BF-117.md', content: markdown('BF-117', ['See [[spec]].']) },
        { relativePath: 'notes/spec.md', content: markdown('spec', ['Shared reference note.']) },
        { relativePath: 'notes/retro.md', content: markdown('retro', ['Weekly retro.']) },
    ]
}

function nestedFolderFiles(positions?: Readonly<Record<string, Position>>): readonly MarkdownFile[] {
    const summaryFrontmatter = positions?.['tasks/summary.md']
        ? { position: positions['tasks/summary.md'] }
        : undefined
    const epicAFrontmatter = positions?.['tasks/epics/epic-a.md']
        ? { position: positions['tasks/epics/epic-a.md'] }
        : undefined
    const epicBFrontmatter = positions?.['tasks/epics/epic-b.md']
        ? { position: positions['tasks/epics/epic-b.md'] }
        : undefined

    return [
        {
            relativePath: 'tasks/summary.md',
            content: markdown('summary', ['Summarises [[epic-a]].'], summaryFrontmatter),
        },
        {
            relativePath: 'tasks/epics/epic-a.md',
            content: markdown('epic-a', ['Depends on [[epic-b]].'], epicAFrontmatter),
        },
        {
            relativePath: 'tasks/epics/epic-b.md',
            content: markdown('epic-b', ['Leaf note.'], epicBFrontmatter),
        },
        {
            relativePath: 'notes/roadmap.md',
            content: markdown('roadmap', ['Relates to [[summary]].']),
        },
    ]
}

function mixedCollapseFiles(): readonly MarkdownFile[] {
    return [
        ...nestedFolderFiles({
            'tasks/summary.md': { x: 90, y: 120 },
            'tasks/epics/epic-a.md': { x: 260, y: 180 },
            'tasks/epics/epic-b.md': { x: 360, y: 240 },
        }),
        {
            relativePath: 'notes/inbox.md',
            content: markdown('inbox', ['Selected note for visibility tests.'], {
                position: { x: 520, y: 90 },
            }),
        },
        {
            relativePath: 'research/idea.md',
            content: markdown('idea', ['Collapsed sibling folder payload.']),
        },
    ]
}

function contextNodeFiles(): readonly MarkdownFile[] {
    const alphaId = abs(ROOT_A, 'alpha.md')
    const betaId = abs(ROOT_A, 'beta.md')

    return [
        { relativePath: 'alpha.md', content: markdown('Alpha', ['Referenced node.']) },
        { relativePath: 'beta.md', content: markdown('Beta', ['Referenced node.']) },
        {
            relativePath: 'context.md',
            content: markdown(
                'Context',
                ['Contains a dangling [[missing-target]] link.'],
                {
                    isContextNode: true,
                    containedNodeIds: [alphaId, betaId],
                    color: '#FF00AA',
                    status: 'draft',
                    priority: 2,
                },
            ),
        },
    ]
}

function multiRootFilesRootA(): readonly MarkdownFile[] {
    return [
        {
            relativePath: 'tasks/seed.md',
            content: markdown('seed', ['Core task file.']),
        },
        {
            relativePath: 'overview.md',
            content: markdown('overview', ['Top-level summary.']),
        },
    ]
}

function multiRootFilesRootAWithNewNode(): readonly MarkdownFile[] {
    return [
        ...multiRootFilesRootA(),
        {
            relativePath: 'tasks/delta.md',
            content: markdown('delta', ['Added during the multi-command sequence.']),
        },
    ]
}

function multiRootFilesRootB(): readonly MarkdownFile[] {
    return [
        {
            relativePath: 'remote.md',
            content: markdown('remote', ['Secondary root note.']),
        },
    ]
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
    await fs.writeFile(filePath, toFixtureJson(value), 'utf8')
}

async function main(): Promise<void> {
    await fs.mkdir(FIXTURES_DIR, { recursive: true })
    await fs.rm(SNAPSHOTS_DIR, { recursive: true, force: true })
    await fs.rm(SEQUENCES_DIR, { recursive: true, force: true })
    await fs.rm(PROJECTIONS_DIR, { recursive: true, force: true })
    await fs.mkdir(SNAPSHOTS_DIR, { recursive: true })
    await fs.mkdir(SEQUENCES_DIR, { recursive: true })
    await fs.mkdir(PROJECTIONS_DIR, { recursive: true })

    const movedPositions = {
        'alpha.md': { x: 80, y: 100 },
        'beta.md': { x: 360, y: 240 },
        'gamma.md': { x: 280, y: 100 },
    } satisfies Record<string, Position>
    const baselinePositions = {
        'alpha.md': { x: 80, y: 100 },
        'beta.md': { x: 220, y: 100 },
        'gamma.md': { x: 360, y: 100 },
    } satisfies Record<string, Position>

    const newNodePath = abs(ROOT_A, 'tasks/delta.md')
    const rootATasksFolder = folderId(ROOT_A, 'tasks')
    const nestedTasksFolder = folderId(ROOT_A, 'tasks')
    const nestedEpicsFolder = folderId(ROOT_A, 'tasks/epics')
    const researchFolder = folderId(ROOT_A, 'research')
    const rootBRemote = abs(ROOT_B, 'remote.md')

    const snapshots: SnapshotDocument[] = [
        snapshot('001-empty', 'Empty state with one loaded root and no graph nodes.', {
            roots: [{ rootPath: ROOT_EMPTY, files: [] }],
        }),
        snapshot('002-single-node', 'Single-node snapshot with a loaded root and no edges.', {
            roots: [{
                rootPath: ROOT_A,
                files: [{ relativePath: 'solo.md', content: markdown('solo', ['Only node in the graph.']) }],
            }],
        }),
        snapshot('003-flat-three-nodes', 'Flat three-node baseline used by add/remove/select tests.', {
            roots: [{ rootPath: ROOT_A, files: flatThreeFiles() }],
        }),
        snapshot('004-flat-five-nodes', 'Flat five-node fixture for wider traversal and indexing coverage.', {
            roots: [{ rootPath: ROOT_A, files: flatFiveFiles() }],
        }),
        snapshot('005-with-selection', 'Selection populated against the flat three-node baseline.', {
            roots: [{ rootPath: ROOT_A, files: flatThreeFiles() }],
            selection: [abs(ROOT_A, 'beta.md')],
        }),
        snapshot('006-with-layout-positions', 'Layout positions populated for move-command coverage.', {
            roots: [{ rootPath: ROOT_A, files: flatThreeFiles(baselinePositions) }],
        }),
        snapshot('007-with-layout-positions-moved', 'Move result with beta repositioned in layout.positions.', {
            roots: [{ rootPath: ROOT_A, files: flatThreeFiles(movedPositions) }],
        }),
        snapshot('008-add-node-result', 'AddNode result: flat baseline plus one extra node.', {
            roots: [{ rootPath: ROOT_A, files: addNodeFiles() }],
        }),
        snapshot('009-add-edge-result', 'AddEdge result: flat baseline plus Alpha → Gamma.', {
            roots: [{ rootPath: ROOT_A, files: addEdgeFiles() }],
        }),
        snapshot('010-flat-folder', 'Single folder expanded: tasks/ contains two files.', {
            roots: [{ rootPath: ROOT_A, files: flatFolderFiles() }],
        }),
        snapshot('011-flat-folder-collapsed', 'Single folder collapsed at tasks/.', {
            roots: [{ rootPath: ROOT_A, files: flatFolderFiles() }],
            collapseSet: [rootATasksFolder],
        }),
        snapshot('012-f6-external-into-folder', 'Expanded F6 case where an external note points into the folder.', {
            roots: [{ rootPath: ROOT_A, files: externalIntoFolderFiles() }],
        }),
        snapshot('013-f6-external-into-folder-collapsed', 'Collapsed F6 case for external → folder aggregation.', {
            roots: [{ rootPath: ROOT_A, files: externalIntoFolderFiles() }],
            collapseSet: [rootATasksFolder],
        }),
        snapshot('014-f6-folder-to-external', 'Expanded F6 case where the folder points to an external note.', {
            roots: [{ rootPath: ROOT_A, files: folderToExternalFiles() }],
        }),
        snapshot('015-f6-folder-to-external-collapsed', 'Collapsed F6 case for folder → external aggregation.', {
            roots: [{ rootPath: ROOT_A, files: folderToExternalFiles() }],
            collapseSet: [rootATasksFolder],
        }),
        snapshot('020-two-sibling-folders', 'Sibling folder fixture with tasks/ and notes/.', {
            roots: [{ rootPath: ROOT_A, files: siblingFolderFiles() }],
        }),
        snapshot('021-nested-folder', 'Nested folder fixture with tasks/epics/ expanded.', {
            roots: [{ rootPath: ROOT_A, files: nestedFolderFiles() }],
        }),
        snapshot('022-nested-folder-inner-collapsed', 'Nested folder fixture with only the inner epics/ folder collapsed.', {
            roots: [{ rootPath: ROOT_A, files: nestedFolderFiles() }],
            collapseSet: [nestedEpicsFolder],
        }),
        snapshot('023-all-collapsed', 'All folders collapsed in the nested folder fixture.', {
            roots: [{ rootPath: ROOT_A, files: nestedFolderFiles() }],
            collapseSet: [nestedTasksFolder, nestedEpicsFolder],
        }),
        snapshot('040-mixed-collapse', 'Mixed-collapse fixture with selection, layout, zoom, pan, fit, and mutatedAt populated.', {
            roots: [{ rootPath: ROOT_A, files: mixedCollapseFiles() }],
            collapseSet: [nestedEpicsFolder, researchFolder],
            selection: [abs(ROOT_A, 'notes/inbox.md')],
            layout: {
                zoom: 1.2,
                pan: { x: -40, y: 22 },
                fit: { paddingPx: 48 },
            },
            meta: {
                revision: 4,
                mutatedAt: '2026-04-17T11:00:00.000Z',
            },
        }),
        snapshot('041-context-node-unresolved-link', 'Context-node fixture with containedNodeIds, color, additional YAML props, and unresolved links.', {
            roots: [{ rootPath: ROOT_A, files: contextNodeFiles() }],
        }),
        snapshot('050-two-roots-root-a-only', 'Multi-root baseline with only root-a loaded.', {
            roots: [
                { rootPath: ROOT_A, files: multiRootFilesRootA() },
                { rootPath: ROOT_B, files: multiRootFilesRootB() },
            ],
            loadedRoots: [ROOT_A],
        }),
        snapshot('051-two-roots-loaded', 'Both roots loaded for LoadRoot / UnloadRoot sequences.', {
            roots: [
                { rootPath: ROOT_A, files: multiRootFilesRootA() },
                { rootPath: ROOT_B, files: multiRootFilesRootB() },
            ],
            loadedRoots: [ROOT_A, ROOT_B],
        }),
        snapshot('054-multi-command-final', 'Final state after LoadRoot → AddNode → Collapse → Select.', {
            roots: [
                { rootPath: ROOT_A, files: multiRootFilesRootAWithNewNode() },
                { rootPath: ROOT_B, files: multiRootFilesRootB() },
            ],
            loadedRoots: [ROOT_A, ROOT_B],
            collapseSet: [rootATasksFolder],
            selection: [rootBRemote],
        }),
    ]

    const addNodeCommand: Command = {
        type: 'AddNode',
        node: nodeFromMarkdown(ROOT_A, 'delta.md', markdown('Delta', ['New node added for mutation tests.'])),
    }
    const removeNodeCommand: Command = {
        type: 'RemoveNode',
        id: abs(ROOT_A, 'delta.md'),
    }
    const addEdgeCommand: Command = {
        type: 'AddEdge',
        source: abs(ROOT_A, 'alpha.md'),
        edge: { targetId: abs(ROOT_A, 'gamma.md'), label: '' },
    }
    const removeEdgeCommand: Command = {
        type: 'RemoveEdge',
        source: abs(ROOT_A, 'alpha.md'),
        targetId: abs(ROOT_A, 'gamma.md'),
    }
    const moveCommand: Command = {
        type: 'Move',
        id: abs(ROOT_A, 'beta.md'),
        to: movedPositions['beta.md'],
    }
    const addNodeInsideTasksCommand: Command = {
        type: 'AddNode',
        node: nodeFromMarkdown(ROOT_A, 'tasks/delta.md', markdown('delta', ['Added during the multi-command sequence.'])),
    }

    const sequences: SequenceDocument[] = [
        sequence(
            '100-collapse-command',
            'Single Collapse command against a flat folder fixture.',
            '010-flat-folder',
            [{ type: 'Collapse', folder: rootATasksFolder }],
            {
                finalSnapshot: '011-flat-folder-collapsed',
                revisionDelta: 1,
                deltas: [{ revision: 1, collapseAdded: [rootATasksFolder] }],
            },
        ),
        sequence(
            '101-expand-command',
            'Single Expand command that restores the flat folder fixture.',
            '011-flat-folder-collapsed',
            [{ type: 'Expand', folder: rootATasksFolder }],
            {
                finalSnapshot: '010-flat-folder',
                revisionDelta: 1,
                deltas: [{ revision: 1, collapseRemoved: [rootATasksFolder] }],
            },
        ),
        sequence(
            '102-select-command',
            'Select one node from the flat baseline.',
            '003-flat-three-nodes',
            [{ type: 'Select', ids: [abs(ROOT_A, 'beta.md')] }],
            {
                finalSnapshot: '005-with-selection',
                revisionDelta: 1,
                deltas: [{ revision: 1, selectionAdded: [abs(ROOT_A, 'beta.md')] }],
            },
        ),
        sequence(
            '103-deselect-command',
            'Clear the selected node from the selection fixture.',
            '005-with-selection',
            [{ type: 'Deselect', ids: [abs(ROOT_A, 'beta.md')] }],
            {
                finalSnapshot: '003-flat-three-nodes',
                revisionDelta: 1,
                deltas: [{ revision: 1, selectionRemoved: [abs(ROOT_A, 'beta.md')] }],
            },
        ),
        sequence(
            '104-add-node-command',
            'AddNode grows the flat baseline by one node.',
            '003-flat-three-nodes',
            [addNodeCommand],
            { finalSnapshot: '008-add-node-result', revisionDelta: 1 },
        ),
        sequence(
            '105-remove-node-command',
            'RemoveNode prunes the extra node back out of the graph.',
            '008-add-node-result',
            [removeNodeCommand],
            { finalSnapshot: '003-flat-three-nodes', revisionDelta: 1 },
        ),
        sequence(
            '106-add-edge-command',
            'AddEdge adds Alpha → Gamma to the flat baseline.',
            '003-flat-three-nodes',
            [addEdgeCommand],
            { finalSnapshot: '009-add-edge-result', revisionDelta: 1 },
        ),
        sequence(
            '107-remove-edge-command',
            'RemoveEdge removes Alpha → Gamma from the add-edge result.',
            '009-add-edge-result',
            [removeEdgeCommand],
            { finalSnapshot: '003-flat-three-nodes', revisionDelta: 1 },
        ),
        sequence(
            '108-move-command',
            'Move updates one positioned node inside layout.positions.',
            '006-with-layout-positions',
            [moveCommand],
            { finalSnapshot: '007-with-layout-positions-moved', revisionDelta: 1 },
        ),
        sequence(
            '109-load-root-command',
            'LoadRoot adds the second loaded root.',
            '050-two-roots-root-a-only',
            [{ type: 'LoadRoot', root: ROOT_B }],
            {
                finalSnapshot: '051-two-roots-loaded',
                revisionDelta: 1,
                deltas: [{ revision: 1, rootsLoaded: [ROOT_B] }],
            },
        ),
        sequence(
            '110-unload-root-command',
            'UnloadRoot removes the second loaded root.',
            '051-two-roots-loaded',
            [{ type: 'UnloadRoot', root: ROOT_B }],
            {
                finalSnapshot: '050-two-roots-root-a-only',
                revisionDelta: 1,
                deltas: [{ revision: 1, rootsUnloaded: [ROOT_B] }],
            },
        ),
        sequence(
            '111-collapse-expand-round-trip',
            'Collapsing then expanding a folder returns to the expanded snapshot.',
            '010-flat-folder',
            [
                { type: 'Collapse', folder: rootATasksFolder },
                { type: 'Expand', folder: rootATasksFolder },
            ],
            { finalSnapshot: '010-flat-folder', revisionDelta: 2 },
        ),
        sequence(
            '112-select-deselect-round-trip',
            'Selecting then deselecting returns to the baseline selection-free state.',
            '003-flat-three-nodes',
            [
                { type: 'Select', ids: [abs(ROOT_A, 'beta.md')] },
                { type: 'Deselect', ids: [abs(ROOT_A, 'beta.md')] },
            ],
            { finalSnapshot: '003-flat-three-nodes', revisionDelta: 2 },
        ),
        sequence(
            '113-multi-command-load-add-collapse-select',
            'LoadRoot → AddNode → Collapse → Select in one compound sequence.',
            '050-two-roots-root-a-only',
            [
                { type: 'LoadRoot', root: ROOT_B },
                addNodeInsideTasksCommand,
                { type: 'Collapse', folder: rootATasksFolder },
                { type: 'Select', ids: [rootBRemote] },
            ],
            { finalSnapshot: '054-multi-command-final', revisionDelta: 4 },
        ),
        sequence(
            '114-add-then-remove-node',
            'AddNode followed by RemoveNode returns to the flat baseline.',
            '003-flat-three-nodes',
            [addNodeCommand, removeNodeCommand],
            { finalSnapshot: '003-flat-three-nodes', revisionDelta: 2 },
        ),
        sequence(
            '115-collapse-across-folder-boundary-f6',
            'Collapse across an F6 boundary using an external → folder edge.',
            '012-f6-external-into-folder',
            [{ type: 'Collapse', folder: rootATasksFolder }],
            { finalSnapshot: '013-f6-external-into-folder-collapsed', revisionDelta: 1 },
        ),
        sequence(
            '116-nested-collapse',
            'Collapse parent then child so both folders remain in collapseSet.',
            '021-nested-folder',
            [
                { type: 'Collapse', folder: nestedTasksFolder },
                { type: 'Collapse', folder: nestedEpicsFolder },
            ],
            { finalSnapshot: '023-all-collapsed', revisionDelta: 2 },
        ),
    ]

    const realVaultSnapshot = await snapshotStateFromVault(
        'brain/working-memory/tasks/folder-nodes',
        {
            id: REAL_VAULT_FIXTURE_ID,
            description: 'Canonicalized real-vault snapshot sourced from brain/working-memory/tasks/folder-nodes.',
            canonicalRoot: REAL_VAULT_CANONICAL_ROOT,
        },
    )

    for (const doc of [...snapshots, realVaultSnapshot]) {
        await writeJson(path.join(SNAPSHOTS_DIR, `${doc.id}.json`), doc)
    }

    for (const doc of sequences) {
        await writeJson(path.join(SEQUENCES_DIR, `${doc.id}.json`), doc)
    }

    console.log(
        `Generated ${snapshots.length + 1} snapshots and ${sequences.length} sequences in ${FIXTURES_DIR}`,
    )
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    console.error(message)
    process.exitCode = 1
})

import type { Position } from '@vt/graph-model'

import type { Command } from '../../src/contract.ts'
import type { SequenceDocument, SnapshotDocument } from '../../src/fixtures.ts'
import {
    addEdgeFiles,
    addNodeFiles,
    contextNodeFiles,
    externalIntoFolderFiles,
    flatFiveFiles,
    flatFolderFiles,
    flatThreeFiles,
    folderToExternalFiles,
    mixedCollapseFiles,
    multiRootFilesRootA,
    multiRootFilesRootAWithNewNode,
    multiRootFilesRootB,
    nestedFolderFiles,
    siblingFolderFiles,
} from './files.ts'
import { markdown } from './markdown.ts'
import { nodeFromMarkdown, sequence, snapshot } from './synthetic-state.ts'
import { abs, folderId, ROOT_A, ROOT_B, ROOT_EMPTY, setFolderState } from './types.ts'

export interface FixtureDocuments {
    readonly snapshots: readonly SnapshotDocument[]
    readonly sequences: readonly SequenceDocument[]
}

export function createFixtureDocuments(): FixtureDocuments {
    const movedPositions = {
        'alpha.md': { x: 80, y: 100 },
        'beta.md': { x: 360, y: 240 },
        'gamma.md': { x: 360, y: 100 },
    } satisfies Record<string, Position>
    const baselinePositions = {
        'alpha.md': { x: 80, y: 100 },
        'beta.md': { x: 220, y: 100 },
        'gamma.md': { x: 360, y: 100 },
    } satisfies Record<string, Position>

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
        snapshot('051-two-roots-loaded', 'Both roots available for folder-state sequences.', {
            roots: [
                { rootPath: ROOT_A, files: multiRootFilesRootA() },
                { rootPath: ROOT_B, files: multiRootFilesRootB() },
            ],
            loadedRoots: [ROOT_A, ROOT_B],
        }),
        snapshot('054-multi-command-final', 'Final state after folder-state expand → AddNode → folder-state collapse → Select.', {
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
            'Single SetFolderState(collapsed) command against a flat folder fixture.',
            '010-flat-folder',
            [setFolderState(rootATasksFolder, 'collapsed')],
            {
                finalSnapshot: '011-flat-folder-collapsed',
                revisionDelta: 1,
                deltas: [{ revision: 1, collapseAdded: [rootATasksFolder] }],
            },
        ),
        sequence(
            '101-expand-command',
            'Single SetFolderState(expanded) command that restores the flat folder fixture.',
            '011-flat-folder-collapsed',
            [setFolderState(rootATasksFolder, 'expanded')],
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
            'SetFolderState(expanded) adds the second implicit root.',
            '050-two-roots-root-a-only',
            [setFolderState(ROOT_B, 'expanded')],
            {
                finalSnapshot: '051-two-roots-loaded',
                revisionDelta: 1,
                deltas: [{ revision: 1, rootsLoaded: [ROOT_B] }],
            },
        ),
        sequence(
            '110-unload-root-command',
            'SetFolderState(hidden) removes the second implicit root.',
            '051-two-roots-loaded',
            [setFolderState(ROOT_B, 'hidden')],
            {
                finalSnapshot: '050-two-roots-root-a-only',
                revisionDelta: 1,
                deltas: [{ revision: 1, rootsUnloaded: [ROOT_B] }],
            },
        ),
        sequence(
            '111-collapse-expand-round-trip',
            'Setting a folder collapsed then expanded returns to the expanded snapshot.',
            '010-flat-folder',
            [
                setFolderState(rootATasksFolder, 'collapsed'),
                setFolderState(rootATasksFolder, 'expanded'),
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
            'Folder-state expand → AddNode → folder-state collapse → Select in one compound sequence.',
            '050-two-roots-root-a-only',
            [
                setFolderState(ROOT_B, 'expanded'),
                addNodeInsideTasksCommand,
                setFolderState(rootATasksFolder, 'collapsed'),
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
            'SetFolderState(collapsed) across an F6 boundary using an external → folder edge.',
            '012-f6-external-into-folder',
            [setFolderState(rootATasksFolder, 'collapsed')],
            { finalSnapshot: '013-f6-external-into-folder-collapsed', revisionDelta: 1 },
        ),
        sequence(
            '116-nested-collapse',
            'Set parent then child to collapsed so both folder-state rows remain collapsed.',
            '021-nested-folder',
            [
                setFolderState(nestedTasksFolder, 'collapsed'),
                setFolderState(nestedEpicsFolder, 'collapsed'),
            ],
            { finalSnapshot: '023-all-collapsed', revisionDelta: 2 },
        ),
    ]

    return { snapshots, sequences }
}

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { Core } from 'cytoscape'
import type { GraphNode, NodeIdAndFilePath } from '@vt/graph-model/graph'
import type { ProjectedGraph, ProjectedNode, ProjectedEdge } from '@vt/graph-state/contract'
import { createEditorData } from '@/shell/edge/UI-edge/floating-windows/types'
import { addEditor, getEditors } from '@/shell/edge/UI-edge/state/EditorStore'
import { vanillaFloatingWindowInstances } from '@/shell/edge/UI-edge/state/UIAppState'
import { updateFloatingEditors, updateFloatingEditorsFromProjectedGraph } from './EditorSync'

vi.mock('./FloatingEditorCRUD', () => ({
    closeEditor: vi.fn(),
}))

function makeNode(id: NodeIdAndFilePath, content: string): GraphNode {
    return {
        absoluteFilePathIsID: id,
        contentWithoutYamlOrLinks: content,
        outgoingEdges: [],
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map(),
            isContextNode: false,
        },
    }
}

function openEditorForNode(
    nodeId: NodeIdAndFilePath,
    initialContent: string,
    focused: boolean = false,
): { getValue: () => string } {
    let value = initialContent

    const editor = createEditorData({
        contentLinkedToNodeId: nodeId,
        title: 'Target',
    })
    addEditor(editor)

    const editorInstance = {
        dispose: vi.fn(),
        getValue: () => value,
        setValue: (nextValue: string) => {
            value = nextValue
        },
        appendAtEnd: (suffix: string) => {
            value = value + suffix
        },
        isFocused: () => focused,
    }
    vanillaFloatingWindowInstances.set(`${nodeId}-editor`, editorInstance as unknown as { dispose: () => void })

    return editorInstance
}

describe('updateFloatingEditors', () => {
    beforeEach(() => {
        getEditors().clear()
        vanillaFloatingWindowInstances.clear()
    })

    afterEach(() => {
        getEditors().clear()
        vanillaFloatingWindowInstances.clear()
    })

    it('appends suffix to editor even when editor has diverged from delta base', () => {
        const nodeId: NodeIdAndFilePath = 'target.md' as NodeIdAndFilePath
        const editor = openEditorForNode(nodeId, 'rn')

        updateFloatingEditors({} as Core, [{
            type: 'UpsertNode',
            previousNode: O.some(makeNode(nodeId, 'r')),
            nodeToUpsert: makeNode(nodeId, 'ra'),
        }])

        expect(editor.getValue()).toBe('rna')
    })

    it('still appends an append-only suffix when the editor matches the delta base', () => {
        const nodeId: NodeIdAndFilePath = 'target.md' as NodeIdAndFilePath
        const editor = openEditorForNode(nodeId, 'r')

        updateFloatingEditors({} as Core, [{
            type: 'UpsertNode',
            previousNode: O.some(makeNode(nodeId, 'r')),
            nodeToUpsert: makeNode(nodeId, 'ra'),
        }])

        expect(editor.getValue()).toBe('ra')
    })

    it('does not apply a stale full replacement over newer live editor text', () => {
        const nodeId: NodeIdAndFilePath = 'target.md' as NodeIdAndFilePath
        const editor = openEditorForNode(nodeId, 'random saves should stay ordered')

        updateFloatingEditors({} as Core, [{
            type: 'UpsertNode',
            previousNode: O.some(makeNode(nodeId, '# Typing Target\n\n')),
            nodeToUpsert: makeNode(nodeId, 'r'),
        }])

        expect(editor.getValue()).toBe('random saves should stay ordered')
    })

    it('still applies a full replacement when the editor matches the delta base', () => {
        const nodeId: NodeIdAndFilePath = 'target.md' as NodeIdAndFilePath
        const editor = openEditorForNode(nodeId, '# Typing Target\n\n')

        updateFloatingEditors({} as Core, [{
            type: 'UpsertNode',
            previousNode: O.some(makeNode(nodeId, '# Typing Target\n\n')),
            nodeToUpsert: makeNode(nodeId, 'r'),
        }])

        expect(editor.getValue()).toBe('r')
    })

    it('does not duplicate when an append-only echo arrives after the user has typed past the saved suffix', () => {
        // Repro for the recurring "duplicating / glitchy text" bug.
        //
        // User typed 'r' → autosave fired → editor kept being typed and is now
        // 'ra'.  The daemon SSE echo (or file-watcher) for the earlier save
        // arrives now: prev='' → new='r', i.e. an append-only delta whose
        // suffix is 'r'.  The editor already contains everything in `new`
        // (it's 'ra'), so this delta MUST be a no-op.  Pre-fix, the suffix
        // gets re-appended → 'rar'.
        const nodeId: NodeIdAndFilePath = 'target.md' as NodeIdAndFilePath
        const editor = openEditorForNode(nodeId, 'ra')

        updateFloatingEditors({} as Core, [{
            type: 'UpsertNode',
            previousNode: O.some(makeNode(nodeId, '')),
            nodeToUpsert: makeNode(nodeId, 'r'),
        }])

        expect(editor.getValue()).toBe('ra')
    })

    it('does not duplicate when an append-only echo arrives mid-word and the editor has typed further', () => {
        // Same shape, longer realistic content: user typed "Hello world" past
        // an autosave that captured "Hello wor".  Delta echo prev='Hello '
        // → new='Hello wor' must be a no-op because the editor already has
        // it (and more).
        const nodeId: NodeIdAndFilePath = 'target.md' as NodeIdAndFilePath
        const editor = openEditorForNode(nodeId, 'Hello world')

        updateFloatingEditors({} as Core, [{
            type: 'UpsertNode',
            previousNode: O.some(makeNode(nodeId, 'Hello ')),
            nodeToUpsert: makeNode(nodeId, 'Hello wor'),
        }])

        expect(editor.getValue()).toBe('Hello world')
    })

    it('keeps focused embedded-mode editors immune to non-append replacements', () => {
        const nodeId: NodeIdAndFilePath = 'target.md' as NodeIdAndFilePath
        const editor = openEditorForNode(nodeId, '# Typing Target\n\n', true)

        updateFloatingEditors({} as Core, [{
            type: 'UpsertNode',
            previousNode: O.some(makeNode(nodeId, '# Typing Target\n\n')),
            nodeToUpsert: makeNode(nodeId, 'external update'),
        }])

        expect(editor.getValue()).toBe('# Typing Target\n\n')
    })

    it('applies matching daemon-mode external replacements while the editor is focused', () => {
        const nodeId: NodeIdAndFilePath = 'target.md' as NodeIdAndFilePath
        const editor = openEditorForNode(nodeId, '# Typing Target\n\n', true)

        updateFloatingEditors({} as Core, [{
            type: 'UpsertNode',
            previousNode: O.some(makeNode(nodeId, '# Typing Target\n\n')),
            nodeToUpsert: makeNode(nodeId, 'external update'),
        }], true)

        expect(editor.getValue()).toBe('external update')
    })
})

function makeProjectedFileNode(id: string, content: string): ProjectedNode {
    return {
        id,
        kind: 'file',
        label: id,
        relPath: id,
        basename: id,
        folderPath: '',
        content,
    }
}

function makeProjectedGraph(
    nodes: readonly ProjectedNode[],
    edges: readonly ProjectedEdge[] = [],
): ProjectedGraph {
    return {
        nodes,
        edges,
        rootPath: '/test',
        revision: 0,
        forests: [],
        arboricity: 0,
        recentNodeIds: [],
    }
}

describe('updateFloatingEditorsFromProjectedGraph', () => {
    beforeEach(() => {
        getEditors().clear()
        vanillaFloatingWindowInstances.clear()
    })

    afterEach(() => {
        getEditors().clear()
        vanillaFloatingWindowInstances.clear()
    })

    it('merges an external append into a focused editor that has typed past the previous projected content', () => {
        // Mirrors the Playwright `merges external daemon SSE append while the editor is focused and typing` regression.
        // User has typed past the autosave; daemon then re-projects after an external `fs.appendFile`,
        // delivering a ProjectedGraph whose node content extends the previous projection in append-only fashion.
        // Editor must reflect both the user's text and the externally appended suffix.
        const nodeId: NodeIdAndFilePath = 'Typing Target.md' as NodeIdAndFilePath
        const userText: string = 'user is typing this while the daemon is active'
        const editor = openEditorForNode(nodeId, userText, /* focused */ true)

        const previousProjected: ProjectedGraph = makeProjectedGraph([
            makeProjectedFileNode(nodeId, '# Typing Target\n\nInitial content that will be replaced.\n'),
        ])
        const newProjected: ProjectedGraph = makeProjectedGraph([
            makeProjectedFileNode(
                nodeId,
                '# Typing Target\n\nInitial content that will be replaced.\n\n\n## Agent Section\nagent wrote this\n',
            ),
        ])

        updateFloatingEditorsFromProjectedGraph({} as Core, newProjected, previousProjected)

        const result: string = editor.getValue()
        expect(result).toContain(userText)
        expect(result).toContain('## Agent Section\nagent wrote this')
    })

    it('does nothing when no editor is open for the changed node', () => {
        const previousProjected: ProjectedGraph = makeProjectedGraph([
            makeProjectedFileNode('other.md', 'a'),
        ])
        const newProjected: ProjectedGraph = makeProjectedGraph([
            makeProjectedFileNode('other.md', 'a + b'),
        ])

        // No editor registered — should be a no-op without throwing.
        expect(() => updateFloatingEditorsFromProjectedGraph({} as Core, newProjected, previousProjected)).not.toThrow()
    })

    it('skips when projected content is unchanged from the previous projection', () => {
        const nodeId: NodeIdAndFilePath = 'unchanged.md' as NodeIdAndFilePath
        const editor = openEditorForNode(nodeId, 'live edits in flight')

        const projected: ProjectedGraph = makeProjectedGraph([
            makeProjectedFileNode(nodeId, 'persisted body'),
        ])

        updateFloatingEditorsFromProjectedGraph({} as Core, projected, projected)

        expect(editor.getValue()).toBe('live edits in flight')
    })
})

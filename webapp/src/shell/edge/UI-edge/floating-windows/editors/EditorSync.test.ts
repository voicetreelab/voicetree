import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { Core } from 'cytoscape'
import type { GraphNode, NodeIdAndFilePath } from '@vt/graph-model/pure/graph'
import { createEditorData } from '@/shell/edge/UI-edge/floating-windows/types'
import { addEditor, getEditors } from '@/shell/edge/UI-edge/state/EditorStore'
import { vanillaFloatingWindowInstances } from '@/shell/edge/UI-edge/state/UIAppState'
import { updateFloatingEditors } from './EditorSync'

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

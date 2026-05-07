/**
 * Fuzz test: random interleaved sequences of UI edits, autosave round-trips,
 * FS events, and focus toggles — verifying EditorSync invariants hold.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { Core } from 'cytoscape'
import type { GraphNode, NodeIdAndFilePath, Edge } from '@vt/graph-model/graph'
import { getEditors } from '@/shell/edge/UI-edge/state/EditorStore'
import { vanillaFloatingWindowInstances } from '@/shell/edge/UI-edge/state/UIAppState'
import { updateFloatingEditors } from './EditorSync'
import { fromNodeToContentWithWikilinks } from '@vt/graph-model/markdown'
import {
    createPRNG, randomInt, generateOps,
    makeNode, makeNodeWithWikilinks, createMockEditor, createFuzzState,
    checkNoDuplication, checkAutosaveEchoBlocked,
    type FuzzState, type MockEditor,
} from './editorSync.fuzz-helpers'

vi.mock('./FloatingEditorCRUD', () => ({ closeEditor: vi.fn() }))

const cy: Core = {} as Core
const NODE_ID: NodeIdAndFilePath = 'fuzz-target.md' as NodeIdAndFilePath

function runOp(
    op: ReturnType<typeof generateOps>[number],
    mockEditor: MockEditor,
    state: FuzzState,
    _context: string,
): void {
    switch (op.type) {
        case 'user-types': {
            mockEditor.setFocused(true)
            state.focused = true
            mockEditor.setValue(op.content)
            state.lastUserContent = op.content
            state.userTypedSinceSave = true
            break
        }

        case 'autosave-roundtrip': {
            const prevNode: GraphNode = makeNodeWithWikilinks(
                NODE_ID, state.lastGraphContent,
                state.lastGraphEdges.map(e => e.targetId),
            )
            const contentAtSave: string = mockEditor.getValue()
            const stripped: string = contentAtSave.replace(/\[\[([^\]]+)\]\]/g, '[$1]*')
            const savedNode: GraphNode = makeNode(NODE_ID, stripped, state.lastGraphEdges)
            const contentBefore: string = mockEditor.getValue()

            updateFloatingEditors(cy, [{
                type: 'UpsertNode',
                previousNode: O.some(prevNode),
                nodeToUpsert: savedNode,
            }])

            state.lastSavedContent = fromNodeToContentWithWikilinks(savedNode)
            state.contentBeforeSave = fromNodeToContentWithWikilinks(prevNode)
            state.lastGraphContent = stripped

            if (state.userTypedSinceSave && state.focused) {
                expect(mockEditor.getValue()).toBe(contentBefore)
            }
            break
        }

        case 'external-write': {
            const prevNode: GraphNode = makeNodeWithWikilinks(
                NODE_ID, state.lastGraphContent,
                state.lastGraphEdges.map(e => e.targetId),
            )
            const newNode: GraphNode = makeNode(NODE_ID, op.content, state.lastGraphEdges)
            const contentBefore: string = mockEditor.getValue()
            const prevRendered: string = fromNodeToContentWithWikilinks(prevNode)

            updateFloatingEditors(cy, [{
                type: 'UpsertNode',
                previousNode: O.some(prevNode),
                nodeToUpsert: newNode,
            }])

            if (!state.focused && contentBefore === prevRendered) {
                expect(mockEditor.getValue()).toBe(fromNodeToContentWithWikilinks(newNode))
                state.lastUserContent = null
                state.userTypedSinceSave = false
                state.appendedSuffixes = []
            }
            if (state.focused) {
                expect(mockEditor.getValue()).toBe(contentBefore)
            }
            state.lastGraphContent = op.content
            break
        }

        case 'append-wikilink': {
            const prevNode: GraphNode = makeNodeWithWikilinks(
                NODE_ID, state.lastGraphContent,
                state.lastGraphEdges.map(e => e.targetId),
            )
            const prevRendered: string = fromNodeToContentWithWikilinks(prevNode)
            const newEdges: readonly Edge[] = [...state.lastGraphEdges, { targetId: op.childId as NodeIdAndFilePath, label: '' }]
            const newNode: GraphNode = makeNode(NODE_ID, state.lastGraphContent, newEdges)
            const newRendered: string = fromNodeToContentWithWikilinks(newNode)

            if (newRendered.startsWith(prevRendered) && newRendered.length > prevRendered.length) {
                const suffix: string = newRendered.slice(prevRendered.length)
                const contentBefore: string = mockEditor.getValue()

                updateFloatingEditors(cy, [{
                    type: 'UpsertNode',
                    previousNode: O.some(prevNode),
                    nodeToUpsert: newNode,
                }])

                if (!contentBefore.endsWith(suffix)) {
                    expect(mockEditor.getValue()).toBe(contentBefore + suffix)
                    state.appendedSuffixes.push(suffix)
                } else {
                    expect(mockEditor.getValue()).toBe(contentBefore)
                }
                state.lastGraphEdges = newEdges
            }
            break
        }

        case 'new-node-delta': {
            const newNode: GraphNode = makeNode(NODE_ID, op.content)
            const contentBefore: string = mockEditor.getValue()
            const newRendered: string = fromNodeToContentWithWikilinks(newNode)

            updateFloatingEditors(cy, [{
                type: 'UpsertNode',
                previousNode: O.none,
                nodeToUpsert: newNode,
            }])

            if (state.focused) {
                expect(mockEditor.getValue()).toBe(contentBefore)
            }
            if (!state.focused && contentBefore !== newRendered) {
                expect(mockEditor.getValue()).toBe(newRendered)
                state.lastUserContent = null
                state.userTypedSinceSave = false
                state.appendedSuffixes = []
                state.lastGraphContent = op.content
                state.lastGraphEdges = []
            }
            break
        }

        case 'toggle-focus': {
            state.focused = !state.focused
            mockEditor.setFocused(state.focused)
            if (state.focused) {
                state.lastUserContent = mockEditor.getValue()
            }
            break
        }
    }
}

describe('EditorSync fuzz — random interleaved operations', () => {
    beforeEach(() => { getEditors().clear(); vanillaFloatingWindowInstances.clear() })
    afterEach(() => { getEditors().clear(); vanillaFloatingWindowInstances.clear() })

    for (let seed: number = 0; seed < 50; seed++) {
        it(`fuzz iteration seed=${seed}`, () => {
            const rng: () => number = createPRNG(seed + 1)
            const initialContent: string = '# Initial\n\nStarting content.'
            const mockEditor: MockEditor = createMockEditor(NODE_ID, initialContent)
            const state: FuzzState = createFuzzState(NODE_ID, initialContent)

            const ops: readonly ReturnType<typeof generateOps>[number][] = generateOps(rng, randomInt(rng, 20, 50))

            for (let i: number = 0; i < ops.length; i++) {
                const ctx: string = `seed=${seed}, op=${i}/${ops.length}, type=${ops[i].type}`
                runOp(ops[i], mockEditor, state, ctx)

                const content: string = mockEditor.getValue()
                checkNoDuplication(content, ctx)
                if (state.focused) checkAutosaveEchoBlocked(content, state, ctx)
            }
        })
    }
})

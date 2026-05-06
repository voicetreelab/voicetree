/**
 * Targeted property-based tests for EditorSync invariants:
 * - Wikilink round-trip fidelity (no duplication)
 * - Append-only preserves user typing
 * - Focused editor immune to non-append overwrites
 * - Unfocused editor accepts matching external writes
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { Core } from 'cytoscape'
import type { GraphNode, NodeIdAndFilePath } from '@vt/graph-model/pure/graph'
import { getEditors } from '@/shell/edge/UI-edge/state/EditorStore'
import { vanillaFloatingWindowInstances } from '@/shell/edge/UI-edge/state/UIAppState'
import { updateFloatingEditors } from './EditorSync'
import { fromNodeToContentWithWikilinks } from '@vt/graph-model/pure/graph/markdown-writing/node_to_markdown'
import {
    createPRNG, randomInt, randomChoice,
    makeNode, makeNodeWithWikilinks, createMockEditor,
    checkNoDuplication, SAMPLE_TEXTS, type MockEditor,
} from './editorSync.fuzz-helpers'

vi.mock('./FloatingEditorCRUD', () => ({ closeEditor: vi.fn() }))

const cy: Core = {} as Core

describe('EditorSync property — wikilink round-trip fidelity', () => {
    beforeEach(() => { getEditors().clear(); vanillaFloatingWindowInstances.clear() })
    afterEach(() => { getEditors().clear(); vanillaFloatingWindowInstances.clear() })

    for (let seed: number = 100; seed < 130; seed++) {
        it(`round-trip seed=${seed}`, () => {
            const rng: () => number = createPRNG(seed)
            const nodeId: NodeIdAndFilePath = 'roundtrip-test.md' as NodeIdAndFilePath
            const mockEditor: MockEditor = createMockEditor(nodeId, '')

            const childCount: number = randomInt(rng, 1, 4)
            const childIds: readonly NodeIdAndFilePath[] = Array.from({ length: childCount }, (_, i) =>
                `child-${i}-${randomInt(rng, 0, 999)}.md` as NodeIdAndFilePath,
            )
            const bodyContent: string = randomChoice(rng, SAMPLE_TEXTS)
            const node1: GraphNode = makeNodeWithWikilinks(nodeId, bodyContent, childIds)
            const rendered1: string = fromNodeToContentWithWikilinks(node1)

            mockEditor.setFocused(false)
            mockEditor.setValue(rendered1)

            const prevNode: GraphNode = makeNodeWithWikilinks(nodeId, bodyContent, childIds)
            updateFloatingEditors(cy, [{
                type: 'UpsertNode',
                previousNode: O.some(prevNode),
                nodeToUpsert: node1,
            }])

            expect(mockEditor.getValue()).toBe(rendered1)
            checkNoDuplication(mockEditor.getValue(), `round-trip seed=${seed}`)
        })
    }
})

describe('EditorSync property — append-only preserves user typing', () => {
    beforeEach(() => { getEditors().clear(); vanillaFloatingWindowInstances.clear() })
    afterEach(() => { getEditors().clear(); vanillaFloatingWindowInstances.clear() })

    for (let seed: number = 200; seed < 230; seed++) {
        it(`append seed=${seed}`, () => {
            const rng: () => number = createPRNG(seed)
            const nodeId: NodeIdAndFilePath = 'append-test.md' as NodeIdAndFilePath
            const initialBody: string = randomChoice(rng, SAMPLE_TEXTS)
            const mockEditor: MockEditor = createMockEditor(nodeId, initialBody)

            mockEditor.setFocused(true)
            const userTyped: string = initialBody + '\n\nUser added paragraph ' + randomInt(rng, 0, 999)
            mockEditor.setValue(userTyped)

            const childId: NodeIdAndFilePath = `new-child-${randomInt(rng, 0, 999)}.md` as NodeIdAndFilePath
            const prevNode: GraphNode = makeNode(nodeId, initialBody)
            const newNode: GraphNode = makeNodeWithWikilinks(nodeId, initialBody, [childId])
            const prevRendered: string = fromNodeToContentWithWikilinks(prevNode)
            const newRendered: string = fromNodeToContentWithWikilinks(newNode)

            expect(newRendered.startsWith(prevRendered)).toBe(true)
            const suffix: string = newRendered.slice(prevRendered.length)

            updateFloatingEditors(cy, [{
                type: 'UpsertNode',
                previousNode: O.some(prevNode),
                nodeToUpsert: newNode,
            }])

            const content: string = mockEditor.getValue()
            expect(content.startsWith(userTyped)).toBe(true)
            if (!userTyped.endsWith(suffix)) {
                expect(content).toBe(userTyped + suffix)
            }
            checkNoDuplication(content, `append seed=${seed}`)
        })
    }
})

describe('EditorSync property — focused editor immune to non-append overwrites', () => {
    beforeEach(() => { getEditors().clear(); vanillaFloatingWindowInstances.clear() })
    afterEach(() => { getEditors().clear(); vanillaFloatingWindowInstances.clear() })

    for (let seed: number = 300; seed < 330; seed++) {
        it(`focused-immune seed=${seed}`, () => {
            const rng: () => number = createPRNG(seed)
            const nodeId: NodeIdAndFilePath = 'focus-test.md' as NodeIdAndFilePath
            const initialBody: string = randomChoice(rng, SAMPLE_TEXTS)
            const mockEditor: MockEditor = createMockEditor(nodeId, initialBody)

            mockEditor.setFocused(true)
            const userContent: string = 'User typed: ' + randomInt(rng, 0, 9999)
            mockEditor.setValue(userContent)

            const writeCount: number = randomInt(rng, 2, 8)
            for (let i: number = 0; i < writeCount; i++) {
                const extContent: string = 'External #' + i + '-' + randomInt(rng, 0, 999)
                const prevNode: GraphNode = makeNode(nodeId, i === 0 ? initialBody : extContent)
                const newNode: GraphNode = makeNode(nodeId, extContent)

                updateFloatingEditors(cy, [{
                    type: 'UpsertNode',
                    previousNode: O.some(prevNode),
                    nodeToUpsert: newNode,
                }])

                expect(mockEditor.getValue()).toBe(userContent)
            }
        })
    }
})

describe('EditorSync property — unfocused editor accepts matching external writes', () => {
    beforeEach(() => { getEditors().clear(); vanillaFloatingWindowInstances.clear() })
    afterEach(() => { getEditors().clear(); vanillaFloatingWindowInstances.clear() })

    for (let seed: number = 400; seed < 420; seed++) {
        it(`unfocused-accept seed=${seed}`, () => {
            const rng: () => number = createPRNG(seed)
            const nodeId: NodeIdAndFilePath = 'unfocused-test.md' as NodeIdAndFilePath
            const initialBody: string = randomChoice(rng, SAMPLE_TEXTS)
            const mockEditor: MockEditor = createMockEditor(nodeId, initialBody)
            mockEditor.setFocused(false)

            let currentGraph: string = initialBody
            const chainLen: number = randomInt(rng, 3, 8)
            for (let i: number = 0; i < chainLen; i++) {
                const newContent: string = randomChoice(rng, SAMPLE_TEXTS) + '-chain-' + i
                const prevNode: GraphNode = makeNode(nodeId, currentGraph)
                const newNode: GraphNode = makeNode(nodeId, newContent)
                const prevRendered: string = fromNodeToContentWithWikilinks(prevNode)
                const newRendered: string = fromNodeToContentWithWikilinks(newNode)

                if (mockEditor.getValue() === prevRendered) {
                    updateFloatingEditors(cy, [{
                        type: 'UpsertNode',
                        previousNode: O.some(prevNode),
                        nodeToUpsert: newNode,
                    }])
                    expect(mockEditor.getValue()).toBe(newRendered)
                    currentGraph = newContent
                } else {
                    const before: string = mockEditor.getValue()
                    updateFloatingEditors(cy, [{
                        type: 'UpsertNode',
                        previousNode: O.some(prevNode),
                        nodeToUpsert: newNode,
                    }])
                    expect(mockEditor.getValue()).toBe(before)
                    break
                }
            }
        })
    }
})

/**
 * Pure helpers and mock infrastructure for EditorSync fuzz/property tests.
 * No side effects — mock creation functions return values, callers wire them up.
 */

import * as O from 'fp-ts/lib/Option.js'
import { vi } from 'vitest'
import type { GraphNode, NodeIdAndFilePath } from '@vt/graph-model/graph'
import { createEditorData } from '@/shell/edge/UI-edge/floating-windows/anchoring/types'
import type { EditorData } from '@/shell/edge/UI-edge/state/stores/UIAppState'
import { addEditor } from '@/shell/edge/UI-edge/state/stores/EditorStore'
import { vanillaFloatingWindowInstances } from '@/shell/edge/UI-edge/state/stores/UIAppState'

// =============================================================================
// Seeded PRNG (xorshift32) for reproducible fuzz runs
// =============================================================================

export function createPRNG(seed: number): () => number {
    let state: number = seed | 1
    return (): number => {
        state ^= state << 13
        state ^= state >>> 17
        state ^= state << 5
        return (state >>> 0) / 0xFFFFFFFF
    }
}

export function randomInt(rng: () => number, min: number, max: number): number {
    return Math.floor(rng() * (max - min + 1)) + min
}

export function randomChoice<T>(rng: () => number, items: readonly T[]): T {
    return items[randomInt(rng, 0, items.length - 1)]
}

// =============================================================================
// Node construction
// =============================================================================

export function makeNode(
    id: NodeIdAndFilePath,
    content: string,
    edges: readonly { targetId: NodeIdAndFilePath; label: string }[] = [],
): GraphNode {
    return {
        absoluteFilePathIsID: id,
        contentWithoutYamlOrLinks: content,
        outgoingEdges: edges,
        kind: 'leaf',
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: {},
            isContextNode: false,
        },
    }
}

export function makeNodeWithWikilinks(
    id: NodeIdAndFilePath,
    content: string,
    childIds: readonly NodeIdAndFilePath[],
): GraphNode {
    return makeNode(
        id,
        content,
        childIds.map(cid => ({ targetId: cid, label: '' })),
    )
}

// =============================================================================
// Mock editor
// =============================================================================

export interface MockEditor {
    getValue: () => string
    setValue: (v: string) => void
    appendAtEnd: (suffix: string) => void
    isFocused: () => boolean
    dispose: () => void
    setValueCalls: string[]
    setFocused: (f: boolean) => void
}

export function createMockEditor(nodeId: NodeIdAndFilePath, initialContent: string): MockEditor {
    let value: string = initialContent
    let focused: boolean = false
    const setValueCalls: string[] = []

    const editor: EditorData = createEditorData({
        contentLinkedToNodeId: nodeId,
        title: 'Fuzz Target',
    })
    addEditor(editor)

    const mock: MockEditor = {
        getValue: () => value,
        setValue: (nextValue: string) => {
            value = nextValue
            setValueCalls.push(nextValue)
        },
        appendAtEnd: (suffix: string) => {
            value = value + suffix
            setValueCalls.push(value)
        },
        isFocused: () => focused,
        dispose: vi.fn(),
        setValueCalls,
        setFocused: (f: boolean) => { focused = f },
    }

    vanillaFloatingWindowInstances.set(
        `${nodeId}-editor`,
        mock as unknown as { dispose: () => void },
    )

    return mock
}

// =============================================================================
// Operation types for the fuzz
// =============================================================================

export type Op =
    | { type: 'user-types'; content: string }
    | { type: 'autosave-roundtrip' }
    | { type: 'external-write'; content: string }
    | { type: 'append-wikilink'; childId: string }
    | { type: 'new-node-delta'; content: string }
    | { type: 'toggle-focus' }

// =============================================================================
// Fuzz state tracker
// =============================================================================

export interface FuzzState {
    nodeId: NodeIdAndFilePath
    lastUserContent: string | null
    lastSavedContent: string | null
    contentBeforeSave: string | null
    userTypedSinceSave: boolean
    appendedSuffixes: string[]
    lastGraphContent: string
    lastGraphEdges: readonly { targetId: NodeIdAndFilePath; label: string }[]
    focused: boolean
}

export function createFuzzState(nodeId: NodeIdAndFilePath, initialContent: string): FuzzState {
    return {
        nodeId,
        lastUserContent: null,
        lastSavedContent: null,
        contentBeforeSave: null,
        userTypedSinceSave: false,
        appendedSuffixes: [],
        lastGraphContent: initialContent,
        lastGraphEdges: [],
        focused: false,
    }
}

// =============================================================================
// Content generators
// =============================================================================

export const SAMPLE_TEXTS: readonly string[] = [
    '# My Note',
    '# My Note\n\nSome body text.',
    'Hello world',
    '# Title\n\nParagraph with **bold** and _italic_.',
    'Short',
    '# Deep nested\n\n## Section\n\nContent here.\n\n### Sub',
    '',
    'a',
    'ab',
    '# A\n\nText with [link]* placeholder',
]

export const SAMPLE_CHILD_IDS: readonly string[] = [
    'child-a.md',
    'child-b.md',
    'notes/child-c.md',
    'deep/nested/child-d.md',
]

export function generateOps(rng: () => number, count: number): readonly Op[] {
    const ops: Op[] = []
    for (let i: number = 0; i < count; i++) {
        const opType: number = randomInt(rng, 0, 5)
        switch (opType) {
            case 0:
                ops.push({ type: 'user-types', content: randomChoice(rng, SAMPLE_TEXTS) + randomInt(rng, 0, 999).toString() })
                break
            case 1:
                ops.push({ type: 'autosave-roundtrip' })
                break
            case 2:
                ops.push({ type: 'external-write', content: randomChoice(rng, SAMPLE_TEXTS) + '-ext-' + randomInt(rng, 0, 999).toString() })
                break
            case 3:
                ops.push({ type: 'append-wikilink', childId: randomChoice(rng, SAMPLE_CHILD_IDS) })
                break
            case 4:
                ops.push({ type: 'new-node-delta', content: randomChoice(rng, SAMPLE_TEXTS) })
                break
            case 5:
                ops.push({ type: 'toggle-focus' })
                break
        }
    }
    return ops
}

// =============================================================================
// Invariant checkers (pure — throw on violation)
// =============================================================================

export function checkNoDuplication(editorContent: string, context: string): void {
    const lines: readonly string[] = editorContent.split('\n')
    for (let i: number = 0; i < lines.length - 1; i++) {
        const line: string = lines[i].trim()
        const nextLine: string = lines[i + 1].trim()
        if (line.length > 2 && line === nextLine && /^\[\[.*\]\]$/.test(line)) {
            throw new Error(
                `INVARIANT VIOLATION: Consecutive duplicate wikilink "${line}" at lines ${i},${i + 1}. ${context}. Content:\n${editorContent}`,
            )
        }
    }
}

export function checkAutosaveEchoBlocked(
    editorContent: string,
    state: FuzzState,
    context: string,
): void {
    if (!state.userTypedSinceSave || state.lastUserContent === null) return

    if (editorContent.startsWith(state.lastUserContent)) return
    if (editorContent === state.lastUserContent) return

    // Check user content + accumulated append suffixes
    let expected: string = state.lastUserContent
    for (const suffix of state.appendedSuffixes) {
        if (!expected.endsWith(suffix)) expected += suffix
    }
    if (editorContent === expected || editorContent.startsWith(state.lastUserContent)) return

    throw new Error(
        `INVARIANT VIOLATION: Autosave echo clobbered user content. User typed: "${state.lastUserContent}", editor has: "${editorContent}". ${context}`,
    )
}
